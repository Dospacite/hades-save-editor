(function attachFieldLogic(global) {
  "use strict";

  // Current option of a "level" field. `read(path)` returns a save value.
  // With `levels`, the level is how many leading levels are present.
  function currentLevel(field, read) {
    if (field.levels) {
      let level = 0;
      while (level < field.levels.length && read(field.levels[level][0])) level += 1;
      return level;
    }
    // `fallback` is what the game assumes when the key is missing.
    const value = read(field.path);
    return typeof value === "number" ? value : field.fallback;
  }

  // Paths and values to write for a level. `undefined` removes the key,
  // because the game counts aspect ranks by key, not by value.
  function levelWrites(field, level) {
    if (!field.levels) return [{ path: field.path, value: level }];
    return field.levels.flatMap((paths, index) =>
      paths.map((path) => ({ path, value: index < level ? true : undefined })));
  }

  function levelPaths(field) {
    return field.levels ? field.levels.flat() : [field.path];
  }

  // Fear for a vow at a rank. Each rank adds its own points.
  function pointsAt(points, rank) {
    return (points || []).slice(0, Math.max(0, rank || 0)).reduce((sum, value) => sum + value, 0);
  }

  function fearTotal(fields, read) {
    return fields
      .filter((field) => field.points)
      .reduce((sum, field) => sum + pointsAt(field.points, currentLevel(field, read)), 0);
  }

  // Grasp of the equipped Arcana cards.
  function graspUsed(fields, read) {
    return fields
      .filter((field) => field.type === "arcana" && read(`${field.path}.Equipped`))
      .reduce((sum, field) => sum + (field.grasp || 0), 0);
  }

  function sectionSummary(section, read) {
    if (section.summary === "fear") return `${fearTotal(section.fields, read)} Fear`;
    if (section.summary === "grasp") {
      const limitField = (section.toolbar || []).find((field) => /MetaUpgradeLimitLevel$/.test(field.path));
      const level = limitField ? currentLevel(limitField, read) : undefined;
      const limit = limitField?.options.find((option) => option.value === level)?.label.replace(/\D+$/, "");
      return `${graspUsed(section.fields, read)}${limit ? ` of ${limit}` : ""} Grasp used`;
    }
    return "";
  }

  // Keys of a save table, numbers first in numeric order, then by name.
  function sortedKeys(table) {
    return Object.keys(table).sort((left, right) => {
      const a = Number(left);
      const b = Number(right);
      const aNumber = left !== "" && Number.isFinite(a);
      const bNumber = right !== "" && Number.isFinite(b);
      if (aNumber && bNumber) return a - b;
      if (aNumber !== bNumber) return aNumber ? -1 : 1;
      return left.localeCompare(right);
    });
  }

  function valueKind(value) {
    if (value === null || value === undefined) return "nil";
    if (typeof value === "object") return "table";
    return typeof value;
  }

  // Paths are dot-joined, so a key with a dot can't be edited safely.
  function canEditKey(key) {
    return !String(key).includes(".");
  }

  global.HadesFieldLogic = Object.freeze({
    canEditKey,
    currentLevel,
    fearTotal,
    graspUsed,
    levelPaths,
    levelWrites,
    pointsAt,
    sectionSummary,
    sortedKeys,
    valueKind,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
