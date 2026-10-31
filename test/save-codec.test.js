"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { basename, join, resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = resolve(__dirname, "..");

function loadBrowserScripts(files) {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  files.forEach((file) => {
    const path = resolve(projectRoot, file);
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  });
  return context;
}

const codecContext = loadBrowserScripts([
  "public/js/adler32.js",
  "public/js/lz4.js",
  "public/js/save-codec.js",
]);
const codec = codecContext.HadesSaveCodec;

function fixtureFiles() {
  const directories = [
    resolve(projectRoot, "example_save_files", "Hades"),
    resolve(projectRoot, "example_save_files", "Hades 2"),
  ];
  return directories.flatMap((directory) => {
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((file) => file.endsWith(".sav"))
      .sort()
      .map((file) => join(directory, file));
  });
}

function getAtPath(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

function setAtPath(root, path, value) {
  const parts = path.split(".");
  let target = root;
  parts.forEach((key, index) => {
    if (index === parts.length - 1) {
      target[key] = value;
      return;
    }
    target[key] ||= Object.create(null);
    target = target[key];
  });
}

test("all local example saves auto-detect, encode, and decode without data loss", (context) => {
  const fixtures = fixtureFiles();
  if (fixtures.length === 0) return context.skip("Local example saves are not present.");
  assert.equal(fixtures.length, 6);

  const detectedGames = new Set();
  fixtures.forEach((fixture) => {
    const parsed = codec.decode(readFileSync(fixture));
    const encoded = codec.encode(parsed);
    const reparsed = codec.decode(encoded);
    detectedGames.add(parsed.game);
    assert.equal(
      JSON.stringify(reparsed.save_data),
      JSON.stringify(parsed.save_data),
      `${basename(fixture)} changed during a round trip`,
    );
  });
  assert.deepEqual([...detectedGames].sort(), ["hades", "hades2"]);
});

test("Hades resource and fish edits survive validation", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades", "Profile1.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades example save is not present.");

  const parsed = codec.decode(readFileSync(fixture));
  const gemsPath = "save_data.luabin.0.GameState.Resources.Gems";
  const fishPath = "save_data.luabin.0.GameState.CaughtFish.Fish_Tartarus_Common_01";
  setAtPath(parsed, gemsPath, 123456);
  setAtPath(parsed, fishPath, 17);
  const reparsed = codec.decode(codec.encode(parsed));
  assert.equal(getAtPath(reparsed, gemsPath), 123456);
  assert.equal(getAtPath(reparsed, fishPath), 17);
});

test("Hades II current and newly cataloged values survive validation", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades 2", "Profile2.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades II example save is not present.");

  const parsed = codec.decode(readFileSync(fixture));
  const edits = new Map([
    ["save_data.luabin.0.GameState.Resources.MetaCurrency", 654321],
    ["save_data.luabin.0.GameState.Resources.DreamPoints", 21],
    ["save_data.luabin.0.GameState.Resources.PlantQSnakereedSeed", 34],
    ["save_data.luabin.0.CurrentRun.Hero.Health", 777],
    ["save_data.luabin.0.GameState.WorldUpgradesAdded.WorldUpgradeAutoHarvestOnExit", true],
    ["save_data.luabin.0.GameState.MetaUpgradeState.ChanneledCast.Level", 2],
    ["save_data.luabin.0.GameState.MetaUpgradeState.ChanneledCast.Unlocked", true],
  ]);
  const equippedPath = "save_data.luabin.0.GameState.MetaUpgradeState.ChanneledCast.Equipped";
  const equippedBefore = getAtPath(parsed, equippedPath);
  edits.forEach((value, path) => setAtPath(parsed, path, value));
  const reparsed = codec.decode(codec.encode(parsed));
  edits.forEach((value, path) => assert.equal(getAtPath(reparsed, path), value, path));
  assert.equal(getAtPath(reparsed, equippedPath), equippedBefore);
});

test("UTF-8 strings use byte lengths and remain intact", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades", "Profile2.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades example save is not present.");

  const parsed = codec.decode(readFileSync(fixture));
  parsed.save_data.luabin[0].GameState.LocationName = "Location_İstanbul";
  const reparsed = codec.decode(codec.encode(parsed));
  assert.equal(reparsed.save_data.luabin[0].GameState.LocationName, "Location_İstanbul");
  // The header copy follows the game data, the way the game writes it.
  assert.equal(reparsed.save_data.location, "Location_İstanbul");
});

test("save flags stored above the 16-bit version are preserved", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades 2", "Profile2.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades II example save is not present.");

  const parsed = codec.decode(readFileSync(fixture));
  parsed.save_data.version_flags = 0x10000;
  const output = codec.encode(parsed);
  const reparsed = codec.decode(output);
  assert.equal(output.readUInt32LE(8), 0x10012);
  assert.equal(reparsed.save_data.version, 18);
  assert.equal(reparsed.save_data.version_flags, 0x10000);
});

test("outer save details can be inspected without reading the embedded Lua", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades 2", "Profile2.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades II example save is not present.");

  const input = readFileSync(fixture);
  const decoded = codec.decode(input);
  const inspected = codec.inspectHeader(input.subarray(0, 64));

  assert.equal(inspected.game, decoded.game);
  assert.equal(inspected.save_data.version, decoded.save_data.version);
  assert.equal(inspected.save_data.timestamp, decoded.save_data.timestamp);
  assert.equal(inspected.save_data.location, decoded.save_data.location);
  assert.equal(inspected.save_data.runs, decoded.save_data.runs);
  assert.equal(inspected.save_data.luabin, undefined);
  assert.ok(inspected.headerSize < 64);
});

test("a damaged checksum is rejected", (context) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades", "Profile3.sav");
  if (!existsSync(fixture)) return context.skip("Local Hades example save is not present.");

  const input = Buffer.from(readFileSync(fixture));
  input[input.length - 1] ^= 0xff;
  assert.throws(() => codec.decode(input), /checksum is invalid/i);
});

test("catalog contains the current game counts and omits removed entries", () => {
  const catalogContext = loadBrowserScripts(["public/js/hades2-game-data.js", "public/js/editor-data.js"]);
  const catalog = catalogContext.HadesEditorCatalog;
  const hadesFish = catalog.hades.sections.find((section) => section.id === "fish");
  const hades2Fish = catalog.hades2.sections.find((section) => section.id === "fish");
  const keepsakes = catalog.hades2.sections.find((section) => section.id === "keepsakes");
  const allPaths = catalog.hades2.sections.flatMap((section) =>
    section.fields.flatMap((field) => (field.levels ? field.levels.flat() : [field.path])));

  assert.equal(hadesFish.fields.length, 18);
  assert.equal(hades2Fish.fields.length, 27);
  assert.equal(keepsakes.fields.length, 33);
  assert.ok(allPaths.some((path) => path.endsWith(".DreamPoints")));
  assert.ok(allPaths.some((path) => path.endsWith(".SeedMystery")));
  assert.ok(!allPaths.some((path) => path.endsWith(".PlantMoney")));
  assert.ok(!allPaths.some((path) => path.includes(".FishB")));
});
