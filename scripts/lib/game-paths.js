"use strict";

const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..", "..");

// Usual Hades II install folders, most likely first.
function gameDirCandidates() {
  const home = homedir();
  return [
    process.env.HADES2_DIR,
    join(home, ".local/share/Steam/steamapps/common/Hades II"),
    join(home, ".steam/steam/steamapps/common/Hades II"),
    join(home, "Library/Application Support/Steam/steamapps/common/Hades II"),
    "C:/Program Files (x86)/Steam/steamapps/common/Hades II",
  ].filter(Boolean);
}

function findGameDir() {
  return gameDirCandidates().find((dir) => existsSync(join(dir, "Content", "Scripts")));
}

// Folders that may hold Hades II saves. The examples come first.
function saveDirCandidates() {
  const home = homedir();
  return [
    join(projectRoot, "example_save_files", "Hades 2"),
    join(home, ".local/share/Steam/steamapps/compatdata/1145350/pfx/drive_c/users/steamuser/Saved Games/Hades II"),
    join(home, "Saved Games", "Hades II"),
    join(home, "Library/Application Support/Supergiant Games/Hades II"),
  ];
}

module.exports = { findGameDir, saveDirCandidates };
