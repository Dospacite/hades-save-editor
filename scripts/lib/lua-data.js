"use strict";

// A small, forgiving reader for the game's Lua data files.
// It runs top-level assignments and the table helpers the data files call
// (OverwriteTableKeys, AddTableKeysCheckDupes). Function bodies are skipped.
// Values it can't work out become { $expr: "..." } so nothing crashes.

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

const BLOCK_OPENERS = new Set(["function", "do", "if", "repeat"]);

function tokenize(source, fileName) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const longBracketLevel = (at) => {
    if (source[at] !== "[") return -1;
    let j = at + 1;
    while (source[j] === "=") j += 1;
    return source[j] === "[" ? j - at - 1 : -1;
  };

  const readLong = (at, level) => {
    const close = `]${"=".repeat(level)}]`;
    const start = at + level + 2;
    const end = source.indexOf(close, start);
    const stop = end === -1 ? n : end;
    const text = source.slice(start, stop);
    line += (text.match(/\n/g) || []).length;
    return { text, next: end === -1 ? n : end + close.length };
  };

  if (source.charCodeAt(0) === 0xfeff) i = 1;

  while (i < n) {
    const c = source[i];
    if (c === "\n") { line += 1; i += 1; continue; }
    if (c === " " || c === "\t" || c === "\r") { i += 1; continue; }

    if (c === "-" && source[i + 1] === "-") {
      const level = longBracketLevel(i + 2);
      if (level >= 0) {
        i = readLong(i + 2, level).next;
      } else {
        while (i < n && source[i] !== "\n") i += 1;
      }
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      const word = source.slice(i, j);
      tokens.push({ type: KEYWORDS.has(word) ? "kw" : "name", value: word, line });
      i = j;
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1]))) {
      let j = i;
      if (c === "0" && /[xX]/.test(source[i + 1])) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(source[j])) j += 1;
      } else {
        while (j < n && /[0-9.]/.test(source[j])) j += 1;
        if (/[eE]/.test(source[j])) {
          j += 1;
          if (/[+-]/.test(source[j])) j += 1;
          while (j < n && /[0-9]/.test(source[j])) j += 1;
        }
      }
      tokens.push({ type: "num", value: Number(source.slice(i, j)), line });
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      while (j < n && source[j] !== c) {
        if (source[j] === "\\") {
          const e = source[j + 1];
          const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'" };
          text += map[e] ?? e;
          j += 2;
          continue;
        }
        if (source[j] === "\n") line += 1;
        text += source[j];
        j += 1;
      }
      tokens.push({ type: "str", value: text, line });
      i = j + 1;
      continue;
    }

    if (c === "[") {
      const level = longBracketLevel(i);
      if (level >= 0) {
        const startLine = line;
        const { text, next } = readLong(i, level);
        tokens.push({ type: "str", value: text, line: startLine });
        i = next;
        continue;
      }
    }

    const three = source.slice(i, i + 3);
    const two = source.slice(i, i + 2);
    if (three === "...") { tokens.push({ type: "op", value: three, line }); i += 3; continue; }
    if (["==", "~=", "<=", ">=", "..", "::", "//"].includes(two)) {
      tokens.push({ type: "op", value: two, line });
      i += 2;
      continue;
    }
    if ("{}[]()=,;.:+-*/%^#<>".includes(c)) {
      tokens.push({ type: "op", value: c, line });
      i += 1;
      continue;
    }
    throw new Error(`${fileName}:${line}: unexpected character ${JSON.stringify(c)}`);
  }
  tokens.push({ type: "eof", value: null, line });
  return tokens;
}

const BINARY_PRIORITY = {
  or: 1, and: 2,
  "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
  "..": 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "//": 7, "%": 7,
  "^": 10,
};
const UNARY_PRIORITY = 8;

class LuaDataReader {
  constructor() {
    this.globals = Object.create(null);
    this.warnings = [];
    // Where each top-level table key was defined, for the report.
    this.origins = new Map();
  }

