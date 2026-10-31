"use strict";

const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { LuaDataReader, inherit, isTable, list } = require("./lua-data");
const { readText } = require("./sjson-text");

const STATE = "save_data.luabin.0.GameState";

function loadScripts(scriptsDir) {
  const reader = new LuaDataReader();
  const loaded = new Set();
  reader.onImport = (file) => {
    if (loaded.has(file)) return;
    loaded.add(file);
    const path = join(scriptsDir, file);
    if (!existsSync(path)) {
      reader.warnings.push(`Import of missing file ${file}`);
      return;
    }
    reader.load(readFileSync(path, "utf8"), file);
  };
  // RunData.lua imports the data files in the order the game uses.
  reader.onImport("RunData.lua");
  for (const file of readdirSync(scriptsDir).filter((f) => /Data.*\.lua$/.test(f)).sort()) {
    reader.onImport(file);
  }
  return { reader, loaded };
}

// Counts how the scripts read and write GameState and CurrentRun.
function indexStateReferences(scriptsDir) {
  const tables = { GameState: new Map(), CurrentRun: new Map() };
  // Tables read with a variable key, like GameState.WorldUpgradesAdded[traitName].
  const dynamicReads = { GameState: new Map(), CurrentRun: new Map() };
  const keys = { GameState: new Map(), CurrentRun: new Map() };
  const sources = [];
  const bump = (map, key, file) => {
    const entry = map.get(key) || { count: 0, files: new Set() };
    entry.count += 1;
    entry.files.add(file);
    map.set(key, entry);
  };

  for (const file of readdirSync(scriptsDir).filter((f) => f.endsWith(".lua")).sort()) {
    const source = readFileSync(join(scriptsDir, file), "utf8");
    sources.push(source);
    for (const root of ["GameState", "CurrentRun"]) {
      const dotted = new RegExp(`\\b${root}\\.([A-Za-z_]\\w*)(?:\\.([A-Za-z_]\\w*)|\\[\\s*"(\\w+)"\\s*\\])?`, "g");
      const pathForm = new RegExp(`"${root}",\\s*"(\\w+)"(?:,\\s*"(\\w+)")?`, "g");
      for (const match of source.matchAll(dotted)) {
        bump(tables[root], match[1], file);
        const key = match[2] || match[3];
        if (key) bump(keys[root], `${match[1]}.${key}`, file);
      }
      const dynamic = new RegExp(`\\b${root}\\.([A-Za-z_]\\w*)\\[\\s*[A-Za-z_]`, "g");
      for (const match of source.matchAll(dynamic)) bump(dynamicReads[root], match[1], file);
      for (const match of source.matchAll(pathForm)) {
        bump(tables[root], match[1], file);
        if (match[2]) bump(keys[root], `${match[1]}.${match[2]}`, file);
      }
    }
  }
  return { tables, keys, dynamicReads, allSource: sources.join("\n") };
}

function entity(group, key, fields) {
  return { group, key, ...fields };
}

