"use strict";

// Every save version either game can load, built from the layouts the games
// read (see save-file-work/notes/SCHEMA.md and the comments in save-codec.js).

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = resolve(__dirname, "..");
const context = { console };
context.globalThis = context;
vm.createContext(context);
["public/js/adler32.js", "public/js/lz4.js", "public/js/save-codec.js", "public/js/cheat-limits.js"].forEach((file) => {
  const path = resolve(projectRoot, file);
  vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
});
const codec = context.HadesSaveCodec;
const limits = context.HadesCheatLimits;

const table = (entries) => Object.assign(Object.create(null), entries);
// Values from the vm context have their own prototypes, so compare as JSON.
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

function sampleValue(name, type) {
  if (type === "i32") return name === "runs" ? 12 : 3;
  if (type === "i64") return 1700000000;
  if (type === "u8") return 1;
  if (type === "strings") return ["NotableA", "NotableB"];
  return `${name}_value`;
}

function sampleDocument(version, container = "sgb1") {
  const game = version >= 17 ? "hades2" : "hades";
  const saveData = { version, version_flags: 0 };
  codec.headerLayout(game, version).forEach(([name, type]) => {
    saveData[name] = sampleValue(name, type);
  });
  saveData.luabin = [table({
    GameState: table({ Resources: table({ Money: 10 }), Name: "Zagreus" }),
    NextSeeds: table({ 1: 5, 2: -7 }),
  })];
  return { game, container, save_data: saveData };
}

// The Lua block is the last length-prefixed field in the file.
function luaBlock(output) {
  for (let length = output.length - 4; length > 0; length -= 1) {
    const start = output.length - length;
    if (output.readInt32LE(start - 4) === length) return output.subarray(start);
  }
  return null;
}

test("every Hades and Hades II save version round-trips with its own layout", () => {
  for (let version = 1; version <= 18; version += 1) {
    const document = sampleDocument(version);
    const output = codec.encode(document, { syncHeader: false });
    const decoded = codec.decode(output);
    assert.equal(decoded.game, document.game, `version ${version}`);
    const { luabin, ...header } = decoded.save_data;
    const { luabin: expectedLua, ...expectedHeader } = document.save_data;
    same(header, expectedHeader, `version ${version} header`);
    assert.equal(JSON.stringify(luabin), JSON.stringify(expectedLua), `version ${version} Lua`);
    assert.equal(codec.encode(decoded, { syncHeader: false }).toString("hex"), output.toString("hex"));
  }
});

test("Hades II cosmetics points exist only from version 18", () => {
  const names17 = codec.headerLayout("hades2", 17).map(([name]) => name);
  const names18 = codec.headerLayout("hades2", 18).map(([name]) => name);
  assert.ok(!names17.includes("cosmetics_points"));
  assert.ok(names18.includes("cosmetics_points"));
  assert.equal(names18.length, names17.length + 1);
});

test("old Hades layouts match the version checks in the game's loader", () => {
  const names = (version) => codec.headerLayout("hades", version).map(([name]) => name);
  assert.ok(!names(15).includes("timestamp"));
  assert.ok(names(16).includes("timestamp"));
  assert.ok(!names(10).includes("location"));
  assert.ok(names(11).includes("location"));
  assert.ok(names(12).includes("legacy_int_1") && names(13).includes("legacy_int_1"));
  assert.ok(!names(14).includes("legacy_int_1"));
  assert.ok(!names(13).includes("hard_mode") && names(14).includes("hard_mode"));
  assert.ok(!names(12).includes("notable_lua_data") && names(13).includes("notable_lua_data"));
  assert.ok(names(9).includes("legacy_string_1") && !names(9).includes("runs"));
  assert.ok(names(12).includes("legacy_int_5") && !names(13).includes("legacy_int_5"));
});

test("Lua data is stored uncompressed up to version 14 and LZ4-compressed after", () => {
  const raw = luaBlock(codec.encode(sampleDocument(14), { syncHeader: false }));
  assert.equal(raw[0], 1, "luabins value count");
  assert.equal(raw[1], 0x54, "luabins table tag");
  const compressed = luaBlock(codec.encode(sampleDocument(15), { syncHeader: false }));
  assert.notEqual(compressed.subarray(0, 2).toString("hex"), "0154");
});

