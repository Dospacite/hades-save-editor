(function attachCheatLimits(global) {
  "use strict";

  // Hades II runs sgg::CheckGameStateForCheats (Hades2.exe 0x1401d3b90) on
  // every save. If any check below is true, it sets a cheat flag in the save
  // header. Loading a flagged save keeps the flag on for every later save.
  // Hades has no such check.
  // Evidence: save-file-work/notes/SCHEMA.md, section 7.

  const get = (root, path) => path.reduce(
    (value, key) => (value && typeof value === "object" ? value[key] : undefined),
    root,
  );
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const entries = (table) => (table && typeof table === "object" ? Object.keys(table).map((key) => [key, table[key]]) : []);

  const above = (path, limit, label) => ({
    label,
    limitText: `more than ${limit.toLocaleString("en-US")}`,
    find(root) {
      const value = number(get(root, path));
      return value !== undefined && value > limit ? [{ path: path.join("."), value }] : [];
    },
  });

  const HADES2 = [
    {
      label: "Arcana card rank",
      limitText: "above III",
      find: (root) => entries(get(root, ["GameState", "MetaUpgradeState"]))
        .filter(([, card]) => number(card?.Level) > 3)
        .map(([key, card]) => ({ path: `GameState.MetaUpgradeState.${key}.Level`, value: card.Level })),
    },
    above(["GameState", "Resources", "MetaCurrency"], 499888, "Bones"),
    above(["GameState", "LifetimeResourcesGained", "Money"], 100000000, "Lifetime Gold Crowns gained"),
    above(["GameState", "LifetimeResourcesGained", "SuperGems"], 0, "Lifetime SuperGems gained"),
    above(["GameState", "LifetimeResourcesGained", "CosmeticsPointsCommon"], 0, "Lifetime CosmeticsPointsCommon gained"),
    {
      label: "Legendary fish",
      limitText: "200 or more of one kind",
      find: (root) => entries(get(root, ["GameState", "Resources"]))
        .filter(([key, value]) => key.includes("Fish") && key.includes("Legendary") && number(value) >= 200)
        .map(([key, value]) => ({ path: `GameState.Resources.${key}`, value })),
    },
    {
      label: "Incantation or purchase stored as a number",
      limitText: "any number (the game stores true)",
      find: (root) => entries(get(root, ["GameState", "WorldUpgradesAdded"]))
        .filter(([, value]) => typeof value === "number")
        .map(([key, value]) => ({ path: `GameState.WorldUpgradesAdded.${key}`, value })),
    },
    {
      label: "Run depth in Erebus",
      limitText: "15 or more while in an Erebus room",
      find(root) {
        const roomSet = get(root, ["CurrentRun", "CurrentRoom", "RoomSetName"]);
        const depth = number(get(root, ["CurrentRun", "BiomeDepthCache"]));
        return typeof roomSet === "string" && roomSet.includes("F") && depth >= 15
          ? [{ path: "CurrentRun.BiomeDepthCache", value: depth }]
          : [];
      },
    },
    above(["CurrentRun", "UseRecord", "WeaponUpgrade"], 4, "Daedalus Hammers used this run"),
    above(["CurrentRun", "Hero", "GodBoonRarities", "Heroic"], 10, "Heroic boons this run"),
  ];

  const RULES = Object.freeze({ hades: [], hades2: HADES2 });

  // Every check that is true for this Lua root table.
  function findViolations(game, root) {
    return (RULES[game] || []).flatMap((rule) => rule.find(root || {}).map((hit) => ({
      ...hit,
      label: rule.label,
      limitText: rule.limitText,
      id: `${rule.label}|${hit.path}`,
    })));
  }

  // Violations in `after` that were not in `before`.
  function newViolations(before, after) {
    const known = new Set(before.map((violation) => violation.id));
    return after.filter((violation) => !known.has(violation.id));
  }

  global.HadesCheatLimits = Object.freeze({ RULES, findViolations, newViolations });
})(typeof globalThis !== "undefined" ? globalThis : window);
