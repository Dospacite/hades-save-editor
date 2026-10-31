"use strict";

// Compares the Hades II editor catalog with the installed game and the
// example saves, then writes a report of what's missing and why.
//
//   npm run audit-game -- [--game-dir <path>] [--save <file>]... [--no-local-saves] [--out <dir>]

const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, relative, resolve } = require("node:path");
const vm = require("node:vm");
const { extractHades2, STATE } = require("./lib/hades2-extract");
const { findGameDir, saveDirCandidates } = require("./lib/game-paths");
const {
  BUCKETS, GROUPS, ITEM_OVERRIDES, ROOT_RULES, HEADER_RULES, RUN_RULES, ruleForKey,
} = require("./lib/hades2-rules");

const projectRoot = resolve(__dirname, "..");
const SAVE = "save_data.luabin.0";

function parseArgs(argv) {
  const args = { saves: [], localSaves: true, out: join(projectRoot, "reports") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--game-dir") args.gameDir = argv[++i];
    else if (arg === "--save") args.saves.push(argv[++i]);
    else if (arg === "--no-local-saves") args.localSaves = false;
    else if (arg === "--out") args.out = resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadBrowserScripts(files) {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(readFileSync(join(projectRoot, file), "utf8"), context, { filename: file });
  }
  return context;
}

function readSaves(paths, codec) {
  const saves = [];
  for (const path of paths) {
    try {
      const document = codec.decode(readFileSync(path));
      if (document.game !== "hades2") continue;
      saves.push({ path, header: document.save_data, root: document.save_data.luabin[0] });
    } catch (error) {
      console.warn(`Skipped ${path}: ${error.message}`);
    }
  }
  return saves;
}

function getAtPath(root, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), root);
}

function describe(value) {
  if (value === undefined) return "absent";
  if (value === null) return "nil";
  if (Array.isArray(value)) return `list(${value.length})`;
  if (typeof value === "object") return `table(${Object.keys(value).length})`;
  return typeof value;
}

// Every path the editor writes, including effects of a field.
// The Advanced tab lists keys for search only; it doesn't count as a field.
function catalogPaths(catalog) {
  const fields = catalog.sections
    .filter((section) => section.layout !== "explorer")
    .flatMap((section) => [...(section.toolbar || []), ...section.fields]
      .map((field) => ({ ...field, section: section.id })));
  const written = new Map();
  for (const field of fields) {
    const own = field.levels ? field.levels.flat() : [field.path];
    for (const path of own) if (!written.has(path)) written.set(path, field);
    for (const effect of field.effects || []) {
      if (!written.has(effect.path)) written.set(effect.path, { ...field, viaEffect: true });
    }
  }
  const hasExplorer = catalog.sections.some((section) => section.layout === "explorer");
  return { fields, written, hasExplorer };
}

function isWritten(written, path) {
  if (written.has(path)) return true;
  for (const key of written.keys()) {
    if (path.startsWith(`${key}.`)) return true;
  }
  return false;
}