function extractEntities(globals, names) {
  const name = (id, fallback) => names.get(id) ?? fallback ?? null;
  const out = [];

  // Resources: everything the inventory can hold.
  const resources = inherit(globals.ResourceData || {});
  const displayOrder = list(globals.ResourceDisplayOrderData);
  for (const [key, data] of Object.entries(resources)) {
    if (!isTable(data) || data.DebugOnly || /^Base/.test(key)) continue;
    out.push(entity("resources", key, {
      name: name(key),
      paths: [`${STATE}.Resources.${key}`],
      order: displayOrder.indexOf(key),
      inDisplayOrder: displayOrder.includes(key),
      gameIcon: data.IconPath || data.Icon || null,
      kind: resourceKind(key),
    }));
  }

  // Keepsakes, in rack order.
  list(globals.ScreenData?.KeepsakeRack?.ItemOrder).forEach((key, index) => {
    out.push(entity("keepsakes", key, {
      name: name(key),
      paths: [`${STATE}.KeepsakeChambers.${key}`],
      order: index,
    }));
  });

  // Arcana cards, with board position from the default layout.
  const layout = list(globals.MetaUpgradeDefaultCardLayout).flatMap((row) => list(row));
  for (const [key, data] of Object.entries(inherit(globals.MetaUpgradeCardData || {}))) {
    if (!isTable(data) || /^Base/.test(key)) continue;
    out.push(entity("arcana", key, {
      name: name(key),
      paths: [`${STATE}.MetaUpgradeState.${key}`],
      order: layout.indexOf(key),
      position: layout.indexOf(key) + 1,
      grasp: data.Cost,
      image: typeof data.Image === "string" ? data.Image.replace(/^CardArt_/, "") : null,
      startUnlocked: Boolean(data.StartUnlocked),
    }));
  }

  // Weapons, aspects, aspect ranks and tools from the Silver Pool / tool shop.
  const shop = inherit(globals.WeaponShopItemData || {});
  for (const [key, data] of Object.entries(shop)) {
    if (!isTable(data) || /^Base(WeaponUpgrade)?$/.test(key)) continue;
    const textLine = conversationRequirement(data.GameStateRequirements);
    const cost = isTable(data.Cost) ? data.Cost : null;
    if (/^Tool/.test(key)) {
      out.push(entity(/\d$/.test(key) ? "toolUpgrades" : "tools", key, {
        name: name(key),
        paths: [`${STATE}.WeaponsUnlocked.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
        cost,
      }));
    } else if (/^Weapon/.test(key)) {
      out.push(entity("weapons", key, {
        name: name(key),
        paths: [`${STATE}.WeaponsUnlocked.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
        cost,
      }));
    } else if (data.TraitUpgrade) {
      out.push(entity("aspectRanks", key, {
        name: `${name(data.TraitUpgrade, data.TraitUpgrade)} rank ${key.match(/(\d)$/)?.[1]}`,
        paths: [`${STATE}.WeaponsUnlocked.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
        aspect: data.TraitUpgrade,
        weapon: data.WeaponName,
      }));
    } else {
      out.push(entity(textLine ? "hiddenAspects" : "aspects", key, {
        name: name(key),
        paths: [`${STATE}.WeaponsUnlocked.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
        weapon: data.WeaponName,
        textLine,
        cost,
      }));
    }
  }

  // Base aspects have no shop entry for rank 1. Pick them up from rank 2.
  const known = new Set(out.map((e) => e.key));
  for (const rank of out.filter((e) => e.group === "aspectRanks")) {
    if (known.has(rank.aspect)) continue;
    known.add(rank.aspect);
    out.push(entity("aspects", rank.aspect, {
      name: name(rank.aspect),
      paths: [`${STATE}.WeaponsUnlocked.${rank.aspect}`],
      weapon: rank.weapon,
      startUnlocked: true,
    }));
  }

  // Cauldron incantations, per category.
  const worldUpgrades = inherit(globals.WorldUpgradeData || {});
  for (const category of list(globals.ScreenData?.GhostAdmin?.ItemCategories)) {
    const group = category.Name === "WorldUpgradeScreen_Repeatable" ? "repeatableIncantations" : "incantations";
    list(category).forEach((key, index) => {
      const data = worldUpgrades[key] || {};
      out.push(entity(group, key, {
        name: name(key),
        // UnlockWorldUpgrade sets all four. A purchase sets the first two.
        paths: [
          `${STATE}.WorldUpgrades.${key}`,
          `${STATE}.WorldUpgradesAdded.${key}`,
          `${STATE}.WorldUpgradesViewed.${key}`,
          `${STATE}.WorldUpgradesRevealed.${key}`,
        ],
        order: index,
        cost: isTable(data.Cost) ? data.Cost : null,
      }));
    });
  }

  // Crossroads cosmetics, per shop tab.
  for (const category of list(globals.ScreenData?.CosmeticsShop?.ItemCategories)) {
    list(category).forEach((key, index) => {
      if (typeof key !== "string") return;
      out.push(entity("cosmetics", key, {
        name: name(key),
        paths: [`${STATE}.WorldUpgrades.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
        tab: name(category.Name, category.Name),
        order: index,
      }));
    });
  }
  const listed = new Set(out.map((e) => e.key));
  for (const [key, data] of Object.entries(worldUpgrades)) {
    if (listed.has(key) || !isTable(data) || data.DebugOnly || /^Default|^EndGameItem$/.test(key)) continue;
    if (/^Song_/.test(key)) {
      out.push(entity("songs", key, {
        name: name(key),
        paths: [`${STATE}.WorldUpgrades.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
      }));
    } else if (/^FamiliarCostume_/.test(key)) {
      // Owned costumes. GameState.FamiliarCostumes only holds the equipped one.
      out.push(entity("familiarCostumes", key, {
        name: `${name(key)} (${key.replace(/^FamiliarCostume_|(Default|Chthonic|Cute|Moon|Nightmare|Hell|Chaos)$/g, "")})`,
        paths: [`${STATE}.WorldUpgrades.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
      }));
    } else if (/^Cosmetic_/.test(key)) {
      // Variants and sub-parts that the shop tabs don't list directly.
      out.push(entity("cosmeticVariants", key, {
        name: name(key),
        paths: [`${STATE}.WorldUpgrades.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
      }));
    } else {
      out.push(entity("otherWorldUpgrades", key, {
        name: name(key),
        paths: [`${STATE}.WorldUpgrades.${key}`, `${STATE}.WorldUpgradesAdded.${key}`],
      }));
    }
  }

  // Vows of the Oath of the Unseen.
  const metaUpgrades = inherit(globals.MetaUpgradeData || {});
  list(globals.ShrineUpgradeOrder).forEach((key, index) => {
    out.push(entity("vows", key, {
      name: name(key),
      paths: [`${STATE}.ShrineUpgrades.${key}`],
      order: index,
      maxRank: list(metaUpgrades[key]?.Ranks).length,
    }));
  });

  // Familiars and their upgrades.
  list(globals.FamiliarOrderData).forEach((key, index) => {
    out.push(entity("familiars", key, {
      name: name(key),
      paths: [`${STATE}.FamiliarsUnlocked.${key}`],
      order: index,
    }));
  });
  for (const [key, data] of Object.entries(inherit(globals.FamiliarShopItemData || {}))) {
    if (!isTable(data) || /^Base/.test(key)) continue;
    out.push(entity("familiarUpgrades", key, {
      name: name(key),
      paths: [`${STATE}.FamiliarUpgrades.${key}`],
    }));
  }

  // Relationships. Hades II tracks these through gift conversations.
  for (const key of Object.keys(globals.GiftData || {})) {
    if (/^Default|SpellDrop|TrialUpgrade/.test(key)) continue;
    out.push(entity("relationships", key, {
      name: name(key, name(key.replace(/_\d+$/, ""), null)),
      paths: [`${STATE}.GiftRecord.${key}`, `${STATE}.GiftTextLinesOrderRecord.${key}`, `${STATE}.TextLinesRecord`],
    }));
  }

  // Fated List.
  list(globals.QuestOrderData).forEach((key, index) => {
    out.push(entity("quests", key, {
      name: name(key),
      paths: [`${STATE}.QuestStatus.${key}`],
      order: index,
    }));
  });

  // Rank badges (bought from the Broker with Kudos).
  list(globals.BadgeOrderData).forEach((key, index) => {
    out.push(entity("badges", key, {
      name: name(key),
      paths: [`${STATE}.BadgeRank`],
      order: index,
      rank: index + 1,
    }));
  });

  // Chaos Trials (packaged bounties) and Oath boss bounties.
  const bounties = inherit(globals.BountyData || {});
  for (const [key, data] of Object.entries(bounties)) {
    if (!isTable(data) || data.DebugOnly || /^Base|^Default|Test|Random|NameSwapMap|Encounters$/.test(key)) continue;
    const trial = /^PackageBounty/.test(key);
    out.push(entity(trial ? "chaosTrials" : "shrineBounties", key, {
      name: name(key, typeof data.Text === "string" ? name(data.Text) : null),
      paths: trial
        ? [`${STATE}.PackagedBountyClears.${key}`]
        : [`${STATE}.ShrineBountiesCompleted.${key}`],
    }));
  }

  // Achievements live on the platform as well. Kept for completeness.
  for (const key of Object.keys(globals.AchievementData || {})) {
    if (/^Base|^Default/.test(key)) continue;
    out.push(entity("achievements", key, {
      name: name(key),
      paths: [`${STATE}.AchievementsUnlocked.${key}`],
    }));
  }

  // Codex entries, grouped by chapter.
  for (const [chapter, data] of Object.entries(globals.CodexData || {})) {
    for (const key of Object.keys(isTable(data?.Entries) ? data.Entries : {})) {
      out.push(entity("codex", key, {
        name: name(key),
        paths: [`save_data.luabin.0.CodexStatus.${chapter}.${key}`],
        chapter: name(data.TitleText, chapter),
      }));
    }
  }

  return out;
}

function resourceKind(key) {
  if (/^Fish/.test(key)) return "fish";
  if (/^Plant|^Seed/.test(key)) return "garden";
  if (/^Ore/.test(key)) return "ore";
  return "other";
}

// Returns the TextLinesRecord entry a shop item waits for, if any.
function conversationRequirement(requirements) {
  for (const requirement of list(requirements)) {
    const path = list(requirement?.PathTrue);
    if (path[0] === "GameState" && path[1] === "TextLinesRecord") return path[2];
  }
  return null;
}

function extractHades2(gameDir) {
  const scriptsDir = join(gameDir, "Content", "Scripts");
  const textDir = join(gameDir, "Content", "Game", "Text", "en");
  if (!existsSync(scriptsDir)) throw new Error(`No Content/Scripts folder in ${gameDir}`);

  const { reader, loaded } = loadScripts(scriptsDir);
  const { names, descriptions } = readText(textDir);
  const references = indexStateReferences(scriptsDir);
  const entities = extractEntities(reader.globals, names);
  return {
    gameDir,
    scriptsDir,
    descriptions,
    scriptsLoaded: loaded.size,
    warnings: reader.warnings,
    globals: reader.globals,
    names,
    references,
    entities,
  };
}

module.exports = { extractHades2, STATE };