test("saves without the SGB1 magic keep that layout", () => {
  const output = codec.encode(sampleDocument(9, "legacy"), { syncHeader: false });
  assert.notEqual(output.subarray(0, 4).toString("latin1"), "SGB1");
  const decoded = codec.decode(output);
  assert.equal(decoded.container, "legacy");
  assert.equal(decoded.save_data.version, 9);
  assert.equal(codec.encode(decoded, { syncHeader: false }).toString("hex"), output.toString("hex"));
});

test("version flags are kept for Hades II and refused for Hades", () => {
  const hades2 = sampleDocument(18);
  hades2.save_data.version_flags = 0x10000;
  const output = codec.encode(hades2);
  assert.equal(output.readUInt32LE(8), 0x10012);
  assert.equal(codec.decode(output).save_data.version_flags, 0x10000);

  const hades = sampleDocument(16);
  hades.save_data.version_flags = 0x10000;
  assert.throws(() => codec.encode(hades), /no version flags/);
});

test("versions neither game loads are rejected", () => {
  const output = codec.encode(sampleDocument(18));
  output.writeUInt32LE(19, 8);
  output.writeUInt32LE(context.ADLER32.buf(output.subarray(8)) >>> 0, 4);
  assert.throws(() => codec.decode(output), /newer than this editor supports/);
});

test("a .v.sav checkpoint marker gets a clear message", () => {
  const marker = Buffer.from([0x53, 0x47, 0x42, 0x31, 18, 0, 0, 0, 0]);
  assert.throws(() => codec.decode(marker), /checkpoint marker/);
});

test("number keys and number-like text keys stay apart", () => {
  // Root table with number key 1, text key "1" and text key "01".
  const lua = Buffer.concat([
    Buffer.from([1, 0x54]), int32(1), int32(2),
    Buffer.from([0x4e]), double(1), str("number one"),
    str("1"), str("text one"),
    str("01"), str("text 01"),
  ]);
  const decoded = codec.decode(saveWithLua(lua));
  const root = decoded.save_data.luabin[0];
  assert.equal(root["01"], "text 01");

  const again = luaOf(codec.encode(decoded));
  assert.equal(again.readInt32LE(2) + again.readInt32LE(6), 3, "all three keys kept");
  assert.ok(again.includes(Buffer.concat([Buffer.from([0x4e]), double(1), str("number one")])), "number key 1");
  assert.ok(again.includes(Buffer.concat([str("1"), str("text one")])), "text key 1");
  assert.ok(again.includes(Buffer.concat([str("01"), str("text 01")])), "text key 01");
});

function int32(value) { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; }
function double(value) { const b = Buffer.alloc(8); b.writeDoubleLE(value); return b; }
function str(value) { const text = Buffer.from(value); return Buffer.concat([Buffer.from([0x53]), int32(text.length), text]); }

// A version 14 save (uncompressed Lua) holding this raw Lua state.
function saveWithLua(lua) {
  const output = codec.encode(sampleDocument(14), { syncHeader: false });
  const prefix = output.subarray(0, output.length - luaBlock(output).length - 4);
  const file = Buffer.concat([prefix, int32(lua.length), lua]);
  file.writeUInt32LE(context.ADLER32.buf(file.subarray(8)) >>> 0, 4);
  return file;
}

function luaOf(output) {
  return Buffer.from(luaBlock(output));
}

test("the encoder refuses Lua data larger than the game's buffer", () => {
  const document = sampleDocument(18);
  document.save_data.luabin[0].Big = "x".repeat(codec.GAMES.hades2.maxLuaSize);
  assert.throws(() => codec.encode(document), /can only load/);
});

