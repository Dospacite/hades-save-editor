var Buffer = require('buffer').Buffer
var LZ4 = require('lz4')

class Struct {
  constructor(fields, buffer) {
    this.fields = fields.fields
    this.buffer = buffer
    this.data = {}

    this.offset = 0
  }

  parse() {
    for (let field of this.fields) {
      let value = this.read(field.type, {size: field.size, content: field.content, fields: field.fields})
      this.data[field.label] = value;
    }
    if(this.data.luabin) {
      let decompressed = this.decompressLuabin(this.data.luabin)
      let lua = new Luabin(decompressed)
      lua.parse()
      this.data.luabin = lua.data
    }
  }

  output() {
    for(let field of this.fields) {
      if (field.label === "luabin") {
        let out = Buffer.alloc(10E6)
        let lua = new Luabin(out)
        lua.data = this.data.luabin
        lua.output()
        let compressed = this.compressLuabin(lua.buffer)
        this.write("array", compressed, {size: field.size, content: field.content, fields: field.fields})
      }
      else {
        this.write(field.type, this.data[field.label], {size: field.size, content: field.content, fields: field.fields});
      }
    }
    if(this.save_data) {
      this.checksum = ADLER32.buf(this.save_data) >>> 0;
      this.buffer.writeUInt32LE(this.checksum, 4)
    }
    this.buffer = this.buffer.slice(0, this.offset)
  }

  read(type, options) {
    let array = []
    let length = 0
    switch (type) {
      case "int8":
        return this.buffer.readUInt8(this.offset++);
      case "int32":
        this.offset += 4;
        return this.buffer.readInt32LE(this.offset - 4);
      case "int64":
        this.offset += 8;
        return this.buffer.readUIntLE(this.offset - 8, 8);
      case "string":
        length = this.read("int32");
        let string = this.buffer.toString("utf8", this.offset, this.offset + length);
        this.offset += length;
        return string;
      case "array":
        length = this.read("int32");
        array = [];
        for (let i = 0; i < length; i++) {
          array.push(this.read(options.content.type));
        }
        return array;
      case "struct":
        let struct = new Struct(options, this.buffer);
        struct.offset = this.offset;
        struct.parse();
        this.offset = struct.offset;
        return struct.data;
      case "padding":
        array = [];
        for (let i = 0; i < options.size; i++) {
          array.push(this.read("int8"));
        }
        return array;
      default:
        throw new Error(`Invalid type: ${type}`);
    }
  };

  decompressLuabin(luabin) {
    let input = Buffer.from(luabin)
    let output = Buffer.alloc(input.length * 10)
    let compressedSize = LZ4.decodeBlock(input, output)
    output = output.slice(0, compressedSize)

    return output
  }

  write(type, value, options) {
    switch (type) {
      case "int8":
        this.buffer.writeUInt8(value, this.offset++);
        break;
      case "int32":
        this.buffer.writeInt32LE(value, this.offset);
        this.offset += 4;
        break;
      case "int64":
        this.buffer.writeUIntLE(value, this.offset, 8);
        this.offset += 8;
        break;
      case "string":
        this.write("int32", value.length);
        this.buffer.write(value, this.offset);
        this.offset += value.length;
        break;
      case "array":
        this.write("int32", value.length);
        for (let i = 0; i < value.length; i++) {
          this.write(options.content.type, value[i]);
        }
        break;
      case "struct":
        let struct = new Struct(options, this.buffer);
        struct.offset = this.offset;
        struct.data = value;
        struct.output();
        this.save_data = this.buffer.slice(this.offset, struct.offset);
        this.offset = struct.offset;
        break;
      case "padding":
        for (let i = 0; i < value.length; i++) {
          this.write("int8", value[i]);
        }
        break;
      default:
        throw new Error(`Invalid type: ${type}`);
    }
  }

  compressLuabin(luabin) {
    let input = Buffer.from(luabin)
    let output = Buffer.alloc(input.length * 10)
    let compressedSize = LZ4.encodeBlock(input, output)
    output = output.slice(0, compressedSize)

    return output
  }

}

class Luabin {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
    this.data = []
  }


  parse() {
    let i = 0
    let len = this.read("int8")
    while (i++ < len) {
      let type = this.read("int8");
      let value = this.read(type);
      this.data.push(value);
    }
  }

  output() {
    this.buffer.writeInt8(this.data.length, this.offset++)
    for (let i = 0; i < this.data.length; i++) {
      let type = this.getType(this.data[i]);
      this.write(type, this.data[i]);
    }
    this.buffer = this.buffer.slice(0, this.offset)
  }

  getType(value) {
    if (value === null) {
      return 45;
    } else if (value === true) {
      return 49;
    } else if (value === false) {
    return 48;
    } else if (typeof value === "number" || !isNaN(value)) {
      return 78;
    } else if (typeof value === "string") {
      return 83;
    } else if (typeof value === "object") {
      return 84;
    } else if (value === null) {
      return 45;
    } else if (value === true) {
      return 49;
    } else if (value === false) {
      return 48;
    } else {
      return 84;
    }
  }


  read(type) {
    let length = 0
    let table = {}
    switch (type) {
      case "int8":
        return this.buffer.readUInt8(this.offset++);
      case "int32":
        this.offset += 4;
        return this.buffer.readInt32LE(this.offset - 4);
      case 45:
      case "null":
        return null;
      case 48:
      case "false":
        return false;
      case 49:
      case "true":
        return true;
      case 78:
      case "float":
        this.offset += 8;
        return this.buffer.readDoubleLE(this.offset - 8);
      case 83:
      case "string":
        length = this.read("int32");
        let string = this.buffer.toString("utf8", this.offset, this.offset + length);
        this.offset += length;
        return string;
      case 84:
      case "table":
        let array_size = this.read("int32");
        let hash_size = this.read("int32");
        let total_size = array_size + hash_size;

        let table = {};

        for(let i = 0; i < total_size; i++) {
          let key_type = this.read("int8");
          let key = this.read(key_type);
          let value_type = this.read("int8");
          let value = this.read(value_type);
          table[key] = value;
        }

        return table;
      default:
        console.log(this.buffer)
        throw new Error(`Invalid type: ${type}`);
    }
  }

  write(type, value) {
    this.buffer.writeUInt8(type, this.offset++);
    switch (type) {
      case 45:
      case "null":
        break;
      case 48:
      case "false":
        break;
      case 49:
      case "true":
        break;
      case 78:
      case "float":
        this.buffer.writeDoubleLE(value, this.offset);
        this.offset += 8;
        break;
      case 83:
      case "string":
        this.buffer.writeInt32LE(value.length, this.offset);
        this.offset += 4;
        this.buffer.write(value, this.offset);
        this.offset += value.length;
        break;
      case 84:
      case "table":
        let intKeys = Object.keys(value).filter(key => !isNaN(key));
        this.buffer.writeInt32LE(intKeys.length, this.offset);
        this.offset += 4;
        this.buffer.writeInt32LE(Object.keys(value).length - intKeys.length, this.offset);
        this.offset += 4;

        for(let key in value) {
          let key_type = this.getType(key);
          let value_type = this.getType(value[key])
          this.write(key_type, key);
          this.write(value_type, value[key]);
        }
        break;

      default:
        throw new Error(`Invalid type: ${type}`);
    }
  }

}
