(function attachEditorCatalog(global) {
  "use strict";

  // Hades II lists come from hades2-game-data.js, which
  // `npm run update-game-data` generates from the installed game.
  const GAME = global.HadesGameData?.hades2;
  if (!GAME) throw new Error("Load hades2-game-data.js before editor-data.js.");

  const SAVE = "save_data.luabin.0";
  const STATE = `${SAVE}.GameState`;
  const RESOURCES = `${STATE}.Resources`;

  const numberField = (label, path, options = {}) => ({
    type: "number",
    min: 0,
    step: 1,
    label,
    path,
    ...options,
  });

  const toggleField = (label, path, options = {}) => ({
    type: "toggle",
    label,
    path,
    ...options,
  });

  const objectField = (label, path, options = {}) => ({
    type: "object",
    label,
    path,
    ...options,
  });

  const itemIcon = (game, key) => `assets/items/${game}/${key}.png`;
  const arcanaIcon = (image) => `assets/items/hades2/arcana/card${image}.webp`;
  const keepsakeIcon = (key) => `assets/items/hades2/keepsakes/${key}.png`;

  const resources = (items, game) => items.map(([label, key, group]) =>
    numberField(label, `${RESOURCES}.${key}`, { group, icon: itemIcon(game, key) }),
  );

  const hadesFish = [
    ["Hellfish", "Fish_Tartarus_Common_01", "Tartarus"],
    ["Knucklehead", "Fish_Tartarus_Rare_01", "Tartarus"],
    ["Scyllascion", "Fish_Tartarus_Legendary_01", "Tartarus"],
    ["Slavug", "Fish_Asphodel_Common_01", "Asphodel"],
    ["Chrustacean", "Fish_Asphodel_Rare_01", "Asphodel"],
    ["Flameater", "Fish_Asphodel_Legendary_01", "Asphodel"],
    ["Chlam", "Fish_Elysium_Common_01", "Elysium"],
    ["Charp", "Fish_Elysium_Rare_01", "Elysium"],
    ["Seamare", "Fish_Elysium_Legendary_01", "Elysium"],
    ["Gupp", "Fish_Styx_Common_01", "Styx"],
    ["Scuffer", "Fish_Styx_Rare_01", "Styx"],
    ["Stonewhal", "Fish_Styx_Legendary_01", "Styx"],
    ["Mati", "Fish_Chaos_Common_01", "Chaos"],
    ["Projelly", "Fish_Chaos_Rare_01", "Chaos"],
    ["Voidskate", "Fish_Chaos_Legendary_01", "Chaos"],
    ["Trout", "Fish_Surface_Common_01", "Surface"],
    ["Bass", "Fish_Surface_Rare_01", "Surface"],
    ["Sturgeon", "Fish_Surface_Legendary_01", "Surface"],
  ].map(([label, key, group]) =>
    numberField(label, `${STATE}.CaughtFish.${key}`, {
      group,
      icon: itemIcon("hades", key),
    }),
  );

  const hadesRelationships = [
    ["Achilles", "NPC_Achilles_01"],
    ["Aphrodite", "AphroditeUpgrade"],
    ["Ares", "AresUpgrade"],
    ["Artemis", "ArtemisUpgrade"],
    ["Athena", "AthenaUpgrade"],
    ["Bouldy", "NPC_Bouldy_01"],
    ["Cerberus", "NPC_Cerberus_01"],
    ["Charon", "NPC_Charon_01"],
    ["Demeter", "DemeterUpgrade"],
    ["Dionysus", "DionysusUpgrade"],
    ["Dusa", "NPC_Dusa_01"],
    ["Eurydice", "NPC_Eurydice_01"],
    ["Megaera", "NPC_FurySister_01"],
    ["Hades", "NPC_Hades_01"],
    ["Hermes", "HermesUpgrade"],
    ["Hypnos", "NPC_Hypnos_01"],
    ["Nyx", "NPC_Nyx_01"],
    ["Orpheus", "NPC_Orpheus_01"],
    ["Patroclus", "NPC_Patroclus_01"],
    ["Persephone", "NPC_Persephone_Home_01"],
    ["Poseidon", "PoseidonUpgrade"],
    ["Sisyphus", "NPC_Sisyphus_01"],
    ["Skelly", "NPC_Skelly_01"],
    ["Thanatos", "NPC_Thanatos_01"],
    ["Zeus", "ZeusUpgrade"],
  ].map(([label, key]) => numberField(label, `${STATE}.Gift.${key}.Value`));

  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

  // 5x5 board order, art and Grasp costs from MetaUpgradeData.lua.
  const arcana = GAME.arcana.map((card, index) => ({
    type: "arcana",
    label: card.name,
    path: `${STATE}.MetaUpgradeState.${card.key}`,
    icon: arcanaIcon(card.image),
    grasp: card.grasp,
    position: index + 1,
    search: `rank unlocked ${card.key}`,
  }));

  // Keepsake rack order. Setting a level also marks the keepsake as received.
  const keepsakes = GAME.keepsakes.map((item) => numberField(
    item.name,
    `${STATE}.KeepsakeChambers.${item.key}`,
    {
      ...(item.icon ? { icon: keepsakeIcon(item.key) } : {}),
      effects: [
        { path: `${STATE}.GiftPresentation.${item.key}`, value: true, when: "truthy" },
        ...(item.textLine
          ? [{ path: `${STATE}.TextLinesRecord.${item.textLine}`, value: true, when: "truthy" }]
          : []),
      ],
    },
  ));

  // A "level" field picks one of several options. With `levels`, level N
  // means the paths of levels 1..N exist and the rest are removed, the way
  // the game stores aspect ranks and familiar upgrades. With `path`, the
  // option value is written as a number.
  const levelField = (label, options, settings) => ({ type: "level", label, options, ...settings });
  const rankOptions = (count, zeroLabel) => [
    { value: 0, label: zeroLabel },
    ...Array.from({ length: count }, (_, index) => ({ value: index + 1, label: ROMAN[index] })),
  ];

  // What the Silver Pool writes for a purchase.
  const owned = (key) => [`${STATE}.WeaponsUnlocked.${key}`, `${STATE}.WorldUpgradesAdded.${key}`];

  const weapons = GAME.weapons.flatMap((weapon) => [
    toggleField(weapon.name, `${STATE}.WeaponsUnlocked.${weapon.key}`, {
      group: weapon.name,
      description: "Weapon unlocked",
      removeWhenOff: true,
      search: "weapon unlocked",
      effects: [{ path: `${STATE}.WorldUpgradesAdded.${weapon.key}`, mirror: true }],
    }),
    ...weapon.aspects.map((aspect) => levelField(aspect.name, rankOptions(aspect.ranks.length + 1, "Locked"), {
      group: weapon.name,
      levels: [owned(aspect.key), ...aspect.ranks.map(owned)],
      tag: aspect.hidden ? "Hidden aspect" : undefined,
      search: `aspect rank ${aspect.key}`,
      effects: aspect.textLine
        ? [{ path: `${STATE}.TextLinesRecord.${aspect.textLine}`, value: true, when: "truthy" }]
        : [],
    })),
  ]);

  const tools = GAME.tools.map((tool) => levelField(tool.name, [
    { value: 0, label: "Locked" },
    { value: 1, label: "Owned" },
    ...tool.upgrades.map((upgrade, index) => ({ value: index + 2, label: "Upgraded" })),
  ], {
    group: "Gathering tools",
    levels: [owned(tool.key), ...tool.upgrades.map((upgrade) => owned(upgrade.key))],
    search: `tool ${tool.key}`,
  }));

  const familiars = GAME.familiars.flatMap((familiar) => [
    toggleField(familiar.name, `${STATE}.FamiliarsUnlocked.${familiar.key}`, {
      group: familiar.name,
      description: "Recruited",
      removeWhenOff: true,
      search: "familiar recruited",
    }),
    ...familiar.tracks.map((track) => levelField(track.name, rankOptions(track.ranks.length, "None"), {
      group: familiar.name,
      levels: track.ranks.map((key) => [`${STATE}.FamiliarUpgrades.${key}`]),
      search: `${familiar.name} familiar upgrade`,
    })),
  ]);

  const vows = GAME.vows.map((vow) => levelField(vow.name, rankOptions(vow.points.length, "Off"), {
    group: "Vows",
    path: `${STATE}.ShrineUpgrades.${vow.key}`,
    fallback: 0,
    points: vow.points,
    search: `vow fear ${vow.key}`,
  }));

  // Group order follows the Cauldron.
  const incantationGroups = [...new Set(GAME.incantations.map((item) => item.group))];
  const incantations = incantationGroups.flatMap((group) => GAME.incantations
    .filter((item) => item.group === group)
    .map((item) => toggleField(item.name, `${STATE}.WorldUpgradesAdded.${item.key}`, {
      group,
      description: item.description,
      removeWhenOff: true,
      search: item.key,
      // The Cauldron sets all four tables.
      effects: [
        { path: `${STATE}.WorldUpgrades.${item.key}`, mirror: true },
        { path: `${STATE}.WorldUpgradesViewed.${item.key}`, value: true, when: "truthy" },
        { path: `${STATE}.WorldUpgradesRevealed.${item.key}`, value: true, when: "truthy" },
      ],
    })));

  // The game has no English names for these; Steam does. Derived from the key.
  const achievementLabel = (key) => key
    .replace(/^Ach/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2");
  const achievements = GAME.achievements.map((key) => toggleField(
    achievementLabel(key),
    `${STATE}.AchievementsUnlocked.${key}`,
    { removeWhenOff: true, search: key },
  ));

  const graspLimit = levelField(
    "Grasp limit",
    GAME.graspLimits.map((grasp, level) => ({ value: level, label: `${grasp} Grasp` })),
    { path: `${STATE}.MetaUpgradeLimitLevel`, fallback: 0, search: "grasp limit altar of ashes" },
  );

  const badgeRank = levelField(
    "Rank badge",
    [{ value: 0, label: "None" }, ...GAME.badges.map((name, index) => ({ value: index + 1, label: name }))],
    { path: `${STATE}.BadgeRank`, fallback: 0, search: "badge rank broker kudos" },
  );

  // Advanced view entries. Search finds a key by name or by its note.
  const advanced = Object.entries(GAME.notes.GameState).map(([key, note]) => ({
    type: "explore",
    label: key,
    path: `${STATE}.${key}`,
    note,
    search: note,
  }));

  const catalog = {
    hades: {
      label: "Hades",
      sections: [
        {
          id: "general",
          label: "General",
          // God Mode on/off is a game setting, not save data. The save only
          // keeps its strength. Hell Mode is GameState.Flags.HardMode.
          fields: [
            numberField("God Mode level", `${STATE}.EasyModeLevel`),
            toggleField("Hell Mode", `${STATE}.Flags.HardMode`, {
              removeWhenOff: true,
              description: "Turns Hell Mode on for this save. It does not add the Pact conditions a new Hell Mode save starts with.",
              search: "hard mode",
            }),
            objectField("Random seeds", `${SAVE}.NextSeeds`),
          ],
        },
        {
          id: "resources",
          label: "Resources",
          fields: resources([
            ["Gemstones", "Gems"],
            ["Nectar", "GiftPoints"],
            ["Chthonic Keys", "LockKeys"],
            ["Darkness", "MetaPoints"],
            ["Diamonds", "SuperGems"],
            ["Ambrosia", "SuperGiftPoints"],
            ["Titan Blood", "SuperLockKeys"],
          ], "hades"),
        },
        { id: "fish", label: "Fish", fields: hadesFish },
        { id: "relationships", label: "Relationships", fields: hadesRelationships },
        {
          id: "advanced",
          label: "Advanced",
          layout: "explorer",
          tone: "warning",
          description: "Every value in the save. Change these only if you know what they do.",
          fields: [],
        },
      ],
    },

    hades2: {
      label: "Hades II",
      sections: [
        {
          id: "general",
          label: "General",
          fields: [
            // Turning God Mode on or off is a game setting, not save data.
            numberField("God Mode level", `${STATE}.EasyModeLevel`, { max: 30 }),
            badgeRank,
            numberField("Next run seed", `${STATE}.NextRunSeed`, { min: undefined }),
            objectField("Random seeds", `${SAVE}.NextSeeds`),
          ],
        },
        {
          id: "resources",
          label: "Resources",
          fields: resources([
            ["Bones", "MetaCurrency", "Common"],
            ["Psyche", "MemPointsCommon", "Common"],
            ["Ashes", "MetaCardPointsCommon", "Common"],
            ["Fate Fabric", "MetaFabric", "Common"],
            ["Moon Dust", "CardUpgradePoints", "Common"],
            ["Gemstones", "GemPoints", "Common"],
            ["Rubbish", "TrashPoints", "Common"],
            ["Silver", "OreFSilver", "Ore"],
            ["Limestone", "OreGLime", "Ore"],
            ["Glassrock", "OreHGlassrock", "Ore"],
            ["Marble", "OreIMarble", "Ore"],
            ["Bronze", "OreNBronze", "Ore"],
            ["Iron", "OreOIron", "Ore"],
            ["Adamant", "OrePAdamant", "Ore"],
            ["Serpent Scales", "OreQScales", "Ore"],
            ["Flux", "OreChaosProtoplasm", "Ore"],
            ["Cinder", "MixerFBoss", "Boss rewards"],
            ["Pearl", "MixerGBoss", "Boss rewards"],
            ["Tears", "MixerHBoss", "Boss rewards"],
            ["Zodiac Sand", "MixerIBoss", "Boss rewards"],
            ["Wool", "MixerNBoss", "Boss rewards"],
            ["Golden Apple", "MixerOBoss", "Boss rewards"],
            ["Feather", "MixerPBoss", "Boss rewards"],
            ["Void Lens", "MixerQBoss", "Boss rewards"],
            ["Nightmare", "WeaponPointsRare", "Alchemy"],
            ["Star Dust", "Mixer5Common", "Alchemy"],
            ["Darkness", "Mixer6Common", "Alchemy"],
            ["Shadow", "MixerShadow", "Alchemy"],
            ["Entropy", "MixerMythic", "Alchemy"],
          ], "hades2"),
        },
        {
          id: "garden",
          label: "Garden",
          fields: resources([
            ["Moly", "PlantFMoly", "Harvested"],
            ["Lotus", "PlantGLotus", "Harvested"],
            ["Myrtle", "PlantHMyrtle", "Harvested"],
            ["Shaderot", "PlantIShaderot", "Harvested"],
            ["Moss", "PlantNMoss", "Harvested"],
            ["Driftwood", "PlantODriftwood", "Harvested"],
            ["Iris", "PlantPIris", "Harvested"],
            ["Fangs", "PlantQFang", "Harvested"],
            ["Nightshade", "PlantFNightshade", "Grown"],
            ["Cattail", "PlantGCattail", "Grown"],
            ["Wheat", "PlantHWheat", "Grown"],
            ["Poppy", "PlantIPoppy", "Grown"],
            ["Garlic", "PlantNGarlic", "Grown"],
            ["Mandrake Root", "PlantOMandrake", "Grown"],
            ["Olive", "PlantPOlive", "Grown"],
            ["Snake-reed", "PlantQSnakereed", "Grown"],
            ["Thalamus", "PlantChaosThalamus", "Grown"],
            ["Origin Seeds", "PlantChaosThalamusSeed", "Seeds"],
            ["Nightshade Seeds", "PlantFNightshadeSeed", "Seeds"],
            ["Cattail Seeds", "PlantGCattailSeed", "Seeds"],
            ["Wheat Seeds", "PlantHWheatSeed", "Seeds"],
            ["Poppy Seeds", "PlantIPoppySeed", "Seeds"],
            ["Garlic Cloves", "PlantNGarlicSeed", "Seeds"],
            ["Mandrake Seeds", "PlantOMandrakeSeed", "Seeds"],
            ["Olive Branch", "PlantPOliveSeed", "Seeds"],
            ["Plankton", "PlantQSnakereedSeed", "Seeds"],
            ["Mystery Seeds", "SeedMystery", "Seeds"],
          ], "hades2"),
        },
        {
          id: "gifts",
          label: "Gifts",
          fields: resources([
            ["Nectar", "GiftPoints"],
            ["Bath Salts", "GiftPointsRare"],
            ["Twin Lures", "GiftPointsEpic"],
            ["Ambrosia", "SuperGiftPoints"],
            ["Witch's Delight", "FamiliarPoints"],
            ["Obol Points", "CharonPoints"],
            ["Tears, Vaporized", "MedeaPoints"],
            ["Ectoplasmic Draught", "IcarusPoints"],
            ["Gigaros", "HadesSpearPoints"],
            ["House Soot", "DeathAreaPoints"],
            ["Dream Vapors", "HypnosPoints"],
            ["Shiny Stars", "DreamPoints"],
            ["Kudos", "CosmeticsPoints"],
          ], "hades2"),
        },
        {
          id: "fish",
          label: "Fish",
          fields: resources([
            ["Moper", "FishFCommon", "Erebus"],
            ["Figment", "FishFRare", "Erebus"],
            ["Soulbelly", "FishFLegendary", "Erebus"],
            ["Chiton", "FishGCommon", "Oceanus"],
            ["Gutterpop", "FishGRare", "Oceanus"],
            ["Stalkfin", "FishGLegendary", "Oceanus"],
            ["Soby", "FishHCommon", "Fields of Mourning"],
            ["Anguish", "FishHRare", "Fields of Mourning"],
            ["Tearjerker", "FishHLegendary", "Fields of Mourning"],
            ["Jiffy", "FishICommon", "Tartarus"],
            ["Goldfish", "FishIRare", "Tartarus"],
            ["Styxeon", "FishILegendary", "Tartarus"],
            ["Ribeye", "FishNCommon", "City of Ephyra"],
            ["Zeel", "FishNRare", "City of Ephyra"],
            ["Neckbiter", "FishNLegendary", "City of Ephyra"],
            ["Shrimp", "FishOCommon", "Rift of Thessaly"],
            ["Chrab", "FishORare", "Rift of Thessaly"],
            ["Squid", "FishOLegendary", "Rift of Thessaly"],
            ["Pillartop", "FishPCommon", "Mount Olympus"],
            ["Chrestle", "FishPRare", "Mount Olympus"],
            ["Starsailor", "FishPLegendary", "Mount Olympus"],
            ["Lamprey", "FishQCommon", "The Summit"],
            ["Stormgullet", "FishQRare", "The Summit"],
            ["Chimaerid", "FishQLegendary", "The Summit"],
            ["Mati", "FishChaosCommon", "Chaos"],
            ["Projelly", "FishChaosRare", "Chaos"],
            ["Voidskate", "FishChaosLegendary", "Chaos"],
          ], "hades2"),
        },
        {
          id: "current-run",
          label: "Current run",
          fields: [
            numberField("Health", `${SAVE}.CurrentRun.Hero.Health`),
            numberField("Max Health", `${SAVE}.CurrentRun.Hero.MaxHealth`),
            numberField("Magick", `${SAVE}.CurrentRun.Hero.Mana`),
            numberField("Max Magick", `${SAVE}.CurrentRun.Hero.MaxMana`),
            numberField("Death Defiances used", `${SAVE}.CurrentRun.Hero.LastStandsUsed`),
            numberField("Max Death Defiances", `${SAVE}.CurrentRun.Hero.MaxLastStands`),
            numberField("Fates", `${SAVE}.CurrentRun.NumRerolls`),
            numberField("Gold Crowns", `${RESOURCES}.Money`, { search: "gold money" }),
          ],
        },
        {
          id: "arcana",
          label: "Arcana",
          layout: "arcana",
          toolbar: [graspLimit],
          summary: "grasp",
          fields: arcana,
        },
        { id: "keepsakes", label: "Keepsakes", fields: keepsakes },
        {
          id: "weapons",
          label: "Weapons",
          description: "Ranks match the Silver Pool. Lowering a rank removes the higher ranks from the save. Hidden aspects also mark their unlock conversation as seen.",
          fields: [...weapons, ...tools],
        },
        { id: "familiars", label: "Familiars", fields: familiars },
        {
          id: "oath",
          label: "Oath",
          summary: "fear",
          description: "Vow ranks set the Fear for your next night. Vow of Rivals needs the matching Rivals incantations for ranks II to IV.",
          fields: [
            toggleField("Oath of the Unseen", `${STATE}.TextLinesRecord.HecateGrantsShrineUpgrade01`, {
              group: "Oath",
              description: "Unlocks the Oath at the Crossroads.",
              search: "shrine",
            }),
            ...vows,
          ],
        },
        {
          id: "incantations",
          label: "Incantations",
          description: "Each one is marked as bought, seen and revealed, the same as the Cauldron does. Story incantations skip ahead in the story, so you may miss scenes.",
          fields: incantations,
        },
        {
          id: "achievements",
          label: "Achievements",
          tone: "warning",
          description: "The game sends every achievement marked here to Steam or your platform the next time it checks. Platform achievements can't be removed again from the save.",
          fields: achievements,
        },
        {
          id: "advanced",
          label: "Advanced",
          layout: "explorer",
          tone: "warning",
          description: "Every value in the save, including records the game keeps for itself. Most of these are rebuilt or checked by the game, so change them only if you know what they do.",
          notes: GAME.notes,
          fields: advanced,
        },
      ],
    },
  };

  // Resources added by a game patch show up even before someone sorts them.
  const listedPaths = new Set(catalog.hades2.sections.flatMap((section) => section.fields.map((field) => field.path)));
  const newResources = GAME.resources.filter((item) => !listedPaths.has(`${RESOURCES}.${item.key}`));
  if (newResources.length) {
    catalog.hades2.sections.find((section) => section.id === "resources").fields.push(
      ...newResources.map((item) => numberField(item.name, `${RESOURCES}.${item.key}`, {
        group: "Other",
        ...(item.icon ? { icon: itemIcon("hades2", item.key) } : {}),
      })),
    );
  }

  global.HadesEditorCatalog = Object.freeze(catalog);
})(typeof globalThis !== "undefined" ? globalThis : window);