test("header copies follow the game data like the game writes them", () => {
  const hades2 = sampleDocument(18);
  hades2.save_data.luabin[0].GameState = table({
    LocationName: "Location_Home",
    CompletedRunsCache: 41,
    SpentShrinePointsCache: 16,
    MaxMetaUpgradeCostCache: 25,
    LifetimeResourcesGained: table({ CosmeticsPoints: 999 }),
  });
  const decoded2 = codec.decode(codec.encode(hades2)).save_data;
  assert.equal(decoded2.location, "Location_Home");
  assert.equal(decoded2.runs, 41);
  assert.equal(decoded2.active_shrine_points, 16);
  assert.equal(decoded2.meta_upgrade_level, 25);
  assert.equal(decoded2.cosmetics_points, 999);

  const hades = sampleDocument(16);
  hades.save_data.hard_mode = 0;
  hades.save_data.luabin[0].GameState = table({
    CompletedRunsCache: 7,
    AccumulatedMetaPointsCache: 1234,
    Flags: table({ HardMode: true }),
  });
  const decoded1 = codec.decode(codec.encode(hades)).save_data;
  assert.equal(decoded1.runs, 7);
  assert.equal(decoded1.accumulated_meta_points, 1234);
  assert.equal(decoded1.hard_mode, 1);
});

test("missing game data keeps the header value", () => {
  const document = sampleDocument(18);
  const before = document.save_data.runs;
  codec.syncHeader("hades2", document.save_data);
  assert.equal(document.save_data.runs, before);
});

test("inspectHeader reads old saves without a run count", () => {
  const output = codec.encode(sampleDocument(8), { syncHeader: false });
  const header = codec.inspectHeader(output.subarray(0, 32));
  assert.equal(header.game, "hades");
  assert.equal(header.save_data.version, 8);
  assert.equal(header.save_data.runs, undefined);
});

test("cheat limits match the checks in Hades2.exe", () => {
  const root = table({
    GameState: table({
      MetaUpgradeState: table({ CardA: table({ Level: 3 }), CardB: table({ Level: 4 }) }),
      Resources: table({ MetaCurrency: 499889, FishFLegendary: 200, FishFRare: 999, FishGLegendary: 199 }),
      LifetimeResourcesGained: table({ Money: 100000001, SuperGems: 1, CosmeticsPointsCommon: 0 }),
      WorldUpgradesAdded: table({ Good: true, Bad: 1 }),
    }),
    CurrentRun: table({
      CurrentRoom: table({ RoomSetName: "F" }),
      BiomeDepthCache: 15,
      UseRecord: table({ WeaponUpgrade: 5 }),
      Hero: table({ GodBoonRarities: table({ Heroic: 11 }) }),
    }),
  });
  const paths = limits.findViolations("hades2", root).map((violation) => violation.path).sort();
  same(paths, [
    "CurrentRun.BiomeDepthCache",
    "CurrentRun.Hero.GodBoonRarities.Heroic",
    "CurrentRun.UseRecord.WeaponUpgrade",
    "GameState.LifetimeResourcesGained.Money",
    "GameState.LifetimeResourcesGained.SuperGems",
    "GameState.MetaUpgradeState.CardB.Level",
    "GameState.Resources.FishFLegendary",
    "GameState.Resources.MetaCurrency",
    "GameState.WorldUpgradesAdded.Bad",
  ]);
  same(limits.findViolations("hades", root), []);
});

test("values at the limit are not flagged", () => {
  const root = table({
    GameState: table({
      Resources: table({ MetaCurrency: 499888 }),
      LifetimeResourcesGained: table({ Money: 100000000 }),
    }),
    CurrentRun: table({
      CurrentRoom: table({ RoomSetName: "G" }),
      BiomeDepthCache: 30,
      UseRecord: table({ WeaponUpgrade: 4 }),
      Hero: table({ GodBoonRarities: table({ Heroic: 10 }) }),
    }),
  });
  same(limits.findViolations("hades2", root), []);
});

test("only new violations are reported", () => {
  const before = limits.findViolations("hades2", table({ GameState: table({ Resources: table({ MetaCurrency: 600000 }) }) }));
  const after = limits.findViolations("hades2", table({
    GameState: table({ Resources: table({ MetaCurrency: 700000, FishQLegendary: 300 }) }),
  }));
  same(limits.newViolations(before, after).map((violation) => violation.path), ["GameState.Resources.FishQLegendary"]);
});

test("real saves are inside the cheat limits", () => {
  const { existsSync, readdirSync } = require("node:fs");
  const directory = resolve(projectRoot, "example_save_files", "Hades 2");
  if (!existsSync(directory)) return;
  readdirSync(directory).filter((file) => file.endsWith(".sav")).forEach((file) => {
    const document = codec.decode(readFileSync(resolve(directory, file)));
    same(limits.findViolations("hades2", document.save_data.luabin[0]), [], file);
  });
});