function normalizeLabel(label) {
  return String(label || "")
    .replace(/\s+—\s+.*$/, "")
    .replace(/[’']/g, "'")
    .toLowerCase()
    .trim();
}

function buildAudit({ game, catalog, saves }) {
  const { fields, written, hasExplorer } = catalogPaths(catalog);
  const saveValue = (path) => saves.map((save) => getAtPath({ save_data: { luabin: [save.root] } }, path));
  const seenIn = (path) => saveValue(path).filter((value) => value !== undefined && value !== null && value !== false && value !== 0).length;

  // Entities, with editor coverage.
  const groups = new Map();
  for (const entity of game.entities) {
    const covered = entity.paths.some((path) => written.has(path));
    entity.inEditor = covered;
    entity.seenInSaves = seenIn(entity.paths[0]);
    if (!groups.has(entity.group)) groups.set(entity.group, []);
    groups.get(entity.group).push(entity);
  }

  const missing = [];
  for (const [group, entities] of groups) {
    const rule = GROUPS[group] || { label: group, bucket: 3, reason: "No rule for this group." };
    const inEditor = entities.filter((e) => e.inEditor).length;
    for (const entity of entities) {
      if (entity.inEditor) continue;
      let bucket = rule.bucket;
      let reason = rule.reason;
      if (ITEM_OVERRIDES[entity.key]) {
        ({ bucket, reason } = ITEM_OVERRIDES[entity.key]);
      } else if (group === "resources" && !entity.inDisplayOrder) {
        bucket = 3;
        reason = "Not in the inventory display order, so the game doesn't show it either.";
      }
      missing.push({ ...entity, bucket, reason, groupLabel: rule.label, groupInEditor: inEditor, groupSize: entities.length });
    }
  }

  // Problems with fields that are already in the editor.
  const problems = [];
  const entityByPath = new Map();
  for (const entity of game.entities) for (const path of entity.paths) {
    if (!entityByPath.has(path)) entityByPath.set(path, entity);
  }

  // Ladder fields are checked once per level, by the level's main path.
  const checks = fields.flatMap((field) => (field.levels
    ? field.levels.map((paths, index) => ({ ...field, path: paths[0], levelIndex: index }))
    : [field]));
  for (const field of checks) {
    if (!field.path.startsWith(`${STATE}.`)) continue;
    const [table, key] = field.path.slice(STATE.length + 1).split(".");
    const entity = entityByPath.get(field.path);

    if (key && !entity && !game.references.allSource.includes(`"${key}"`) && !game.references.allSource.includes(`.${key}`) && !game.references.allSource.includes(`${key} =`)) {
      problems.push({ kind: "stale", field, detail: `\`${table}.${key}\` isn't defined or used anywhere in the game scripts.` });
    }
    for (const effect of field.effects || []) {
      const effectKey = effect.path.split(".").pop();
      if (!game.references.allSource.includes(effectKey)) {
        problems.push({ kind: "stale", field, detail: `Effect writes \`${effect.path.replace(`${STATE}.`, "")}\`, but \`${effectKey}\` isn't in the game scripts.` });
      }
    }

    if (entity) {
      // Badges all share one path, so their names never match one field.
      if (!field.levelIndex && entity.group !== "badges" && entity.name && normalizeLabel(entity.name) !== normalizeLabel(field.label)) {
        problems.push({ kind: "label", field, detail: `Editor says "${field.label}", the game says "${entity.name}".` });
      }
      const missingPaths = entity.paths.filter((path) =>
        path !== `${STATE}.TextLinesRecord` && !isWritten(written, path));
      if (missingPaths.length) {
        const notes = missingPaths.map((path) => {
          const [otherTable, otherKey] = path.slice(STATE.length + 1).split(".");
          const reads = game.references.keys.GameState.get(`${otherTable}.${otherKey}`);
          const dynamic = game.references.dynamicReads.GameState.get(otherTable);
          const how = reads ? "read" : dynamic ? "by variable" : "";
          const note = reads
            ? ` (**read** in ${[...reads.files].join(", ")})`
            : dynamic ? " (read by variable)" : "";
          return { how, text: `\`${otherTable}.${otherKey}\`${note}` };
        });
        const strongest = notes.some((n) => n.how === "read") ? "read" : notes.some((n) => n.how) ? "by variable" : "";
        problems.push({
          kind: "partial",
          field,
          detail: `The game also sets ${notes.map((n) => n.text).join(", ")}.`,
          gameReads: strongest,
        });
      }
      if (entity.group === "arcana") {
        if (entity.grasp !== field.grasp) problems.push({ kind: "data", field, detail: `Grasp cost is ${entity.grasp} in the game, ${field.grasp} in the editor.` });
        if (entity.position !== field.position) problems.push({ kind: "data", field, detail: `Board position is ${entity.position} in the game, ${field.position} in the editor.` });
        if (entity.image && !field.icon.includes(`card${entity.image}.`)) problems.push({ kind: "data", field, detail: `Card art is CardArt_${entity.image} in the game, ${field.icon} in the editor.` });
      }
      if (entity.group === "hiddenAspects" && entity.textLine) {
        const lines = (field.effects || []).map((effect) => effect.path.split(".").pop());
        if (!lines.includes(entity.textLine)) {
          problems.push({ kind: "data", field, detail: `The game unlocks this aspect after \`${entity.textLine}\`, the editor sets ${lines.join(", ") || "nothing"}.` });
        }
      }
    }
  }

  // Order of editor items compared with the game's own order.
  for (const group of ["keepsakes", "arcana"]) {
    const gameOrder = (groups.get(group) || []).filter((e) => e.inEditor).sort((a, b) => a.order - b.order).map((e) => e.key);
    const editorOrder = fields.filter((f) => entityByPath.get(f.path)?.group === group).map((f) => entityByPath.get(f.path).key);
    if (gameOrder.join() !== editorOrder.join()) {
      problems.push({ kind: "order", field: { label: GROUPS[group].label, path: group }, detail: "The editor lists these in a different order from the game." });
    }
  }

  // GameState keys the editor doesn't cover and no entity group explains.
  const gameStateKeys = new Set([
    ...game.references.tables.GameState.keys(),
    ...saves.flatMap((save) => Object.keys(save.root.GameState || {})),
  ]);
  const stateKeys = [];
  for (const key of [...gameStateKeys].sort()) {
    const path = `${STATE}.${key}`;
    const refs = game.references.tables.GameState.get(key);
    const values = saves.map((save) => save.root.GameState?.[key]);
    const rule = ruleForKey(key);
    const covered = isWritten(written, path) || [...written.keys()].some((p) => p.startsWith(`${path}.`));
    stateKeys.push({
      key,
      path,
      covered,
      scriptRefs: refs?.count || 0,
      scriptFiles: refs ? refs.files.size : 0,
      inSaves: values.filter((value) => value !== undefined).length,
      type: describe(values.find((value) => value !== undefined)),
      group: rule?.group || null,
      bucket: rule?.group ? 0 : rule ? rule.bucket : (refs ? 3 : 5),
      reason: rule?.reason || (refs ? "No rule yet. Defaulted to \"not needed\"." : "No rule yet. No script reads it."),
      ruled: Boolean(rule && !rule.pattern),
      unruled: !rule,
    });
  }

  // Keys inside entity tables that the saves have but the game no longer defines.
  const legacyKeys = [];
  const entityKeysByTable = new Map();
  for (const entity of game.entities) for (const path of entity.paths) {
    const [table, key] = path.slice(STATE.length + 1).split(".");
    if (!key) continue;
    if (!entityKeysByTable.has(table)) entityKeysByTable.set(table, new Set());
    entityKeysByTable.get(table).add(key);
  }
  for (const table of ["Resources", "KeepsakeChambers", "MetaUpgradeState", "ShrineUpgrades", "FamiliarsUnlocked", "FamiliarUpgrades", "QuestStatus"]) {
    const known = entityKeysByTable.get(table) || new Set();
    const seen = new Set(saves.flatMap((save) => Object.keys(save.root.GameState?.[table] || {})));
    for (const key of seen) {
      if (known.has(key)) continue;
      const usedInScripts = game.references.allSource.includes(key);
      legacyKeys.push({ table, key, usedInScripts, inEditor: written.has(`${STATE}.${table}.${key}`) });
    }
  }

  const rootKeys = [...new Set(saves.flatMap((save) => Object.keys(save.root)))].sort().map((key) => {
    const rule = ROOT_RULES[key] || { bucket: 3, reason: "No rule yet." };
    return { key, path: `${SAVE}.${key}`, covered: isWritten(written, `${SAVE}.${key}`) || [...written.keys()].some((p) => p.startsWith(`${SAVE}.${key}.`)), ...rule };
  });
  const headerKeys = [...new Set(saves.flatMap((save) => Object.keys(save.header)))].map((key) => {
    const rule = HEADER_RULES[key] || { bucket: 3, reason: "No rule yet." };
    return { key, path: `save_data.${key}`, covered: written.has(`save_data.${key}`), ...rule };
  });

  // CurrentRun: top-level scalars and Hero scalars.
  const runKeys = new Map();
  for (const save of saves) {
    const run = save.root.CurrentRun || {};
    for (const [key, value] of Object.entries(run)) {
      if (key === "Hero") continue;
      if (!runKeys.has(key)) runKeys.set(key, { key, type: describe(value) });
    }
    for (const [key, value] of Object.entries(run.Hero || {})) {
      const name = `Hero.${key}`;
      if (!runKeys.has(name)) runKeys.set(name, { key: name, type: describe(value) });
    }
  }
  const runRows = [...runKeys.values()].sort((a, b) => a.key.localeCompare(b.key)).map((row) => {
    const path = `${SAVE}.CurrentRun.${row.key}`;
    const rule = RUN_RULES[row.key];
    return {
      ...row,
      path,
      covered: written.has(path),
      bucket: rule ? rule.bucket : 5,
      reason: rule?.reason || "Run engine state. Rebuilt or overwritten while you play.",
    };
  });

  return { fields, groups, missing, problems, stateKeys, legacyKeys, rootKeys, headerKeys, runRows, hasExplorer };
}

// ---------- Markdown ----------

const code = (text) => `\`${text}\``;
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(headers, rows) {
  if (!rows.length) return "_None._\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n") + "\n";
}

function collapsible(summary, body, open) {
  return `<details${open ? " open" : ""}>\n<summary>${summary}</summary>\n\n${body}\n</details>\n`;
}

function renderReport(audit, context) {
  const { missing, problems, stateKeys, legacyKeys, rootKeys, headerKeys, runRows, groups } = audit;
  const out = [];
  const push = (...lines) => out.push(...lines);

  push("# Hades II save editor audit", "");
  push(`Generated ${context.date} by \`npm run audit-game\`. Don't edit by hand; rerun the script.`, "");
  push(`- Game: ${code(context.gameDir)} (${context.scriptsLoaded} Lua files read, ${context.warnings} parse warnings)`);
  push(`- Saves read: ${context.saves.length ? context.saves.map((s) => code(s)).join(", ") : "none"}`);
  push(`- Editor fields for Hades II: ${audit.fields.length}`);
  push("");
  if (audit.hasExplorer) {
    push("Every value in a save can be edited in the Advanced tab. The buckets below list what has no dedicated field.", "");
  }

  push("## Coverage", "");
  push(table(
    ["Group", "In editor", "In game", "Bucket if missing"],
    [...groups.entries()].map(([group, entities]) => [
      GROUPS[group]?.label || group,
      entities.filter((e) => e.inEditor).length,
      entities.length,
      GROUPS[group]?.bucket ?? "?",
    ]),
  ));

  const counts = Object.keys(BUCKETS).map((bucket) => {
    const items = missing.filter((m) => m.bucket === Number(bucket)).length;
    const keys = stateKeys.filter((k) => !k.covered && k.bucket === Number(bucket)).length;
    return [`${bucket}. ${BUCKETS[bucket]}`, items, keys];
  });
  push(table(["Bucket", "Items", "Save keys"], counts));

  push("## Problems in fields the editor already has", "");
  push("These aren't missing items. They're existing fields that are out of date or write less than the game does.", "");
  const kinds = {
    partial: "Writes only part of what the game sets",
    stale: "Points at something the game no longer has",
    data: "Data differs from the game",
    label: "Label differs from the game's English name",
    order: "Order differs from the game",
  };
  if (!problems.length) push("None found.", "");
  for (const [kind, title] of Object.entries(kinds)) {
    const rows = problems.filter((p) => p.kind === kind);
    if (!rows.length) continue;
    push(`### ${title}`, "");
    if (kind === "partial") {
      push("**read** means the game checks this exact key, so the field probably doesn't fully work today. \"by variable\" means the game reads the table with a computed key, which likely includes this one.", "");
    }
    push(table(
      ["Field", "Path", kind === "partial" ? "Game reads it" : "", "Detail"].filter(Boolean),
      rows.map((p) => [p.field.label, code(String(p.field.path).replace(`${STATE}.`, "")), ...(kind === "partial" ? [p.gameReads === "read" ? "**read**" : p.gameReads] : []), p.detail]),
    ));
  }

  for (const bucket of Object.keys(BUCKETS).map(Number)) {
    push(`## ${bucket}. ${BUCKETS[bucket]}`, "");
    const items = missing.filter((m) => m.bucket === bucket);
    const byGroup = new Map();
    for (const item of items) {
      if (!byGroup.has(item.group)) byGroup.set(item.group, []);
      byGroup.get(item.group).push(item);
    }
    if (!items.length) {
      push(bucket === 1
        ? `Every group the editor already lists is complete.${problems.length ? " Fields that are out of date are listed under \"Problems in fields the editor already has\" above." : ""}`
        : "No game items in this bucket.", "");
    }
    for (const [group, list] of byGroup) {
      const first = list[0];
      const heading = `${first.groupLabel}: ${list.length} missing (editor has ${first.groupInEditor} of ${first.groupSize})`;
      const reasons = [...new Set(list.map((item) => item.reason))];
      const body = `${reasons.join(" ")}\n\n${table(
        ["Key", "Name", "Save path", "Set in saves"],
        list.map((item) => [code(item.key), item.name || "", code(item.paths[0].replace(`${SAVE}.`, "")), `${item.seenInSaves}/${context.saves.length}`]),
      )}`;
      push(`### ${heading}`, "");
      push(list.length > 30 ? collapsible(`Show ${list.length} items`, body, false) : body);
    }

    const keys = stateKeys.filter((k) => !k.covered && k.bucket === bucket);
    if (keys.length) {
      push(`### GameState keys`, "");
      const body = table(
        ["Key", "Type", "Script refs", "In saves", "Why"],
        keys.map((k) => [code(k.key), k.type, `${k.scriptRefs} in ${k.scriptFiles} files`, `${k.inSaves}/${context.saves.length}`, k.unruled ? `_${k.reason}_` : k.reason]),
      );
      push(keys.length > 30 ? collapsible(`Show ${keys.length} keys`, body, false) : body);
    }

    const roots = [...rootKeys, ...headerKeys].filter((k) => !k.covered && k.bucket === bucket);
    if (roots.length) {
      push("### Save root and header", "");
      push(table(["Path", "Why"], roots.map((k) => [code(k.path), k.reason])));
    }

    const runs = runRows.filter((r) => !r.covered && r.bucket === bucket && RUN_RULES[r.key]);
    if (runs.length) {
      push("### Current run", "");
      push(table(["Path", "Type", "Why"], runs.map((r) => [code(`CurrentRun.${r.key}`), r.type, r.reason])));
    }
    if (bucket === 5) {
      const rest = runRows.filter((r) => !r.covered && !RUN_RULES[r.key]);
      push("### Current run engine state", "");
      push(`${rest.length} other \`CurrentRun\` keys hold engine state the game rebuilds while you play.`, "");
      push(collapsible(`Show ${rest.length} keys`, rest.map((r) => code(r.key)).join(", "), false));
    }
  }

  push("## Keys in the saves that the game no longer defines", "");
  push("The editor must keep these on a round trip. They're listed so nobody adds them as fields.", "");
  push(table(
    ["Table", "Key", "Still named in scripts", "In editor"],
    legacyKeys.map((k) => [k.table, code(k.key), k.usedInScripts ? "yes" : "no", k.inEditor ? "**yes**" : ""]),
  ));

  push("## GameState keys with no rule yet", "");
  push("These were sorted by a fallback. Add a rule in `scripts/lib/hades2-rules.js` to place them for good.", "");
  push(table(["Key", "Type", "Script refs", "Placed in"], stateKeys.filter((k) => k.unruled).map((k) => [code(k.key), k.type, k.scriptRefs, k.bucket])));

  push("## Already in the editor", "");
  push(table(
    ["GameState key", "Type", "Script refs"],
    stateKeys.filter((k) => k.covered).map((k) => [code(k.key), k.type, k.scriptRefs]),
  ));

  return out.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run audit-game -- [--game-dir <path>] [--save <file>]... [--no-local-saves] [--out <dir>]");
    return;
  }

  const gameDir = args.gameDir || findGameDir();
  if (!gameDir) throw new Error("Couldn't find Hades II. Pass --game-dir or set HADES2_DIR.");

  let savePaths = args.saves;
  if (!savePaths.length) {
    const dirs = saveDirCandidates().slice(0, args.localSaves ? undefined : 1);
    savePaths = dirs.filter(existsSync).flatMap((dir) => readdirSync(dir)
      .filter((file) => /^Profile\d+\.sav$/.test(file))
      .sort()
      .map((file) => join(dir, file)));
  }

  const codec = loadBrowserScripts(["public/js/adler32.js", "public/js/lz4.js", "public/js/save-codec.js"]).HadesSaveCodec;
  const catalog = loadBrowserScripts(["public/js/hades2-game-data.js", "public/js/editor-data.js"]).HadesEditorCatalog.hades2;
  const saves = readSaves(savePaths, codec);
  const game = extractHades2(gameDir);
  const audit = buildAudit({ game, catalog, saves });

  const context = {
    date: new Date().toISOString().slice(0, 10),
    gameDir,
    scriptsLoaded: game.scriptsLoaded,
    warnings: game.warnings.length,
    saves: saves.map((save) => relative(projectRoot, save.path).startsWith("..") ? save.path.replace(homedir(), "~") : relative(projectRoot, save.path)),
  };

  mkdirSync(args.out, { recursive: true });
  const reportPath = join(args.out, "hades2-audit.md");
  const dataPath = join(args.out, "hades2-game-data.json");
  writeFileSync(reportPath, `${renderReport(audit, context)}\n`);
  writeFileSync(dataPath, `${JSON.stringify({
    generated: context.date,
    gameDir,
    warnings: game.warnings,
    entities: game.entities,
    missing: audit.missing.map(({ group, key, name, paths, bucket, reason }) => ({ group, key, name, paths, bucket, reason })),
    problems: audit.problems.map((p) => ({ kind: p.kind, label: p.field.label, path: p.field.path, detail: p.detail })),
    gameStateKeys: audit.stateKeys,
    legacyKeys: audit.legacyKeys,
  }, null, 2)}\n`);

  const total = (bucket) => audit.missing.filter((m) => m.bucket === bucket).length
    + audit.stateKeys.filter((k) => !k.covered && k.bucket === bucket).length;
  console.log(`Read ${game.scriptsLoaded} Lua files and ${saves.length} saves.`);
  console.log(`${audit.problems.length} problems in existing fields.`);
  for (const bucket of Object.keys(BUCKETS).map(Number)) console.log(`  ${bucket}. ${BUCKETS[bucket]}: ${total(bucket)}`);
  console.log(`Wrote ${relative(process.cwd(), reportPath)} and ${relative(process.cwd(), dataPath)}.`);
}

main();
