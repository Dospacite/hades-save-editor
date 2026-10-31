"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = resolve(__dirname, "..");
const STATE = "save_data.luabin.0.GameState";

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

const context = loadBrowserScripts([
  "public/js/adler32.js",
  "public/js/lz4.js",
  "public/js/save-codec.js",
  "public/js/hades2-game-data.js",
  "public/js/editor-data.js",
  "public/js/field-logic.js",
]);
const catalog = context.HadesEditorCatalog.hades2;
const logic = context.HadesFieldLogic;
const codec = context.HadesSaveCodec;

// Arrays from the vm context have another prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const section = (id) => catalog.sections.find((entry) => entry.id === id);
const fieldByLabel = (id, label) => section(id).fields.find((field) => field.label === label);

function getAtPath(root, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), root);
}

// Same rules as main.js: undefined removes the key.
function setAtPath(root, path, value) {
  const parts = path.split(".");
  let target = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (target[parts[index]] == null) {
      if (value === undefined) return;
      target[parts[index]] = Object.create(null);
    }
    target = target[parts[index]];
  }
  const key = parts[parts.length - 1];
  if (value === undefined) delete target[key];
  else target[key] = value;
}

test("ladder levels count leading levels and remove higher ranks", () => {
  const field = { levels: [["a.r1"], ["a.r2"], ["a.r3"]] };
  const values = { "a.r1": true, "a.r2": true, "a.r3": true };
  assert.equal(logic.currentLevel(field, (path) => values[path]), 3);
  assert.equal(logic.currentLevel(field, (path) => ({ "a.r1": true, "a.r3": true })[path]), 1);

  const writes = logic.levelWrites(field, 1);
  assert.deepEqual(
    plain(writes.map((write) => [write.path, write.value ?? null])),
    [["a.r1", true], ["a.r2", null], ["a.r3", null]],
  );
});

test("numeric levels write the option value", () => {
  const field = { path: "x.vow", options: [] };
  assert.equal(logic.currentLevel(field, () => 2), 2);
  assert.equal(logic.currentLevel(field, () => undefined), undefined);
  assert.equal(logic.currentLevel({ ...field, fallback: 0 }, () => undefined), 0);
  assert.deepEqual(plain(logic.levelWrites(field, 3).map((write) => write.value)), [3]);
});

test("Fear adds each rank's points and Grasp counts equipped cards", () => {
  assert.equal(logic.pointsAt([1, 2, 2], 0), 0);
  assert.equal(logic.pointsAt([1, 2, 2], 3), 5);

  const oath = section("oath");
  const pain = fieldByLabel("oath", "Vow of Pain");
  const read = (path) => (path === pain.path ? 2 : undefined);
  assert.equal(logic.sectionSummary(oath, read), "3 Fear");

  const arcana = section("arcana");
  const first = arcana.fields[0];
  const equipped = (path) => {
    if (path === `${first.path}.Equipped`) return true;
    if (path.endsWith("MetaUpgradeLimitLevel")) return 15;
    return undefined;
  };
  assert.equal(logic.sectionSummary(arcana, equipped), `${first.grasp} of 30 Grasp used`);
});

test("save browser keys sort numbers first and refuse dotted keys", () => {
  assert.deepEqual(plain(logic.sortedKeys({ b: 1, 10: 1, a: 1, 2: 1 })), ["2", "10", "a", "b"]);
  assert.equal(logic.canEditKey("Resources"), true);
  assert.equal(logic.canEditKey("a.b"), false);
  assert.equal(logic.valueKind(null), "nil");
  assert.equal(logic.valueKind({}), "table");
});

test("incantations write all four Cauldron tables", () => {
  const gaia = fieldByLabel("incantations", "Greatest Gift of Gaia");
  assert.equal(gaia.path, `${STATE}.WorldUpgradesAdded.WorldUpgradeAutoHarvestOnExit`);
  assert.ok(gaia.removeWhenOff);
  const effects = gaia.effects.map((effect) => effect.path.replace(`${STATE}.`, ""));
  assert.deepEqual(plain(effects), [
    "WorldUpgrades.WorldUpgradeAutoHarvestOnExit",
    "WorldUpgradesViewed.WorldUpgradeAutoHarvestOnExit",
    "WorldUpgradesRevealed.WorldUpgradeAutoHarvestOnExit",
  ]);
  assert.ok(gaia.effects[0].mirror);
  assert.equal(section("incantations").fields.length, 88);
});

test("hidden aspects write WorldUpgradesAdded and their unlock conversation", () => {
  const anubis = fieldByLabel("weapons", "Aspect of Anubis");
  assert.equal(anubis.tag, "Hidden aspect");
  assert.deepEqual(plain(anubis.levels[0].map((path) => path.replace(`${STATE}.`, ""))), [
    "WeaponsUnlocked.StaffRaiseDeadAspect",
    "WorldUpgradesAdded.StaffRaiseDeadAspect",
  ]);
  assert.equal(anubis.levels.length, 5);
  assert.equal(anubis.effects[0].path, `${STATE}.TextLinesRecord.CirceGrantsHiddenAspect01`);
  assert.equal(section("weapons").fields.filter((field) => field.tag).length, 6);
});

test("Hades II field paths are unique", () => {
  const paths = catalog.sections
    .filter((entry) => entry.layout !== "explorer")
    .flatMap((entry) => [...(entry.toolbar || []), ...entry.fields])
    .flatMap((field) => (field.levels ? field.levels.flat() : [field.path]));
  const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
  assert.deepEqual(plain(duplicates), []);
});

test("lowering an aspect rank removes keys and the save still round-trips", (t) => {
  const fixture = resolve(projectRoot, "example_save_files", "Hades 2", "Profile2.sav");
  if (!existsSync(fixture)) return t.skip("Local Hades II example save is not present.");

  const parsed = codec.decode(readFileSync(fixture));
  const circe = fieldByLabel("weapons", "Aspect of Circe");
  const read = (path) => getAtPath(parsed, path);
  assert.equal(logic.currentLevel(circe, read), 5);

  logic.levelWrites(circe, 2).forEach((write) => setAtPath(parsed, write.path, write.value));
  const pain = fieldByLabel("oath", "Vow of Pain");
  logic.levelWrites(pain, 3).forEach((write) => setAtPath(parsed, write.path, write.value));

  const reparsed = codec.decode(codec.encode(parsed));
  const readBack = (path) => getAtPath(reparsed, path);
  assert.equal(logic.currentLevel(circe, readBack), 2);
  assert.equal(readBack(`${STATE}.WeaponsUnlocked.StaffClearCastAspect3`), undefined);
  assert.ok(!("StaffClearCastAspect5" in readBack(`${STATE}.WorldUpgradesAdded`)));
  assert.equal(readBack(pain.path), 3);
});
