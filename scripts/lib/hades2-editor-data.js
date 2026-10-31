"use strict";

// Builds the data file the editor loads, public/js/hades2-game-data.js,
// from an extractHades2() result. Only plain data goes in; the editor
// decides how to show it.

const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { inherit, isTable, list } = require("./lua-data");
const {
  GROUPS, HEADER_RULES, ITEM_OVERRIDES, KEY_RULES, ROOT_RULES, ruleForKey,
} = require("./hades2-rules");

// Where each entity group is edited, for the Advanced view notes.
const GROUP_SECTIONS = {
  resources: "Resources",
  keepsakes: "Keepsakes",
  arcana: "Arcana",
  weapons: "Weapons",
  familiars: "Familiars",
  familiarUpgrades: "Familiars",
  vows: "Oath",
  incantations: "Incantations",
  badges: "General",
  achievements: "Achievements",
};

function buildEditorData(game, { publicDir }) {
  const { globals, names, descriptions, entities } = game;
  const name = (id, fallback = id) => names.get(id) ?? fallback;
  const byGroup = (group) => entities.filter((e) => e.group === group);
  const hasIcon = (path) => existsSync(join(publicDir, path));

  const resources = byGroup("resources")
    .filter((e) => e.inDisplayOrder && ITEM_OVERRIDES[e.key]?.bucket !== 5)
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      key: e.key,
      name: e.name || e.key,
      kind: e.kind,
      icon: hasIcon(`assets/items/hades2/${e.key}.png`),
    }));

  const keepsakes = byGroup("keepsakes")
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      key: e.key,
      name: e.name || e.key,
      textLine: keepsakeTextLine(globals.GiftData, e.key),
      icon: hasIcon(`assets/items/hades2/keepsakes/${e.key}.png`),
    }));

  const arcana = byGroup("arcana")
    .sort((a, b) => a.position - b.position)
    .map((e) => ({ key: e.key, name: e.name || e.key, image: e.image, grasp: e.grasp ?? 0 }));

  // Grasp at each MetaUpgradeLimitLevel, starting at level 0.
  const costData = globals.MetaUpgradeCostData || {};
  const graspLimits = [costData.StartingMetaUpgradeLimit ?? 10];
  for (const level of list(costData.MetaUpgradeLevelData)) {
    graspLimits.push(graspLimits[graspLimits.length - 1] + (level?.CostIncrease ?? 0));
  }

  return {
    resources,
    keepsakes,
    arcana,
    graspLimits,
    weapons: weapons(globals, name),
    tools: tools(globals, name),
    vows: vows(globals, name),
    familiars: familiars(globals, name),
    incantations: incantations(game, name),
    badges: list(globals.BadgeOrderData).map((key) => name(key)),
    achievements: list(globals.AchievementOrderData).filter((key) => isTable(globals.AchievementData?.[key])),
    notes: stateNotes(game),
  };
}

function keepsakeTextLine(giftData, keepsake) {
  for (const data of Object.values(giftData || {})) {
    for (const gift of list(data)) {
      if (gift?.Gift !== keepsake) continue;
      for (const requirement of list(gift.GameStateRequirements)) {
        const path = list(requirement?.PathTrue);
        if (path[1] === "TextLinesRecord") return path[2];
      }
    }
  }
  return null;
}

function rankKeys(shop, aspect) {
  return Object.entries(shop)
    .filter(([, data]) => isTable(data) && data.TraitUpgrade === aspect)
    .map(([key]) => key)
    .sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]));
}

function textLineRequirement(requirements) {
  for (const requirement of list(requirements)) {
    const path = list(requirement?.PathTrue);
    if (path[0] === "GameState" && path[1] === "TextLinesRecord") return path[2];
  }
  return null;
}

function weapons(globals, name) {
  const shop = inherit(globals.WeaponShopItemData || {});
  const order = globals.ScreenData?.WeaponUpgradeScreen?.DisplayOrder || {};
  return Object.keys(shop)
    .filter((key) => /^Weapon/.test(key))
    .map((weapon) => ({
      key: weapon,
      name: name(weapon),
      aspects: list(order[weapon]).map((aspect) => {
        const textLine = textLineRequirement(shop[aspect]?.GameStateRequirements);
        return {
          key: aspect,
          name: name(aspect),
          hidden: Boolean(textLine),
          textLine,
          ranks: rankKeys(shop, aspect),
        };
      }),
    }));
}

