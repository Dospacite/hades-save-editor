(function attachEditorCatalog(global) {
  "use strict";

  // Audited against the installed game Lua and English SJSON data on 2026-08-03.

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

  // Current 5x5 board order, art, and Grasp costs from MetaUpgradeData.lua.
  const arcana = [
    ["The Sorceress", "ChanneledCast", "01", 1],
    ["The Wayward Son", "HealthRegen", "02", 1],
    ["The Huntress", "LowManaDamageBonus", "03", 2],
    ["Eternity", "CastCount", "12", 3],
    ["The Moon", "SorceryRegenUpgrade", "05", 0],
    ["The Furies", "CastBuff", "06", 2],
    ["Persistence", "BonusHealth", "07", 2],
    ["The Messenger", "BonusDodge", "08", 1],
    ["The Unseen", "ManaOverTime", "09", 5],
    ["Night", "MagicCrit", "04", 2],
    ["The Swift Runner", "SprintShield", "11", 1],
    ["Death", "LastStand", "10", 4],
    ["The Centaur", "MaxHealthPerRoom", "13", 0],
    ["Origination", "StatusVulnerability", "14", 5],
    ["The Lovers", "ChanneledBlock", "15", 3],
    ["The Enchantress", "DoorReroll", "21", 3],
    ["The Boatman", "StartingGold", "17", 5],
    ["The Artificer", "MetaToRunUpgrade", "18", 3],
    ["Excellence", "RarityBoost", "19", 5],
    ["The Queen", "BonusRarity", "20", 0],
    ["The Fates", "TradeOff", "16", 0],
    ["The Champions", "ScreenReroll", "22", 4],
    ["Strength", "LowHealthBonus", "23", 4],
    ["Divinity", "EpicRarityBoost", "24", 1],
    ["Judgment", "CardDraw", "25", 1],
  ].map(([label, key, image, grasp], index) => ({
    type: "arcana",
    label,
    path: `${STATE}.MetaUpgradeState.${key}`,
    icon: arcanaIcon(image),
    grasp,
    position: index + 1,
    search: `rank unlocked ${key}`,
  }));

  const keepsake = (label, key, textLine) => numberField(
    label,
    `${STATE}.KeepsakeChambers.${key}`,
    {
      icon: keepsakeIcon(key),
      effects: [
        { path: `${STATE}.GiftPresentation.${key}`, value: true, when: "truthy" },
        { path: `${STATE}.TextLinesRecord.${textLine}`, value: true, when: "truthy" },
      ],
    },
  );

  const keepsakes = [
    keepsake("Silver Wheel", "ManaOverTimeRefundKeepsake", "HecateGift01"),
    keepsake("Knuckle Bones", "BossPreDamageKeepsake", "OdysseusGift01"),
    keepsake("Luckier Tooth", "ReincarnationKeepsake", "SkellyGift01"),
    keepsake("Ghost Onion", "DoorHealReserveKeepsake", "DoraGift01"),
    keepsake("Evil Eye", "DeathVengeanceKeepsake", "NemesisGift01"),
    keepsake("Gold Purse", "BonusMoneyKeepsake", "CharonGift01"),
    keepsake("Engraved Pin", "BlockDeathKeepsake", "MorosGift01"),
    keepsake("Discordant Bell", "EscalatingKeepsake", "ErisGift01"),
    keepsake("Metallic Droplet", "TimedBuffKeepsake", "HermesGift01"),
    keepsake("White Antler", "LowHealthCritKeepsake", "ArtemisGift01"),
    keepsake("Moon Beam", "SpellTalentKeepsake", "SeleneGift01"),
    keepsake("Cloud Bangle", "ForceZeusBoonKeepsake", "ZeusGift01"),
    keepsake("Iridescent Fan", "ForceHeraBoonKeepsake", "HeraGift01"),
    keepsake("Vivid Sea", "ForcePoseidonBoonKeepsake", "PoseidonGift01"),
    keepsake("Barley Sheaf", "ForceDemeterBoonKeepsake", "DemeterGift01"),
    keepsake("Harmonic Photon", "ForceApolloBoonKeepsake", "ApolloGift01"),
    keepsake("Beautiful Mirror", "ForceAphroditeBoonKeepsake", "AphroditeGift01"),
    keepsake("Adamant Shard", "ForceHephaestusBoonKeepsake", "HephaestusGift01"),
    keepsake("Everlasting Ember", "ForceHestiaBoonKeepsake", "HestiaGift01"),
    keepsake("Sword Hilt", "ForceAresBoonKeepsake", "AresGift01"),
    keepsake("Gorgon Amulet", "AthenaEncounterKeepsake", "AthenaGift01"),
    keepsake("Fig Leaf", "SkipEncounterKeepsake", "DionysusGift01"),
    keepsake("Silken Sash", "ArmorGainKeepsake", "ArachneGift01"),
    keepsake("Aromatic Phial", "FountainRarityKeepsake", "NarcissusGift01"),
    keepsake("Concave Stone", "UnpickedBoonKeepsake", "EchoGift01"),
    keepsake("Lion Fang", "DecayingBoostKeepsake", "HeraclesGift01"),
    keepsake("Blackened Fleece", "DamagedDamageBoostKeepsake", "MedeaGift01"),
    keepsake("Crystal Figurine", "BossMetaUpgradeKeepsake", "CirceGift01"),
    keepsake("Experimental Hammer", "TempHammerKeepsake", "IcarusGift01"),
    keepsake("Jeweled Pom", "HadesAndPersephoneKeepsake", "HadesWithPersephoneGift01"),
    keepsake("Calling Card", "RarifyKeepsake", "ZagreusBossGrantsKeepsakeOutro01"),
    keepsake("Time Piece", "GoldifyKeepsake", "NeoChronosGift01"),
    keepsake("Transcendent Embryo", "RandomBlessingKeepsake", "ChaosGift01"),
  ];

  const hiddenAspect = (label, key, textLine) => toggleField(
    label,
    `${STATE}.WeaponsUnlocked.${key}`,
    {
      effects: [{
        path: `${STATE}.TextLinesRecord.${textLine}`,
        value: true,
        when: "truthy",
      }],
    },
  );

  const catalog = {
    hades: {
      label: "Hades",
      sections: [
        {
          id: "general",
          label: "General",
          fields: [
            toggleField("God Mode", "save_data.god_mode_enabled", { storedAsByte: true }),
            toggleField("Hell Mode", "save_data.hell_mode_enabled", { storedAsByte: true }),
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
      ],
    },

    hades2: {
      label: "Hades II",
      sections: [
        {
          id: "general",
          label: "General",
          fields: [
            numberField("God Mode level", `${STATE}.EasyModeLevel`, { max: 30 }),
            toggleField("God Mode", "save_data.god_mode_enabled", { storedAsByte: true }),
            toggleField("Hell Mode", "save_data.hell_mode_enabled", { storedAsByte: true }),
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
          ],
        },
        { id: "arcana", label: "Arcana", layout: "arcana", fields: arcana },
        { id: "keepsakes", label: "Keepsakes", fields: keepsakes },
        {
          id: "unlocks",
          label: "Unlocks",
          fields: [
            toggleField("Oath of the Unseen", `${STATE}.TextLinesRecord.HecateGrantsShrineUpgrade01`),
            toggleField("Rivals of Depth and Sea", `${STATE}.WorldUpgradesAdded.WorldUpgradeBossDifficultyT2`),
            toggleField("Rivals of Plain and Peak", `${STATE}.WorldUpgradesAdded.WorldUpgradeBossDifficultyT3`),
            toggleField("Rivals of Old and Rot", `${STATE}.WorldUpgradesAdded.WorldUpgradeBossDifficultyT4`),
            toggleField("Greatest Gift of Gaia", `${STATE}.WorldUpgradesAdded.WorldUpgradeAutoHarvestOnExit`),
            hiddenAspect("Aspect of Anubis — Staff", "StaffRaiseDeadAspect", "CirceGrantsHiddenAspect01"),
            hiddenAspect("Aspect of the Morrigan — Blades", "DaggerTripleAspect", "ArtemisGrantsHiddenAspect01"),
            hiddenAspect("Aspect of Supay — Torches", "TorchAutofireAspect", "MorosGrantsHiddenAspect01"),
            hiddenAspect("Aspect of Nergal — Axe", "AxeRallyAspect", "CharonGrantsHiddenAspect01"),
            hiddenAspect("Aspect of Hel — Skull", "LobGunAspect", "MedeaGrantsHiddenAspect01"),
            hiddenAspect("Aspect of Shiva — Coat", "SuitComboAspect", "SeleneGrantsHiddenAspect01"),
          ],
        },
      ],
    },
  };

  global.HadesEditorCatalog = Object.freeze(catalog);
})(typeof globalThis !== "undefined" ? globalThis : window);