  load(source, fileName) {
    this.tokens = tokenize(source, fileName);
    this.pos = 0;
    this.fileName = fileName;
    this.locals = Object.create(null);
    while (!this.at("eof")) {
      try {
        this.statement();
      } catch (error) {
        this.warnings.push(`${fileName}:${this.peek().line}: ${error.message}`);
        this.recover();
      }
    }
  }

  // Skip to the next token that starts a line-level statement.
  recover() {
    const startLine = this.peek().line;
    while (!this.at("eof")) {
      const t = this.peek();
      if (t.line > startLine && t.type === "name") {
        const next = this.tokens[this.pos + 1];
        if (next && next.type === "op" && (next.value === "=" || next.value === "(" || next.value === ".")) return;
      }
      this.pos += 1;
    }
  }

  peek(offset = 0) { return this.tokens[this.pos + offset]; }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  accept(type, value) {
    if (this.at(type, value)) { this.pos += 1; return true; }
    return false;
  }
  expect(type, value) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`expected ${value ?? type}, got ${t.value ?? t.type}`);
    }
    this.pos += 1;
    return t;
  }

  statement() {
    if (this.accept("op", ";")) return;
    if (this.at("kw", "function")) { this.skipFunction(); return; }
    if (this.accept("kw", "local")) {
      if (this.at("kw", "function")) { this.skipFunction(); return; }
      const names = [this.expect("name").value];
      while (this.accept("op", ",")) names.push(this.expect("name").value);
      if (this.accept("op", "=")) {
        const values = this.expressionList();
        names.forEach((name, index) => { this.locals[name] = values[index]; });
      }
      return;
    }
    if (this.accept("kw", "if")) {
      // Data files only use `if fullGame then ... end`. Run the body.
      this.expression();
      this.expect("kw", "then");
      this.block(["end", "else", "elseif"]);
      while (!this.accept("kw", "end")) {
        this.pos += 1;
        this.skipBlockUntil(["end"]);
      }
      return;
    }
    if (this.at("kw", "return")) { this.pos = this.tokens.length - 1; return; }
    if (this.at("kw")) { this.skipBlockStatement(); return; }

    const target = this.prefixTarget();
    if (this.at("op", "=") || this.at("op", ",")) {
      const targets = [target];
      while (this.accept("op", ",")) targets.push(this.prefixTarget());
      this.expect("op", "=");
      const values = this.expressionList();
      targets.forEach((t, index) => this.assign(t, values[index]));
    }
  }

  block(terminators) {
    while (!this.at("eof") && !terminators.some((k) => this.at("kw", k))) this.statement();
  }

  skipBlockUntil(terminators) {
    let depth = 0;
    while (!this.at("eof")) {
      const t = this.peek();
      if (t.type === "kw") {
        if (depth === 0 && terminators.includes(t.value)) return;
        if (BLOCK_OPENERS.has(t.value) || t.value === "while" || t.value === "for") {
          if (t.value !== "while" && t.value !== "for") depth += 1;
        }
        if (t.value === "end" || t.value === "until") depth -= 1;
      }
      this.pos += 1;
    }
  }

  skipFunction() {
    this.expect("kw", "function");
    let depth = 1;
    while (!this.at("eof") && depth > 0) {
      const t = this.peek();
      if (t.type === "kw") {
        if (BLOCK_OPENERS.has(t.value)) depth += 1;
        else if (t.value === "end" || t.value === "until") depth -= 1;
      }
      this.pos += 1;
    }
    return { $expr: "function" };
  }

  skipBlockStatement() {
    const t = this.peek();
    if (BLOCK_OPENERS.has(t.value) || t.value === "while" || t.value === "for") {
      // `while`/`for` open with `do`, which the loop below counts.
      let depth = t.value === "while" || t.value === "for" ? 0 : 1;
      this.pos += 1;
      while (!this.at("eof")) {
        const k = this.peek();
        if (k.type === "kw") {
          if (BLOCK_OPENERS.has(k.value)) depth += 1;
          else if (k.value === "end" || k.value === "until") depth -= 1;
        }
        this.pos += 1;
        if (depth === 0) return;
      }
    } else {
      this.pos += 1;
    }
  }

  // Reads `Name`, `Name.Field`, `Name["x"]` or a call statement.
  prefixTarget() {
    const name = this.expect("name").value;
    const path = [name];
    for (;;) {
      if (this.accept("op", ".")) { path.push(this.expect("name").value); continue; }
      if (this.at("op", "[")) {
        this.pos += 1;
        const key = this.expression();
        this.expect("op", "]");
        path.push(key);
        continue;
      }
      if (this.at("op", "(") || this.at("str") || this.at("op", "{") || this.at("op", ":")) {
        if (this.accept("op", ":")) path.push(this.expect("name").value);
        const args = this.callArgs();
        this.call(path, args);
        continue;
      }
      break;
    }
    return path;
  }

  callArgs() {
    if (this.at("str")) {
      const value = this.peek().value;
      this.pos += 1;
      return [value];
    }
    if (this.at("op", "{")) return [this.table()];
    this.expect("op", "(");
    const args = this.at("op", ")") ? [] : this.expressionList();
    this.expect("op", ")");
    return args;
  }

  call(path, args) {
    const name = path.join(".");
    if (name === "Import" && typeof args[0] === "string" && this.onImport) {
      const saved = { tokens: this.tokens, pos: this.pos, fileName: this.fileName, locals: this.locals };
      this.onImport(args[0]);
      Object.assign(this, saved);
      return { $expr: "Import(...)" };
    }
    if (name === "OverwriteTableKeys" || name === "AddTableKeysCheckDupes") {
      const [target, source] = args;
      if (isTable(target) && isTable(source)) {
        for (const [key, value] of Object.entries(source)) {
          target[key] = value;
          if (target.$origin) this.origins.set(`${target.$origin}.${key}`, this.fileName);
        }
      }
    }
    return { $expr: `${name}(...)` };
  }

  resolve(path) {
    let value = path[0] in this.locals ? this.locals[path[0]] : this.globals[path[0]];
    for (const key of path.slice(1)) {
      if (!isTable(value)) return undefined;
      value = value[key];
    }
    return value;
  }

  assign(path, value) {
    if (path.length === 1) {
      if (path[0] in this.locals) { this.locals[path[0]] = value; return; }
      if (isTable(value) && !value.$origin) {
        Object.defineProperty(value, "$origin", { value: path[0], enumerable: false, writable: true });
      }
      this.globals[path[0]] = value;
      if (isTable(value)) {
        for (const key of Object.keys(value)) this.origins.set(`${path[0]}.${key}`, this.fileName);
      }
      return;
    }
    let parent = path[0] in this.locals ? this.locals[path[0]] : this.globals[path[0]];
    if (!isTable(parent)) {
      parent = {};
      this.globals[path[0]] = parent;
    }
    for (const key of path.slice(1, -1)) {
      if (!isTable(parent[key])) parent[key] = {};
      parent = parent[key];
    }
    parent[path[path.length - 1]] = value;
  }

  expressionList() {
    const values = [this.expression()];
    while (this.accept("op", ",")) values.push(this.expression());
    return values;
  }

  expression(limit = 0) {
    let left;
    const t = this.peek();
    if ((t.type === "kw" && t.value === "not") || (t.type === "op" && (t.value === "-" || t.value === "#"))) {
      this.pos += 1;
      const operand = this.expression(UNARY_PRIORITY);
      if (t.value === "-" && typeof operand === "number") left = -operand;
      else if (t.value === "not") left = typeof operand === "boolean" ? !operand : { $expr: "not" };
      else left = { $expr: t.value };
    } else {
      left = this.simple();
    }
    for (;;) {
      const op = this.peek();
      const priority = (op.type === "op" || op.type === "kw") ? BINARY_PRIORITY[op.value] : undefined;
      if (priority === undefined || priority <= limit) break;
      this.pos += 1;
      // `..` and `^` are right associative.
      const right = this.expression(op.value === ".." || op.value === "^" ? priority - 1 : priority);
      left = binary(op.value, left, right);
    }
    return left;
  }

  simple() {
    const t = this.peek();
    if (t.type === "num" || t.type === "str") { this.pos += 1; return t.value; }
    if (t.type === "kw") {
      if (t.value === "true") { this.pos += 1; return true; }
      if (t.value === "false") { this.pos += 1; return false; }
      if (t.value === "nil") { this.pos += 1; return null; }
      if (t.value === "function") return this.skipFunction();
    }
    if (t.type === "op" && t.value === "{") return this.table();
    if (t.type === "op" && t.value === "...") { this.pos += 1; return { $expr: "..." }; }
    return this.suffixed();
  }

  suffixed() {
    let value;
    let path = null;
    if (this.accept("op", "(")) {
      value = this.expression();
      this.expect("op", ")");
    } else {
      const name = this.expect("name").value;
      path = [name];
      value = this.resolve(path);
    }
    for (;;) {
      if (this.accept("op", ".")) {
        const key = this.expect("name").value;
        if (path) path.push(key);
        value = isTable(value) ? value[key] : undefined;
        continue;
      }
      if (this.at("op", "[")) {
        this.pos += 1;
        const key = this.expression();
        this.expect("op", "]");
        if (path) path.push(String(key));
        value = isTable(value) ? value[key] : undefined;
        continue;
      }
      if (this.at("op", ":") || this.at("op", "(") || this.at("str") || this.at("op", "{")) {
        if (this.accept("op", ":")) {
          const method = this.expect("name").value;
          if (path) path.push(method);
        }
        const args = this.callArgs();
        value = this.call(path || ["(expr)"], args);
        path = null;
        continue;
      }
      break;
    }
    if (value === undefined && path) return { $ref: path.join(".") };
    return value;
  }

  table() {
    this.expect("op", "{");
    const result = {};
    let index = 1;
    while (!this.accept("op", "}")) {
      if (this.at("op", "[")) {
        this.pos += 1;
        const key = this.expression();
        this.expect("op", "]");
        this.expect("op", "=");
        result[key] = this.expression();
      } else if (this.at("name") && this.peek(1).type === "op" && this.peek(1).value === "=") {
        const key = this.expect("name").value;
        this.pos += 1;
        result[key] = this.expression();
      } else {
        result[index] = this.expression();
        index += 1;
      }
      if (!this.accept("op", ",")) this.accept("op", ";");
    }
    return result;
  }
}