function tools(globals, name) {
  const shop = inherit(globals.WeaponShopItemData || {});
  return Object.keys(shop)
    .filter((key) => /^Tool[A-Za-z]+$/.test(key))
    .map((tool) => ({
      key: tool,
      name: name(tool),
      upgrades: Object.keys(shop)
        .filter((key) => new RegExp(`^${tool}\\d+$`).test(key))
        .sort()
        .map((key) => ({ key, name: name(key) })),
    }));
}

function vows(globals, name) {
  const data = inherit(globals.MetaUpgradeData || {});
  return list(globals.ShrineUpgradeOrder).map((key) => ({
    key,
    name: name(key),
    points: list(data[key]?.Ranks).map((rank) => rank?.Points ?? 0),
  }));
}

function familiars(globals, name) {
  const upgrades = inherit(globals.FamiliarShopItemData || {});
  return list(globals.FamiliarOrderData).map((familiar) => {
    const tracks = new Map();
    for (const [key, data] of Object.entries(upgrades)) {
      if (!isTable(data) || data.DebugOnly || data.FamiliarName !== familiar) continue;
      const base = data.ShowLastInGroup || key;
      if (!tracks.has(base)) tracks.set(base, []);
      tracks.get(base).push({ key, level: data.RarityLevel || 1 });
    }
    return {
      key: familiar,
      name: name(familiar),
      tracks: [...tracks.entries()].map(([base, ranks]) => ({
        name: name(base),
        ranks: ranks.sort((a, b) => a.level - b.level).map((rank) => rank.key),
      })),
    };
  });
}

// Cauldron incantations, grouped by the comment headers in GhostAdminData_Items.lua.
function incantations(game, name) {
  const category = list(game.globals.ScreenData?.GhostAdmin?.ItemCategories)
    .find((entry) => entry.Name === "WorldUpgradeScreen_Critical");
  const keys = list(category);
  const groups = incantationGroups(game.scriptsDir);
  return keys.map((key) => ({
    key,
    name: name(key),
    description: game.descriptions.get(key) || "",
    group: groups.get(key) || "Other",
  }));
}

function incantationGroups(scriptsDir) {
  const path = join(scriptsDir, "GhostAdminData_Items.lua");
  const groups = new Map();
  if (!existsSync(path)) return groups;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let current = null;
  lines.forEach((line, index) => {
    const header = line.match(/^\s*--\s*(.+?)\s*$/);
    if (header) {
      // Only a comment directly above an item starts a group.
      if (/^\s*"\w+"/.test(lines[index + 1] || "")) current = formatGroup(header[1]);
      return;
    }
    if (/Name = "WorldUpgradeScreen_Repeatable"/.test(line)) current = null;
    const item = line.match(/^\s*"(\w+)"/);
    if (item && current) groups.set(item[1], current);
  });
  return groups;
}

function formatGroup(text) {
  const words = {
    "story & major progression": "Story",
    "key systems": "Systems",
    "key upgrades": "Key upgrades",
    "run upgrades": "Run upgrades",
    "hub expansions": "Crossroads",
    "supporting systems": "Supporting upgrades",
  };
  const lower = text.toLowerCase();
  return words[lower] || lower.replace(/&/g, "and").replace(/^./, (c) => c.toUpperCase());
}

// Short notes for the Advanced view, keyed by save path below the root.
function stateNotes(game) {
  const gameState = {};
  const keys = new Set([...game.references.tables.GameState.keys(), ...Object.keys(KEY_RULES)]);
  for (const key of [...keys].sort()) {
    const rule = ruleForKey(key);
    if (!rule) continue;
    if (rule.group) {
      const section = GROUP_SECTIONS[rule.group];
      gameState[key] = section
        ? `Edited in ${section}.`
        : GROUPS[rule.group]?.reason || "";
    } else if (rule.reason) {
      gameState[key] = rule.reason;
    }
  }
  const pick = (rules) => Object.fromEntries(
    Object.entries(rules).filter(([, rule]) => rule.reason).map(([key, rule]) => [key, rule.reason]),
  );
  return { GameState: gameState, root: pick(ROOT_RULES), header: pick(HEADER_RULES) };
}

module.exports = { buildEditorData };
