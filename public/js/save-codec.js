/* Browser save codec. ADLER32 and require are provided by the vendored codecs. */
/* global ADLER32, require */

// Layouts come from the games' own load code:
//   Hades     EngineWin64s.dll  sgg::ProgressManager::Restore / GetSaveInfo (versions 1-16)
//   Hades II  Hades2.exe        sgg::ProgressManager::Restore / GetSaveInfo (versions 17-18)
// See save-file-work/notes/SCHEMA.md for the evidence.

(function attachSaveCodec(global) {
  "use strict";

  const Buffer = require("buffer").Buffer;
  const LZ4 = require("lz4");
  const SIGNATURE = "SGB1";
  const SAVE_VERSION_MASK = 0xffff;

  // What each game accepts and writes.
  //   maxLuaSize: size of the buffer the game decompresses the Lua state into.
  //   compressedAbove: the Lua state is LZ4-compressed when version > this.
  const GAMES = Object.freeze({
    hades: Object.freeze({ minVersion: 1, maxVersion: 16, maxLuaSize: 0x8f4000, compressedAbove: 14, versionFlags: false }),
    hades2: Object.freeze({ minVersion: 17, maxVersion: 18, maxLuaSize: 0x9ec000, compressedAbove: 14, versionFlags: true }),
  });
  const MAX_READ_LUA_SIZE = 256 * 1024 * 1024;

  // Lua tables decode to plain objects. These hidden properties keep what
  // plain objects lose: string keys that look like numbers ("1" is not 1 in
  // Lua), and string keys that share a name with a number key.
  const STRING_KEYS = Symbol.for("hades-save-editor.luaStringKeys");
  const SHADOWED_STRING_KEYS = Symbol.for("hades-save-editor.luaShadowedStringKeys");

  class SaveFormatError extends Error {
    constructor(message) {
      super(message);
      this.name = "SaveFormatError";
    }
  }

  function gameForVersion(version) {
    return Object.keys(GAMES).find((game) =>
      version >= GAMES[game].minVersion && version <= GAMES[game].maxVersion);
  }

  // Header fields in file order, for one game and version.
  // Types: i32, i64, u8, string, strings (int32 count + strings).
  function headerLayout(game, version) {
    const fields = [];
    const add = (name, type) => fields.push([name, type]);

    if (game === "hades2") {
      add("timestamp", "i64");
      add("location", "string");
      add("runs", "i32");                     // GameState.CompletedRunsCache
      add("accumulated_meta_points", "i32");  // always 0 in Hades II
      add("active_shrine_points", "i32");     // GameState.SpentShrinePointsCache (Fear)
      add("meta_upgrade_level", "i32");       // GameState.MaxMetaUpgradeCostCache (Grasp)
      if (version >= 18) add("cosmetics_points", "i32"); // LifetimeResourcesGained.CosmeticsPoints
      add("easy_mode", "u8");                 // God Mode setting when saved
      add("hard_mode", "u8");                 // always 0 in Hades II
      add("notable_lua_data", "strings");
      add("current_map", "string");
      add("start_next_map", "string");
      return fields;
    }

    // Hades. Field names for versions before 10 are unknown; the game reads
    // and discards them.
    if (version >= 16) add("timestamp", "i64");
    if (version >= 11) add("location", "string");
    if (version >= 10) {
      add("runs", "i32");                     // GameState.CompletedRunsCache
      add("accumulated_meta_points", "i32");  // GameState.AccumulatedMetaPointsCache (Darkness)
      if (version >= 12 && version < 14) add("legacy_int_1", "i32");
      if (version >= 14) {
        add("active_shrine_points", "i32");   // GameState.SpentShrinePointsCache (Heat)
        add("easy_mode", "u8");               // God Mode setting when saved
        add("hard_mode", "u8");               // GameState.Flags.HardMode (Hell Mode)
      }
      if (version >= 13) add("notable_lua_data", "strings");
    } else {
      add("legacy_string_1", "string");
      add("legacy_string_2", "string");
      if (version >= 5) add("legacy_string_3", "string");
      add("legacy_int_1", "i32");
      add("legacy_int_2", "i32");
      if (version >= 2) {
        add("legacy_int_3", "i32");
        add("legacy_int_4", "i32");
      }
      if (version >= 7) add("legacy_flag", "u8");
    }
    if (version >= 6 && version <= 12) {
      add("legacy_int_5", "i32");
      add("legacy_int_6", "i32");
    }
    add("current_map", "string");
    add("start_next_map", "string");
    return fields;
  }

  class BinaryReader {
    constructor(buffer, offset = 0) {
      this.buffer = buffer;
      this.offset = offset;
    }

    get remaining() {
      return this.buffer.length - this.offset;
    }

    ensure(size, label) {
      if (size < 0 || this.offset + size > this.buffer.length) {
        throw new SaveFormatError(`Unexpected end of file while reading ${label}.`);
      }
    }

    readUInt8(label = "byte") {
      this.ensure(1, label);
      return this.buffer.readUInt8(this.offset++);
    }

    readInt32(label = "integer") {
      this.ensure(4, label);
      const value = this.buffer.readInt32LE(this.offset);
      this.offset += 4;
      return value;
    }

    readUInt32(label = "integer") {
      this.ensure(4, label);
      const value = this.buffer.readUInt32LE(this.offset);
      this.offset += 4;
      return value;
    }

    // The vendored Buffer has no BigInt methods: read two halves.
    readInt64(label = "64-bit integer") {
      this.ensure(8, label);
      const low = this.buffer.readUInt32LE(this.offset);
      const high = this.buffer.readInt32LE(this.offset + 4);
      this.offset += 8;
      const value = high * 0x100000000 + low;
      if (!Number.isSafeInteger(value)) throw new SaveFormatError(`${label} is too large to edit safely.`);
      return value;
    }

    readDouble(label = "number") {
      this.ensure(8, label);
      const value = this.buffer.readDoubleLE(this.offset);
      this.offset += 8;
      return value;
    }

    readBytes(size, label = "data") {
      this.ensure(size, label);
      const value = this.buffer.slice(this.offset, this.offset + size);
      this.offset += size;
      return value;
    }

    readByteString(label = "string") {
      const size = this.readInt32(`${label} length`);
      if (size < 0) throw new SaveFormatError(`Invalid ${label} length.`);
      return this.readBytes(size, label);
    }

    readString(label = "string") {
      return decodeText(this.readByteString(label), label);
    }

    readStringArray(label) {
      const size = this.readInt32(`${label} count`);
      if (size < 0 || size > 100000) throw new SaveFormatError(`Invalid ${label} count.`);
      const values = [];
      for (let index = 0; index < size; index += 1) values.push(this.readString(`${label} item`));
      return values;
    }
  }

  // Lua strings are bytes. Refuse text that would not survive a round trip
  // instead of changing it silently.
  function decodeText(bytes, label) {
    const text = bytes.toString("utf8");
    if (!sameBytes(Buffer.from(text, "utf8"), bytes)) {
      throw new SaveFormatError(`The save has ${label} text that is not valid UTF-8, so it can't be edited safely.`);
    }
    return text;
  }

  function sameBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
    return true;
  }

  class BinaryWriter {
    constructor(initialSize = 1024) {
      this.buffer = Buffer.alloc(Math.max(64, initialSize));
      this.offset = 0;
    }

    ensure(size) {
      const required = this.offset + size;
      if (required <= this.buffer.length) return;
      let capacity = this.buffer.length;
      while (capacity < required) capacity *= 2;
      const next = Buffer.alloc(capacity);
      this.buffer.copy(next, 0, 0, this.offset);
      this.buffer = next;
    }

    writeUInt8(value) {
      this.ensure(1);
      this.buffer.writeUInt8(Number(value) & 0xff, this.offset);
      this.offset += 1;
    }

    writeInt32(value) {
      this.ensure(4);
      this.buffer.writeInt32LE(Number(value) | 0, this.offset);
      this.offset += 4;
    }

    writeUInt32(value) {
      this.ensure(4);
      this.buffer.writeUInt32LE(Number(value) >>> 0, this.offset);
      this.offset += 4;
    }

    writeInt64(value) {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new SaveFormatError("The save timestamp is invalid.");
      const high = Math.floor(number / 0x100000000);
      this.ensure(8);
      this.buffer.writeUInt32LE(number - high * 0x100000000, this.offset);
      this.buffer.writeInt32LE(high, this.offset + 4);
      this.offset += 8;
    }

    writeDouble(value) {
      this.ensure(8);
      this.buffer.writeDoubleLE(Number(value), this.offset);
      this.offset += 8;
    }

    writeBytes(value) {
      const bytes = Buffer.from(value);
      this.ensure(bytes.length);
      bytes.copy(this.buffer, this.offset);
      this.offset += bytes.length;
    }

    writeByteString(bytes) {
      this.writeInt32(bytes.length);
      this.writeBytes(bytes);
    }

    writeString(value) {
      this.writeByteString(Buffer.from(String(value), "utf8"));
    }

    writeStringArray(values) {
      this.writeInt32(values.length);
      values.forEach((value) => this.writeString(value));
    }

    finish() {
      return this.buffer.slice(0, this.offset);
    }
  }

  // ---------- Luabins 0.3 (save_value / load_value in the game) ----------

  const TAG = Object.freeze({ NIL: 0x2d, FALSE: 0x30, TRUE: 0x31, NUMBER: 0x4e, STRING: 0x53, TABLE: 0x54 });

  function looksNumeric(key) {
    return key !== "" && Number.isFinite(Number(key)) && String(Number(key)) === key;
  }

  class LuaReader extends BinaryReader {
    readDocument() {
      const count = this.readUInt8("Lua root value count");
      const values = [];
      for (let index = 0; index < count; index += 1) values.push(this.readTaggedValue());
      if (this.remaining !== 0) throw new SaveFormatError("The embedded Lua data has unexpected trailing bytes.");
      return values;
    }

    readTaggedValue() {
      return this.readValue(this.readUInt8("Lua value type"));
    }

    readValue(type) {
      switch (type) {
        case TAG.NIL: return null;
        case TAG.FALSE: return false;
        case TAG.TRUE: return true;
        case TAG.NUMBER: return this.readDouble("Lua number");
        case TAG.STRING: return this.readString("Lua string");
        case TAG.TABLE: return this.readTable();
        default: throw new SaveFormatError(`Unsupported Lua value type ${type}.`);
      }
    }

    readTable() {
      const arraySize = this.readInt32("Lua table array size");
      const hashSize = this.readInt32("Lua table hash size");
      const size = arraySize + hashSize;
      if (arraySize < 0 || hashSize < 0 || size > 10000000) throw new SaveFormatError("Invalid Lua table size.");

      const table = Object.create(null);
      const numberNames = new Set();
      for (let index = 0; index < size; index += 1) {
        const keyType = this.readUInt8("Lua key type");
        if (keyType !== TAG.NUMBER && keyType !== TAG.STRING) {
          throw new SaveFormatError("The save has a Lua table key this editor can't keep (only text and number keys are supported).");
        }
        const key = this.readValue(keyType);
        const value = this.readTaggedValue();
        if (keyType === TAG.NUMBER) {
          if (!Number.isFinite(key)) throw new SaveFormatError("Invalid Lua table key.");
          const name = String(key);
          if (name in table && !numberNames.has(name)) shadowStringKey(table, name);
          numberNames.add(name);
          table[name] = value;
        } else if (numberNames.has(key)) {
          // A string key with the same name as a number key already read.
          stringKeyStore(table, SHADOWED_STRING_KEYS, () => new Map()).set(key, value);
        } else {
          if (looksNumeric(key)) stringKeyStore(table, STRING_KEYS, () => new Set()).add(key);
          table[key] = value;
        }
      }
      return table;
    }
  }

  function stringKeyStore(table, symbol, create) {
    if (!table[symbol]) Object.defineProperty(table, symbol, { value: create(), enumerable: false });
    return table[symbol];
  }

  // A numeric-looking string key was read first, then a number key with the
  // same name. Move the string entry aside.
  function shadowStringKey(table, name) {
    stringKeyStore(table, SHADOWED_STRING_KEYS, () => new Map()).set(name, table[name]);
    table[STRING_KEYS]?.delete(name);
  }

  class LuaWriter extends BinaryWriter {
    writeDocument(values) {
      if (!Array.isArray(values) || values.length > 250) throw new SaveFormatError("Invalid embedded Lua root data.");
      this.writeUInt8(values.length);
      values.forEach((value) => this.writeTaggedValue(value, 0));
      return this.finish();
    }

    writeTaggedValue(value, depth) {
      if (value === null || value === undefined) return this.writeUInt8(TAG.NIL);
      if (value === false) return this.writeUInt8(TAG.FALSE);
      if (value === true) return this.writeUInt8(TAG.TRUE);
      if (typeof value === "number") {
        if (Number.isNaN(value)) throw new SaveFormatError("A value in the save is not a number.");
        this.writeUInt8(TAG.NUMBER);
        return this.writeDouble(value);
      }
      if (typeof value === "string") {
        this.writeUInt8(TAG.STRING);
        return this.writeString(value);
      }
      if (typeof value === "object") return this.writeTable(value, depth + 1);
      throw new SaveFormatError(`Unsupported Lua value: ${String(value)}.`);
    }

    writeTable(table, depth) {
      if (depth > 250) throw new SaveFormatError("The save nests tables deeper than the game allows.");
      const stringKeys = table[STRING_KEYS];
      const shadowed = table[SHADOWED_STRING_KEYS];
      const entries = Object.keys(table).map((key) => [
        looksNumeric(key) && !stringKeys?.has(key) ? Number(key) : key,
        table[key],
      ]);
      shadowed?.forEach((value, key) => entries.push([key, value]));
      const live = entries.filter(([, value]) => value !== undefined);
      const numberCount = live.filter(([key]) => typeof key === "number").length;

      this.writeUInt8(TAG.TABLE);
      this.writeInt32(numberCount);
      this.writeInt32(live.length - numberCount);
      live.forEach(([key, value]) => {
        this.writeTaggedValue(key, depth);
        this.writeTaggedValue(value, depth);
      });
    }
  }

  function decompressLua(compressed, limit) {
    const input = Buffer.from(compressed);
    if (input.length === 0) throw new SaveFormatError("The save has no embedded Lua data.");
    let capacity = Math.min(Math.max(64 * 1024, input.length * 8), MAX_READ_LUA_SIZE);
    while (capacity <= MAX_READ_LUA_SIZE) {
      const output = Buffer.alloc(capacity);
      const size = LZ4.decodeBlock(input, output);
      if (size < 0) throw new SaveFormatError("The embedded Lua data is corrupt.");
      if (size < capacity) return output.slice(0, size);
      if (capacity === MAX_READ_LUA_SIZE) break;
      capacity = Math.min(capacity * 2, MAX_READ_LUA_SIZE);
    }
    throw new SaveFormatError(`The embedded Lua data is larger than ${limit} bytes.`);
  }

  function compressLua(luaData) {
    const input = Buffer.from(luaData);
    const capacity = LZ4.encodeBound(input.length);
    if (!capacity) throw new SaveFormatError("The embedded Lua data is too large to save.");
    const output = Buffer.alloc(capacity);
    const size = LZ4.encodeBlock(input, output);
    if (size <= 0) throw new SaveFormatError("The embedded Lua data could not be compressed.");
    return output.slice(0, size);
  }

  // ---------- Container ----------

  function toBuffer(input) {
    return input instanceof ArrayBuffer ? Buffer.from(new Uint8Array(input)) : Buffer.from(input);
  }

  // "SGB1" + checksum + body. Old saves have no magic: checksum + body.
  function readPreamble(source) {
    if (source.length >= 4 && source.slice(0, 4).toString("latin1") === SIGNATURE) {
      const reader = new BinaryReader(source, 4);
      return { container: "sgb1", checksum: reader.readUInt32("checksum"), reader, bodyStart: 8 };
    }
    const reader = new BinaryReader(source, 0);
    return { container: "legacy", checksum: reader.readUInt32("checksum"), reader, bodyStart: 4 };
  }

  function readVersion(reader, container) {
    const rawVersion = reader.readUInt32("save version");
    const version = rawVersion & SAVE_VERSION_MASK;
    const flags = rawVersion - version;
    const game = gameForVersion(version);
    if (!game || (flags && !GAMES[game].versionFlags)) {
      if (container === "legacy") throw new SaveFormatError("This is not a supported Hades save file.");
      const newest = GAMES.hades2.maxVersion;
      throw new SaveFormatError(version > newest
        ? `Save version ${version} is newer than this editor supports.`
        : `Save version ${rawVersion} is not supported.`);
    }
    return { game, version, version_flags: flags };
  }

  function readField(reader, type, label) {
    switch (type) {
      case "i32": return reader.readInt32(label);
      case "i64": return reader.readInt64(label);
      case "u8": return reader.readUInt8(label);
      case "string": return reader.readString(label);
      case "strings": return reader.readStringArray(label);
      default: throw new Error(`Unknown field type ${type}.`);
    }
  }

  function writeField(writer, type, value, name) {
    if (value === undefined || value === null) throw new SaveFormatError(`The save header is missing "${name}".`);
    switch (type) {
      case "i32": return writer.writeInt32(value);
      case "i64": return writer.writeInt64(value);
      case "u8": return writer.writeUInt8(value);
      case "string": return writer.writeString(value);
      case "strings":
        if (!Array.isArray(value)) throw new SaveFormatError(`The save header "${name}" must be a list.`);
        return writer.writeStringArray(value);
      default: throw new Error(`Unknown field type ${type}.`);
    }
  }

  // Reads the outer details only. `bytes` may be just the start of the file.
  // Stops before the first field that does not fit.
  function inspectHeader(input) {
    const source = toBuffer(input);
    const { container, checksum, reader } = readPreamble(source);
    const { game, version, version_flags: versionFlags } = readVersion(reader, container);
    const saveData = { version, version_flags: versionFlags };
    for (const [name, type] of headerLayout(game, version)) {
      if (type === "strings") break;
      try {
        saveData[name] = readField(reader, type, name);
      } catch (error) {
        if (error instanceof SaveFormatError) break;
        throw error;
      }
    }
    return { game, container, checksum, headerSize: reader.offset, save_data: saveData };
  }

  function decode(input) {
    const source = toBuffer(input);
    // Profile<N>.v.sav: "SGB1", version, one flag byte (SaveValidCheckpoint).
    if (source.length === 9 && source.slice(0, 4).toString("latin1") === SIGNATURE) {
      throw new SaveFormatError("This is a checkpoint marker (.v.sav), not a save. Open the matching Profile .sav file.");
    }
    const { container, checksum, reader, bodyStart } = readPreamble(source);
    const calculated = ADLER32.buf(source.slice(bodyStart)) >>> 0;
    if (checksum !== calculated) {
      throw new SaveFormatError(container === "legacy"
        ? "This is not a supported Hades save file."
        : "The save file checksum is invalid.");
    }

    const { game, version, version_flags: versionFlags } = readVersion(reader, container);
    const saveData = { version, version_flags: versionFlags };
    headerLayout(game, version).forEach(([name, type]) => {
      saveData[name] = readField(reader, type, name.replace(/_/g, " "));
    });

    const block = reader.readByteString("Lua data");
    const limits = GAMES[game];
    const luaBuffer = version > limits.compressedAbove ? decompressLua(block, limits.maxLuaSize) : block;
    saveData.luabin = new LuaReader(luaBuffer).readDocument();
    if (reader.remaining !== 0) throw new SaveFormatError("The save file has unexpected trailing data.");

    return { game, container, checksum, sourceSize: source.length, save_data: saveData };
  }

  // ---------- Header values the game copies from the Lua state ----------

  // The game fills these header fields from the Lua state on every save
  // (Hades II CreateSaveInfo, Hades ProgressManager::Save). Copying them
  // keeps the profile screen in step with edits. Missing values keep the
  // header value.
  const HEADER_SOURCES = Object.freeze({
    hades2: [
      ["location", ["GameState", "LocationName"], "string"],
      ["runs", ["GameState", "CompletedRunsCache"], "int"],
      ["active_shrine_points", ["GameState", "SpentShrinePointsCache"], "int"],
      ["meta_upgrade_level", ["GameState", "MaxMetaUpgradeCostCache"], "int"],
      ["cosmetics_points", ["GameState", "LifetimeResourcesGained", "CosmeticsPoints"], "int"],
    ],
    hades: [
      ["location", ["GameState", "LocationName"], "string"],
      ["runs", ["GameState", "CompletedRunsCache"], "int"],
      ["accumulated_meta_points", ["GameState", "AccumulatedMetaPointsCache"], "int"],
      ["active_shrine_points", ["GameState", "SpentShrinePointsCache"], "int"],
      ["hard_mode", ["GameState", "Flags", "HardMode"], "flag"],
    ],
  });

  function syncHeader(game, saveData) {
    const root = saveData.luabin?.[0];
    if (!root || typeof root !== "object") return;
    const fields = new Set(headerLayout(game, saveData.version).map(([name]) => name));
    HEADER_SOURCES[game].forEach(([name, path, kind]) => {
      if (!fields.has(name)) return;
      let value = root;
      for (const key of path) value = value && typeof value === "object" ? value[key] : undefined;
      if (kind === "flag") {
        // Hades reads GameState.Flags.HardMode; a missing Flags table means off.
        if (root.GameState?.Flags && typeof root.GameState.Flags === "object") saveData[name] = value ? 1 : 0;
      } else if (kind === "string" && typeof value === "string") {
        saveData[name] = value;
      } else if (kind === "int" && typeof value === "number" && Number.isFinite(value)) {
        saveData[name] = Math.trunc(value) | 0;
      }
    });
  }

  function encode(document, options = {}) {
    if (!document || !document.save_data) throw new SaveFormatError("No parsed save data is available.");
    const saveData = document.save_data;
    const game = gameForVersion(saveData.version);
    if (!game) throw new SaveFormatError(`Save version ${saveData.version} is not supported.`);
    const limits = GAMES[game];
    const flags = Number(saveData.version_flags) || 0;
    if (flags && !limits.versionFlags) throw new SaveFormatError("Hades saves have no version flags.");
    if (options.syncHeader !== false) syncHeader(game, saveData);

    const writer = new BinaryWriter(document.sourceSize || 1024);
    const container = document.container || "sgb1";
    if (container === "sgb1") writer.writeBytes(Buffer.from(SIGNATURE, "latin1"));
    writer.writeUInt32(0);
    const bodyStart = writer.offset;
    writer.writeUInt32((flags + saveData.version) >>> 0);
    headerLayout(game, saveData.version).forEach(([name, type]) => writeField(writer, type, saveData[name], name));

    const luaData = new LuaWriter(Math.max(1024, (document.sourceSize || 0) * 4)).writeDocument(saveData.luabin);
    if (luaData.length > limits.maxLuaSize) {
      throw new SaveFormatError(`The edited save holds ${luaData.length} bytes of game data. The game can only load ${limits.maxLuaSize}.`);
    }
    writer.writeByteString(saveData.version > limits.compressedAbove ? compressLua(luaData) : luaData);

    const output = writer.finish();
    output.writeUInt32LE(ADLER32.buf(output.slice(bodyStart)) >>> 0, bodyStart - 4);
    return output;
  }

  global.HadesSaveCodec = Object.freeze({
    GAMES,
    SaveFormatError,
    decode,
    encode,
    headerLayout,
    inspectHeader,
    syncHeader,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