function isTable(value) {
  return value !== null && typeof value === "object" && !("$expr" in value) && !("$ref" in value);
}

function binary(op, left, right) {
  const numbers = typeof left === "number" && typeof right === "number";
  switch (op) {
    case "+": return numbers ? left + right : { $expr: op };
    case "-": return numbers ? left - right : { $expr: op };
    case "*": return numbers ? left * right : { $expr: op };
    case "/": return numbers ? left / right : { $expr: op };
    case "..": return (typeof left === "string" || typeof left === "number")
      && (typeof right === "string" || typeof right === "number") ? `${left}${right}` : { $expr: op };
    case "or": return left === null || left === false || (left && left.$ref) ? right : left;
    case "and": return left === null || left === false ? left : right;
    default: return { $expr: op };
  }
}

// Lua tables with keys 1..n as a plain array, other tables as-is.
function list(value) {
  if (!isTable(value)) return [];
  const out = [];
  for (let i = 1; i in value; i += 1) out.push(value[i]);
  return out;
}

// Applies InheritFrom chains inside one data table, the way the game does.
function inherit(table) {
  const resolved = Object.create(null);
  const visit = (key, seen = new Set()) => {
    if (resolved[key]) return resolved[key];
    const entry = table[key];
    if (!isTable(entry)) return entry;
    if (seen.has(key)) return entry;
    seen.add(key);
    const merged = {};
    for (const parent of list(entry.InheritFrom)) {
      const base = visit(parent, seen);
      if (isTable(base)) Object.assign(merged, base);
    }
    Object.assign(merged, entry);
    delete merged.DebugOnly;
    if ("DebugOnly" in entry) merged.DebugOnly = entry.DebugOnly;
    resolved[key] = merged;
    return merged;
  };
  for (const key of Object.keys(table)) visit(key);
  return resolved;
}

module.exports = { LuaDataReader, tokenize, isTable, list, inherit };
