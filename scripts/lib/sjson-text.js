"use strict";

const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

// Reads Id -> DisplayName and Id -> Description from the game's English
// .sjson text files. Only the fields needed for labels are parsed.
// InheritFrom is followed for names.
function readText(textDir) {
  const entries = new Map();
  const files = readdirSync(textDir).filter((file) => file.endsWith(".en.sjson")).sort();
  for (const file of files) {
    const source = readFileSync(join(textDir, file), "utf8");
    for (const block of source.split(/\n\s*\{\s*\n/)) {
      const id = block.match(/^\s*Id = "([^"]+)"/m)?.[1];
      if (!id) continue;
      const displayName = block.match(/^\s*DisplayName = "((?:[^"\\]|\\.)*)"/m)?.[1];
      const description = block.match(/^\s*Description = "((?:[^"\\]|\\.)*)"/m)?.[1];
      const inheritFrom = block.match(/^\s*InheritFrom = "([^"]+)"/m)?.[1];
      const existing = entries.get(id);
      if (existing && existing.displayName) continue;
      entries.set(id, { displayName, description, inheritFrom, file });
    }
  }

  const resolve = (id, field, depth = 0) => {
    const entry = entries.get(id);
    if (!entry || depth > 10) return undefined;
    if (entry[field] !== undefined) return entry[field];
    return entry.inheritFrom ? resolve(entry.inheritFrom, field, depth + 1) : undefined;
  };

  const names = new Map();
  const rawDescriptions = new Map();
  for (const id of entries.keys()) {
    const name = resolve(id, "displayName");
    if (name !== undefined) names.set(id, cleanText(name, names));
    const description = entries.get(id).description;
    if (description !== undefined) rawDescriptions.set(id, description);
  }
  const descriptions = new Map();
  for (const [id, text] of rawDescriptions) descriptions.set(id, cleanText(text, names));
  return { names, descriptions };
}

// Kept for callers that only need names.
function readTextNames(textDir) {
  return readText(textDir).names;
}

// Resolves {$Keywords.X} to the keyword's name and drops other markup,
// like {#Emph} or values the game fills in at runtime.
function cleanText(text, names) {
  return text
    .replace(/\{\$Keywords\.(\w+)\}/g, (match, key) => names?.get(key) ?? key.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .replace(/\{IP\}/g, "Pin")
    .replace(/\{[A-Z]{1,4}\}/g, "the button")
    .replace(/\{[#!$@*%^+][^}]*\}/g, "")
    .replace(/\\n/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { readText, readTextNames, cleanText };
