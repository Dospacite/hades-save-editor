"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = resolve(__dirname, "..");

function loadBrowserScripts(files, initial = {}) {
  const context = { console, ...initial };
  context.globalThis = context;
  vm.createContext(context);
  files.forEach((file) => {
    const path = resolve(projectRoot, file);
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: path });
  });
  return context;
}

const uiContext = loadBrowserScripts([
  "public/js/hades2-game-data.js",
  "public/js/editor-data.js",
  "public/js/editor-search.js",
  "public/js/file-access.js",
]);
const catalog = uiContext.HadesEditorCatalog;
const search = uiContext.HadesEditorSearch;
const fileAccess = uiContext.HadesFileAccess;

test("search spans categories and selects the first category with a match", () => {
  const results = search.searchSections(catalog.hades2, "moper");
  const fish = results.find((result) => result.section.id === "fish");

  assert.equal(fish.fields.length, 1);
  assert.equal(fish.fields[0].label, "Moper");
  assert.equal(search.chooseSectionId(results, "general"), "fish");
});

test("category labels match every field and an active matching category is retained", () => {
  const resourceResults = search.searchSections(catalog.hades2, "resources");
  const resources = resourceResults.find((result) => result.section.id === "resources");
  assert.equal(resources.fields.length, resources.section.fields.length);
  assert.equal(search.chooseSectionId(resourceResults, "general"), "resources");

  const giftResults = search.searchSections(catalog.hades2, "gift");
  assert.equal(search.chooseSectionId(giftResults, "gifts"), "gifts");
});

test("the Advanced tab stays selected without a search, even with no listed keys", () => {
  const results = search.searchSections(catalog.hades, "");
  assert.equal(search.chooseSectionId(results, "advanced", ""), "advanced");
  const matches = search.searchSections(catalog.hades, "hellfish");
  assert.equal(search.chooseSectionId(matches, "advanced", "hellfish"), "fish");
});

test("save selection ignores unrelated files and prefers the newest active-run save", () => {
  const selected = fileAccess.chooseLatestSave([
    { file: { name: "Profile1.sav", lastModified: 100 } },
    { file: { name: "notes.txt", lastModified: 999 } },
    { file: { name: "Profile2.sav.bak", lastModified: 999 } },
    { file: { name: "Profile1_Temp.sav", lastModified: 100 } },
  ]);

  assert.equal(selected.file.name, "Profile1_Temp.sav");
  assert.equal(fileAccess.isTemporarySaveFileName(selected.file.name), true);
  assert.equal(fileAccess.isTemporarySaveFileName("Profile1.sav"), false);
  assert.equal(fileAccess.isTemporarySaveFileName("notes_Temp.sav"), false);
});

test("save-folder search finds the newest profile in supported nested folders", async () => {
  const file = (name, lastModified) => ({
    kind: "file",
    name,
    async getFile() {
      return { name, lastModified };
    },
  });
  const directory = (name, entries) => ({
    kind: "directory",
    name,
    async *values() {
      yield* entries;
    },
  });

  const root = directory("Documents", [
    directory("Saved Games", [
      directory("Hades II", [
        file("Profile1.sav", 100),
        file("Profile2_Temp.sav", 300),
      ]),
    ]),
  ]);
  const selected = await fileAccess.findLatestSave(root);
  const listed = await fileAccess.listSaveFiles(root);

  assert.equal(selected.file.name, "Profile2_Temp.sav");
  assert.equal(selected.relativePath, "Documents/Saved Games/Hades II/Profile2_Temp.sav");
  assert.deepEqual(
    Array.from(listed, (candidate) => candidate.file.name),
    ["Profile2_Temp.sav", "Profile1.sav"],
  );
});

test("native pickers start in a remembered file-system handle", async () => {
  const calls = [];
  const rememberedDirectory = { kind: "directory", name: "Hades II" };
  const selectedFile = { kind: "file", name: "Profile1.sav" };
  const context = loadBrowserScripts(["public/js/file-access.js"], {
    isSecureContext: true,
    async showDirectoryPicker(options) {
      calls.push({ picker: "directory", options });
      return rememberedDirectory;
    },
    async showOpenFilePicker(options) {
      calls.push({ picker: "file", options });
      return [selectedFile];
    },
  });

  const directoryResult = await context.HadesFileAccess.pickDirectory(rememberedDirectory);
  const fileResult = await context.HadesFileAccess.pickSaveFile(rememberedDirectory);

  assert.equal(directoryResult, rememberedDirectory);
  assert.equal(fileResult, selectedFile);
  assert.equal(calls[0].options.id, "hades-save-folder");
  assert.equal(calls[0].options.startIn, rememberedDirectory);
  assert.equal(calls[1].options.id, "hades-save-file");
  assert.equal(calls[1].options.startIn, rememberedDirectory);
  assert.equal(calls[1].options.multiple, false);
  assert.deepEqual(
    Array.from(calls[1].options.types[0].accept["application/octet-stream"]),
    [".sav"],
  );
});

test("every catalog icon is available locally", () => {
  const iconPaths = Object.values(catalog)
    .flatMap((game) => game.sections)
    .flatMap((section) => section.fields)
    .map((field) => field.icon)
    .filter(Boolean);

  assert.equal(new Set(iconPaths).size, 179);
  iconPaths.forEach((icon) => {
    assert.ok(existsSync(resolve(projectRoot, "public", icon)), icon);
  });
});

test("Arcana follows the current board and exposes rank and unlock data only", () => {
  const arcana = catalog.hades2.sections.find((section) => section.id === "arcana");
  assert.equal(arcana.layout, "arcana");
  assert.equal(arcana.fields.length, 25);
  assert.equal(
    arcana.fields.map((field) => field.label).join("|"),
    [
      "The Sorceress", "The Wayward Son", "The Huntress", "Eternity", "The Moon",
      "The Furies", "Persistence", "The Messenger", "The Unseen", "Night",
      "The Swift Runner", "Death", "The Centaur", "Origination", "The Lovers",
      "The Enchantress", "The Boatman", "The Artificer", "Excellence", "The Queen",
      "The Fates", "The Champions", "Strength", "Divinity", "Judgment",
    ].join("|"),
  );
  assert.ok(arcana.fields.every((field) => field.type === "arcana"));
  assert.ok(arcana.fields.every((field) => !field.path.includes("Equipped")));
  assert.equal(arcana.fields.map((field) => field.grasp).join(","), "1,1,2,3,0,2,2,1,5,2,1,4,0,5,3,3,5,3,5,0,0,4,4,0,0");
});

test("keepsakes omit their redundant chamber suffix", () => {
  const keepsakes = catalog.hades2.sections.find((section) => section.id === "keepsakes");
  assert.ok(keepsakes.fields.every((field) => field.suffix === undefined));
});
