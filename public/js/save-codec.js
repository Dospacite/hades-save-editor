/* Browser save codec. ADLER32 and require are provided by the vendored codecs. */
/* global ADLER32, require */

(function attachSaveCodec(global) {
  "use strict";

  const Buffer = require("buffer").Buffer;
  const LZ4 = require("lz4");
  const SIGNATURE = "SGB1";
  const SAVE_VERSION_MASK = 0xffff;
  const MAX_SAVE_VERSION = 18;
  const MAX_DECOMPRESSED_SIZE = 256 * 1024 * 1024;

  class SaveFormatError extends Error {
    constructor(message) {
      super(message);
      this.name = "SaveFormatError";
    }
  }

  class BinaryReader {
    constructor(buffer) {
      this.buffer = buffer;
      this.offset = 0;
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

    readUInt64(label = "64-bit integer") {
      this.ensure(8, label);
      const low = this.buffer.readUInt32LE(this.offset);
      const high = this.buffer.readUInt32LE(this.offset + 4);
      this.offset += 8;
      const value = low + high * 0x100000000;
      if (!Number.isSafeInteger(value)) {
        throw new SaveFormatError(`${label} is too large to edit safely.`);
      }
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

    readString(label = "string") {
      const size = this.readInt32(`${label} length`);
      if (size < 0) {
        throw new SaveFormatError(`Invalid ${label} length.`);
      }
      return this.readBytes(size, label).toString("utf8");
    }

    readStringArray(label) {
      const size = this.readInt32(`${label} count`);
      if (size < 0 || size > 100000) {
        throw new SaveFormatError(`Invalid ${label} count.`);
      }
      const values = [];
      for (let index = 0; index < size; index += 1) {
        values.push(this.readString(`${label} item`));
      }
      return values;
    }
  }

  class BinaryWriter {
    constructor(initialSize = 1024) {
      this.buffer = Buffer.alloc(Math.max(64, initialSize));
      this.offset = 0;
    }

    ensure(size) {
      const required = this.offset + size;
      if (required <= this.buffer.length) {
        return;
      }
      let capacity = this.buffer.length;
      while (capacity < required) {
        capacity *= 2;
      }
      const next = Buffer.alloc(capacity);
      this.buffer.copy(next, 0, 0, this.offset);
      this.buffer = next;
    }

    writeUInt8(value) {
      this.ensure(1);
      this.buffer.writeUInt8(Number(value), this.offset);
      this.offset += 1;
    }

    writeInt32(value) {
      this.ensure(4);
      this.buffer.writeInt32LE(Number(value), this.offset);
      this.offset += 4;
    }

    writeUInt32(value) {
      this.ensure(4);
      this.buffer.writeUInt32LE(Number(value) >>> 0, this.offset);
      this.offset += 4;
    }

    writeUInt64(value) {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) {
        throw new SaveFormatError("The save timestamp is invalid.");
      }
      const high = Math.floor(number / 0x100000000);
      const low = number - high * 0x100000000;
      this.ensure(8);
      this.buffer.writeUInt32LE(low, this.offset);
      this.buffer.writeUInt32LE(high, this.offset + 4);
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

    writeString(value) {
      const bytes = Buffer.from(String(value), "utf8");
      this.writeInt32(bytes.length);
      this.writeBytes(bytes);
    }

    writeStringArray(values) {
      this.writeInt32(values.length);
      values.forEach((value) => this.writeString(value));
    }

    finish() {
      return this.buffer.slice(0, this.offset);
    }
  }

  class LuaReader extends BinaryReader {
    readDocument() {
      const count = this.readUInt8("Lua root value count");
      const values = [];
      for (let index = 0; index < count; index += 1) {
        values.push(this.readTaggedValue());
      }
      if (this.remaining !== 0) {
        throw new SaveFormatError("The embedded Lua data has unexpected trailing bytes.");
      }
      return values;
    }

    readTaggedValue() {
      return this.readValue(this.readUInt8("Lua value type"));
    }

    readValue(type) {
      switch (type) {
        case 45:
          return null;
        case 48:
          return false;
        case 49:
          return true;
        case 78:
          return this.readDouble("Lua number");
        case 83:
          return this.readString("Lua string");
        case 84:
          return this.readTable();
        default:
          throw new SaveFormatError(`Unsupported Lua value type ${type}.`);
      }
    }

    readTable() {
      const arraySize = this.readInt32("Lua table array size");
      const hashSize = this.readInt32("Lua table hash size");
      const size = arraySize + hashSize;
      if (arraySize < 0 || hashSize < 0 || size > 10000000) {
        throw new SaveFormatError("Invalid Lua table size.");
      }

      const table = Object.create(null);
      for (let index = 0; index < size; index += 1) {
        const key = this.readTaggedValue();
        table[key] = this.readTaggedValue();
      }
      return table;
    }
  }

  class LuaWriter extends BinaryWriter {
    writeDocument(values) {
      if (!Array.isArray(values) || values.length > 255) {
        throw new SaveFormatError("Invalid embedded Lua root data.");
      }
      this.writeUInt8(values.length);
      values.forEach((value) => this.writeTaggedValue(value));
      return this.finish();
    }

    writeTaggedValue(value, numericKey = false) {
      const type = this.getType(value, numericKey);
      this.writeUInt8(type);
      this.writeValue(type, value);
    }

    getType(value, numericKey) {
      if (value === null) return 45;
      if (value === false) return 48;
      if (value === true) return 49;
      if (typeof value === "number") return 78;
      if (typeof value === "string") {
        return numericKey && value !== "" && Number.isFinite(Number(value)) ? 78 : 83;
      }
      if (typeof value === "object") return 84;
      throw new SaveFormatError(`Unsupported Lua value: ${String(value)}.`);
    }

    writeValue(type, value) {
      switch (type) {
        case 45:
        case 48:
        case 49:
          return;
        case 78:
          this.writeDouble(value);
          return;
        case 83:
          this.writeString(value);
          return;
        case 84:
          this.writeTable(value);
          return;
        default:
          throw new SaveFormatError(`Unsupported Lua value type ${type}.`);
      }
    }

    writeTable(table) {
      const keys = Object.keys(table);
      const numericKeys = keys.filter(
        (key) => key !== "" && Number.isFinite(Number(key)),
      );
      this.writeInt32(numericKeys.length);
      this.writeInt32(keys.length - numericKeys.length);
      keys.forEach((key) => {
        this.writeTaggedValue(key, true);
        this.writeTaggedValue(table[key]);
      });
    }
  }

  function decompressLua(compressed) {
    const input = Buffer.from(compressed);
    if (input.length === 0) {
      throw new SaveFormatError("The save has no embedded Lua data.");
    }

    let capacity = Math.max(64 * 1024, input.length * 8);
    while (capacity <= MAX_DECOMPRESSED_SIZE) {
      const output = Buffer.alloc(capacity);
      const size = LZ4.decodeBlock(input, output);
      if (size < 0) {
        throw new SaveFormatError("The embedded Lua data is corrupt.");
      }
      if (size <= capacity) {
        return output.slice(0, size);
      }
      capacity = Math.max(capacity * 2, size);
    }
    throw new SaveFormatError("The embedded Lua data is too large to edit safely.");
  }

  function compressLua(luaData) {
    const input = Buffer.from(luaData);
    const capacity = LZ4.encodeBound(input.length);
    if (!capacity) {
      throw new SaveFormatError("The embedded Lua data is too large to save.");
    }
    const output = Buffer.alloc(capacity);
    const size = LZ4.encodeBlock(input, output);
    if (size <= 0) {
      throw new SaveFormatError("The embedded Lua data could not be compressed.");
    }
    return output.slice(0, size);
  }

  function readCommonTail(reader, saveData) {
    saveData.god_mode_enabled = reader.readUInt8("God Mode flag");
    saveData.hell_mode_enabled = reader.readUInt8("Hell Mode flag");
    saveData.lua_keys = reader.readStringArray("Lua key");
    saveData.current_map_name = reader.readString("current map name");
    saveData.start_next_map = reader.readString("next map name");

    const compressedSize = reader.readInt32("compressed Lua data length");
    if (compressedSize <= 0) {
      throw new SaveFormatError("Invalid embedded Lua data length.");
    }
    const compressed = reader.readBytes(compressedSize, "compressed Lua data");
    const luaBuffer = decompressLua(compressed);
    saveData.luabin = new LuaReader(luaBuffer).readDocument();
  }

  function readPreamble(reader) {
    const signature = reader.readBytes(4, "file signature").toString("ascii");
    if (signature !== SIGNATURE) {
      throw new SaveFormatError("This is not a supported Hades save file.");
    }
    return reader.readUInt32("checksum");
  }

  function readHeaderFields(reader) {
    const rawVersion = reader.readInt32("save version");
    const saveData = {
      version: rawVersion & SAVE_VERSION_MASK,
      version_flags: rawVersion & ~SAVE_VERSION_MASK,
      timestamp: reader.readUInt64("save timestamp"),
      location: reader.readString("save location"),
      runs: reader.readInt32("run count"),
    };

    if (saveData.version < 1) {
      throw new SaveFormatError(`Save version ${saveData.version} is not supported.`);
    }
    if (saveData.version > MAX_SAVE_VERSION) {
      throw new SaveFormatError(
        `Save version ${saveData.version} is newer than this editor supports.`,
      );
    }

    return {
      game: saveData.version >= 17 ? "hades2" : "hades",
      saveData,
    };
  }

  // Reads only the fixed outer metadata. The compressed Lua payload is not touched.
  function inspectHeader(input) {
    const source = input instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(input))
      : Buffer.from(input);
    const reader = new BinaryReader(source);
    const checksum = readPreamble(reader);
    const { game, saveData } = readHeaderFields(reader);
    return {
      game,
      checksum,
      headerSize: reader.offset,
      save_data: saveData,
    };
  }

  function decode(input) {
    const source = input instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(input))
      : Buffer.from(input);
    const reader = new BinaryReader(source);
    const checksum = readPreamble(reader);
    const calculatedChecksum = ADLER32.buf(source.slice(8)) >>> 0;
    if (checksum !== calculatedChecksum) {
      throw new SaveFormatError("The save file checksum is invalid.");
    }

    const { game, saveData } = readHeaderFields(reader);
    if (game === "hades2") {
      saveData.padding1 = Array.from(reader.readBytes(8, "Hades II header padding"));
      saveData.grasp = reader.readInt32("Grasp");
      if (saveData.version >= 18) {
        saveData.prestige = reader.readInt32("Prestige");
      }
    } else {
      saveData.active_meta_points = reader.readInt32("active Mirror points");
      saveData.active_shrine_points = reader.readInt32("active Pact points");
    }

    readCommonTail(reader, saveData);
    if (reader.remaining !== 0) {
      throw new SaveFormatError("The save file has unexpected trailing data.");
    }

    return {
      game,
      checksum,
      sourceSize: source.length,
      save_data: saveData,
    };
  }

  function writeCommonTail(writer, saveData) {
    writer.writeUInt8(saveData.god_mode_enabled ? 1 : 0);
    writer.writeUInt8(saveData.hell_mode_enabled ? 1 : 0);
    writer.writeStringArray(saveData.lua_keys);
    writer.writeString(saveData.current_map_name);
    writer.writeString(saveData.start_next_map);

    const luaData = new LuaWriter().writeDocument(saveData.luabin);
    const compressed = compressLua(luaData);
    writer.writeInt32(compressed.length);
    writer.writeBytes(compressed);
  }

  function encode(document) {
    if (!document || !document.save_data) {
      throw new SaveFormatError("No parsed save data is available.");
    }

    const saveData = document.save_data;
    const game = saveData.version >= 17 ? "hades2" : "hades";
    const writer = new BinaryWriter(document.sourceSize || 1024);
    writer.writeBytes(Buffer.from(SIGNATURE, "ascii"));
    writer.writeUInt32(0);
    writer.writeInt32((saveData.version_flags || 0) | saveData.version);
    writer.writeUInt64(saveData.timestamp);
    writer.writeString(saveData.location);
    writer.writeInt32(saveData.runs);

    if (game === "hades2") {
      const padding = saveData.padding1 || new Array(8).fill(0);
      if (padding.length !== 8) {
        throw new SaveFormatError("Invalid Hades II header padding.");
      }
      writer.writeBytes(padding);
      writer.writeInt32(saveData.grasp);
      if (saveData.version >= 18) {
        writer.writeInt32(saveData.prestige);
      }
    } else {
      writer.writeInt32(saveData.active_meta_points);
      writer.writeInt32(saveData.active_shrine_points);
    }

    writeCommonTail(writer, saveData);
    const output = writer.finish();
    output.writeUInt32LE(ADLER32.buf(output.slice(8)) >>> 0, 4);
    return output;
  }

  global.HadesSaveCodec = Object.freeze({
    SaveFormatError,
    decode,
    encode,
    inspectHeader,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
