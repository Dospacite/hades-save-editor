"use strict";

const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const projectRoot = resolve(__dirname, "..");
const publicRoot = resolve(projectRoot, "public");
const scripts = [
  "js/save-codec.js",
  "js/hades2-game-data.js",
  "js/editor-data.js",
  "js/field-logic.js",
  "js/cheat-limits.js",
  "js/file-access.js",
  "js/editor-search.js",
  "js/main.js",
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, ["--check", resolve(publicRoot, script)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}

const html = readFileSync(resolve(publicRoot, "index.html"), "utf8");
const localAssets = Array.from(html.matchAll(/(?:src|href)="(?!https?:|mailto:|\/)([^"#]+)"/g))
  .map((match) => match[1]);

const catalogContext = { globalThis: null };
catalogContext.globalThis = catalogContext;
vm.createContext(catalogContext);
for (const script of ["js/hades2-game-data.js", "js/editor-data.js"]) {
  vm.runInContext(readFileSync(resolve(publicRoot, script), "utf8"), catalogContext);
}
const iconAssets = Object.values(catalogContext.HadesEditorCatalog)
  .flatMap((game) => game.sections)
  .flatMap((section) => [...section.fields, ...(section.toolbar || [])])
  .map((field) => field.icon)
  .filter(Boolean);

for (const asset of [...localAssets, ...iconAssets]) {
  if (!existsSync(resolve(publicRoot, asset))) {
    throw new Error(`Missing local asset: ${asset}`);
  }
}

console.log(
  `Validated ${scripts.length} scripts, ${localAssets.length} page assets, and ${iconAssets.length} item icons.`,
);
