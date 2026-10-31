"use strict";

// Report buckets. The numbers match the report headings.
const BUCKETS = {
  1: "Most likely missing by accident after an update",
  2: "Missing, would be a nice addition",
  3: "Missing, probably on purpose: not needed",
  4: "Missing, probably on purpose because of UI/UX, but worth adding",
  5: "Missing, no need to add",
};

// What to do with an item the editor doesn't have, per entity group.
// `covered` lists the GameState tables the group writes to, so a group
// counts as "in the editor" once any field targets one of its items.
const GROUPS = {
  resources: {
    label: "Resources",
    bucket: 1,
    reason: "The editor already lists resources. A new one is almost always from a patch.",
  },
  keepsakes: {
    label: "Keepsakes",
    bucket: 1,
    reason: "The editor lists every keepsake from the rack.",
  },
  arcana: {
    label: "Arcana cards",
    bucket: 1,
    reason: "The editor shows the whole Arcana board.",
  },
  hiddenAspects: {
    label: "Hidden aspects",
    bucket: 1,
    reason: "The editor lists the hidden aspects that need a conversation to unlock.",
  },
  weapons: {
    label: "Nocturnal Arms",
    bucket: 2,
    reason: "Simple toggles in WeaponsUnlocked. Useful for new saves.",
  },
  aspects: {
    label: "Aspects",
    bucket: 2,
    reason: "Toggles next to the hidden aspects. The editor only has the hidden ones.",
  },
  aspectRanks: {
    label: "Aspect ranks",
    bucket: 2,
    reason: "Ranks 2-5 are separate unlock keys. Best shown as one rank picker per aspect.",
  },
  tools: {
    label: "Gathering tools",
    bucket: 2,
    reason: "Four toggles. Tools gate resource gathering.",
  },
  toolUpgrades: {
    label: "Tool upgrades",
    bucket: 2,
    reason: "One upgrade per tool. Fits next to the tool toggles.",
  },
  vows: {
    label: "Oath of the Unseen vows",
    bucket: 2,
    reason: "One rank number per vow. The editor already has the Oath unlock.",
  },
  familiars: {
    label: "Familiars",
    bucket: 2,
    reason: "Five toggles.",
  },
  familiarUpgrades: {
    label: "Familiar upgrades",
    bucket: 2,
    reason: "Three tracks of three ranks per familiar. Best as a rank picker per track.",
  },
  incantations: {
    label: "Cauldron incantations",
    bucket: 2,
    reason: "The editor has four. Many others are story steps, so they need care, but most are plain unlocks.",
  },
  repeatableIncantations: {
    label: "Repeatable incantations",
    bucket: 3,
    reason: "They turn reagents into resources. Editing the resource is simpler.",
  },
  badges: {
    label: "Rank badges",
    bucket: 2,
    reason: "Stored as one number, GameState.BadgeRank.",
  },
  cosmetics: {
    label: "Crossroads cosmetics",
    bucket: 4,
    reason: "About 180 items in four tabs, some mutually exclusive. Needs a grouped, searchable list.",
  },
  cosmeticVariants: {
    label: "Cosmetic variants",
    bucket: 5,
    reason: "Sub-parts and variants of shop cosmetics. The shop swaps them itself.",
  },
  otherWorldUpgrades: {
    label: "Other world upgrades",
    bucket: 4,
    reason: "Familiar costumes and other world upgrades. Owned through WorldUpgradesAdded.",
  },
  familiarCostumes: {
    label: "Familiar costumes",
    bucket: 4,
    reason: "Six per familiar. Best shown under each familiar.",
  },
  songs: {
    label: "Music player songs",
    bucket: 4,
    reason: "Stored as an ordered list in UnlockedMusicPlayerSongs. The editor has no list control yet.",
  },
  quests: {
    label: "Fated List prophecies",
    bucket: 4,
    reason: "Each has three states (Unlocked, Complete, CashedOut) and rewards. Needs a state picker.",
  },
  relationships: {
    label: "Relationships",
    bucket: 4,
    reason: "Hades II tracks hearts through gift conversations, not a number. Needs TextLinesRecord edits.",
  },
  chaosTrials: {
    label: "Chaos Trials",
    bucket: 4,
    reason: "Clear counts per trial. Rewards are paid when cleared, so editing only changes the board.",
  },
  shrineBounties: {
    label: "Oath boss bounties",
    bucket: 3,
    reason: "One-off Oath rewards. Marking them done skips the reward.",
  },
  codex: {
    label: "Codex entries",
    bucket: 4,
    reason: "Stored per chapter in CodexStatus with unlock thresholds. Large list.",
  },
  achievements: {
    label: "Achievements",
    bucket: 5,
    reason: "The game sends every flagged achievement to the platform at its next check, so setting one unlocks it for real.",
  },
};

// Single items that don't follow their group's rule.
const ITEM_OVERRIDES = {
  MysteryResource: { bucket: 5, reason: "UI placeholder for an unknown cost. A patch removes it from saves." },
  Money: { bucket: 2, reason: "Gold for the current run. The game resets it when a run starts." },
};

// Rules for GameState keys that aren't an entity group.
// Exact names first, then patterns. `bucket: 0` means the key belongs
// to an entity group above and is reported there.
const KEY_RULES = {
  Resources: { group: "resources" },
  KeepsakeChambers: { group: "keepsakes" },
  MetaUpgradeState: { group: "arcana" },
  WeaponsUnlocked: { group: "weapons" },
  WorldUpgrades: { group: "incantations" },
  WorldUpgradesAdded: { group: "incantations" },
  ShrineUpgrades: { group: "vows" },
  FamiliarsUnlocked: { group: "familiars" },
  FamiliarUpgrades: { group: "familiarUpgrades" },
  QuestStatus: { group: "quests" },
  BadgeRank: { group: "badges" },
  PackagedBountyClears: { group: "chaosTrials" },
  ShrineBountiesCompleted: { group: "shrineBounties" },
  AchievementsUnlocked: { group: "achievements" },
  UnlockedMusicPlayerSongs: { group: "songs" },
  GiftRecord: { group: "relationships" },
  GiftTextLinesOrderRecord: { group: "relationships" },

  WorldUpgradesViewed: { group: "incantations" },
  WorldUpgradesRevealed: { group: "incantations" },
  GamePhaseTicks: { bucket: 5, reason: "Crossroads night phase timer." },
  GamePhaseTargetTicks: { bucket: 5, reason: "Crossroads night phase timer." },
  GamePhaseLifetimeTicks: { bucket: 5, reason: "Crossroads night phase timer." },
  GardenLastPlantPicked: { bucket: 5, reason: "Remembers the last pick." },
  GardenLastSeedPlanted: { bucket: 5, reason: "Remembers the last seed." },
  IntroducedEagle: { bucket: 5, reason: "Presentation flag." },
  NPCInteractions: { bucket: 5, reason: "Bookkeeping." },
  NewKeepsakeItem: { bucket: 5, reason: "\"New\" marker on the keepsake rack." },
  NextBiomeStateName: { bucket: 3, reason: "Weather for the next run. Rolled by the game." },
  TraitsTaken: { bucket: 3, reason: "Boons ever picked. Feeds prophecies and the Codex. Set by playing." },
  WeaponRecordsShrinePoints: { bucket: 3, reason: "Best Fear per weapon." },
  MetaUpgradeLimitLevel: { bucket: 2, reason: "Grasp limit level, raised at the Altar of Ashes. Edited in Arcana." },
  GardenPlots: { bucket: 4, reason: "Per-plot seed and growth state, keyed by object id. A \"ripen all plots\" button would work." },
  TextLinesRecord: { bucket: 4, reason: "Every conversation seen. Drives story unlocks. Too big to show raw; better used as effects of other fields." },
  CodexEntriesViewed: { bucket: 5, reason: "Only clears the \"new\" marker." },
  SavedMetaUpgradeLayouts: { bucket: 3, reason: "Saved Arcana loadouts. Easy to set in game." },
  MetaUpgradeCardLayout: { bucket: 3, reason: "Arcana board layout. Fixed by the game." },
  CurrentMetaUpgradeLayout: { bucket: 3, reason: "Which saved Arcana loadout is active." },
  MetaUpgradeLayoutsArt: { bucket: 5, reason: "Cosmetic art for loadouts." },
  StoryResetCount: { bucket: 3, reason: "Story resets. Changing it can confuse epilogue checks." },
  ReachedTrueEnding: { bucket: 3, reason: "Story flag checked in many places. Setting it skips the story." },
  TyphonDefeatedWithStormStop: { bucket: 3, reason: "Story flag." },
  TyphonFakeDeathCount: { bucket: 3, reason: "Story flag." },
  GamePhase: { bucket: 3, reason: "Crossroads night phase. The game advances it." },
  GamePhaseRunsRemaining: { bucket: 3, reason: "Crossroads night phase. The game advances it." },
  EasyModeLevel: { bucket: 3, reason: "God Mode level. Edited in General." },
  EasyModeHadMaxPresentation: { bucket: 5, reason: "Presentation flag." },
  Flags: { bucket: 5, reason: "Tutorial and hint flags." },
  FatedStatus: { bucket: 3, reason: "Fated persuasion state for the ending. Story flag." },
  EquippedFamiliar: { bucket: 3, reason: "Set by picking a familiar in game." },
  EquippedToolName: { bucket: 3, reason: "Set by picking a tool in game." },
  PrimaryWeaponName: { bucket: 3, reason: "Set by picking a weapon in game." },
  LastAwardTrait: { bucket: 3, reason: "Equipped keepsake. Set in game." },
  LastWeaponUpgradeName: { bucket: 3, reason: "Equipped aspect per weapon. Set in game." },
  FamiliarCostumes: { bucket: 3, reason: "Equipped costume per familiar. Ownership lives in WorldUpgradesAdded." },
  MusicPlayerSongName: { bucket: 3, reason: "Current song." },
  MusicPlayerPlaylist: { bucket: 3, reason: "Current playlist." },
  CookStatus: { bucket: 3, reason: "Taverna cooking state." },
  MailboxStatus: { bucket: 3, reason: "Broker mail state." },
  StoreItemPins: { bucket: 5, reason: "UI pins." },
  StoreItemPinsPurchased: { bucket: 5, reason: "UI pins." },
  ActiveShrineBounty: { bucket: 5, reason: "Bounty in progress." },
  StoredActiveShrineBounty: { bucket: 5, reason: "Bounty in progress." },
  ActiveObjectiveSet: { bucket: 5, reason: "Tutorial objective." },
  ActiveLitter: { bucket: 5, reason: "Crossroads clutter state." },
  ResourcesInEscrow: { bucket: 5, reason: "Temporary resource hold during a run." },
  NextRunSeed: { bucket: 2, reason: "Seed for the next run. Edited in General." },
  RunHistory: { bucket: 3, reason: "Past runs. Several caches are rebuilt from it." },
  MoneySpentTowardCharonPoints: { bucket: 3, reason: "Progress toward the next Obol point." },
  NextCharonPointCache: { bucket: 5, reason: "Cache." },
  NemesisBetWinnings: { bucket: 3, reason: "Stat." },
  ConsecutiveClears: { bucket: 3, reason: "Clear streak. Changes the Run History stats only." },
  ConsecutiveClearsRecord: { bucket: 3, reason: "Best clear streak." },
  RandomBountyClearStreak: { bucket: 3, reason: "Streak." },
  RandomBountyHighestClearStreak: { bucket: 3, reason: "Streak." },
  ClearedWithWeapons: { bucket: 3, reason: "Feeds prophecies and achievements. Set by playing." },
  ClearedWithAspects: { bucket: 3, reason: "Feeds prophecies and achievements. Set by playing." },
  ClearedWithFamiliars: { bucket: 3, reason: "Feeds prophecies. Set by playing." },
  ClearedWithMetaUpgrades: { bucket: 3, reason: "Feeds prophecies. Set by playing." },
  ClearedFullRunWithKeepsakes: { bucket: 3, reason: "Feeds prophecies. Set by playing." },
  DreamRunClearedWithWeapons: { bucket: 3, reason: "Feeds prophecies. Set by playing." },
  Gift: { bucket: 5, reason: "Left over from Hades. No Hades II script reads it." },
  GiftPresentation: { bucket: 5, reason: "Written as an effect of the keepsake fields." },
  GiftResourceRecord: { bucket: 3, reason: "Totals of gifts given." },
  SpecialInteractRecord: { bucket: 5, reason: "Bookkeeping." },
  ExorcisedNames: { bucket: 3, reason: "Shades exorcised. Feeds a prophecy." },
  FishCaught: { bucket: 3, reason: "Fish caught. Fish themselves are resources." },
  OlympianFinalBattleAssists: { bucket: 3, reason: "Stat." },
  SpellSummons: { bucket: 3, reason: "Stat." },
  TraitsSold: { bucket: 3, reason: "Stat." },
  IllegalConversationModification: { bucket: 5, reason: "Anti-tamper marker for conversations. Don't touch." },
  StoredGameState: { bucket: 5, reason: "Temporary copy during story reset." },
  IsDreamRun: { bucket: 5, reason: "Run state." },
  FamiliarStatus: { bucket: 5, reason: "Familiar bookkeeping." },
  FamiliarRestTicks: { bucket: 5, reason: "Familiar bookkeeping." },
  FamiliarResourceSpawnChance: { bucket: 5, reason: "Familiar bookkeeping." },
  FamiliarUses: { bucket: 5, reason: "Familiar bookkeeping." },
  FrogPetRunCount: { bucket: 5, reason: "Bookkeeping." },
  InspectData: { bucket: 5, reason: "Bookkeeping." },
  ItemInteractions: { bucket: 5, reason: "Bookkeeping." },
  LocationName: { bucket: 5, reason: "Set on save." },
  InventoryCategoryIndex: { bucket: 5, reason: "UI state." },
  RunHistoryGameStatsSortMode: { bucket: 5, reason: "UI state." },
  CauseOfDeath: { bucket: 5, reason: "Last run result." },
  CauseOfDeathDisplay: { bucket: 5, reason: "Last run result." },
  LastKilledByName: { bucket: 5, reason: "Last run result." },
  ErisCurseRewardTaken: { bucket: 5, reason: "Bookkeeping." },
  PolymorphRecord: { bucket: 5, reason: "Bookkeeping." },
  NPCShopItemStolenRecord: { bucket: 5, reason: "Bookkeeping." },
  QuestsCompleted: { bucket: 0, group: "quests" },
  QuestsViewed: { bucket: 5, reason: "Clears the \"new\" marker." },
  QuestsUpdated: { bucket: 5, reason: "Clears the \"new\" marker." },
  SurfaceShopPurchases: { bucket: 5, reason: "Bookkeeping." },
  CosmeticsPurchasedCountCache: { bucket: 5, reason: "Cache." },
  TraitUses: { bucket: 5, reason: "Bookkeeping." },
  TimesCleared: { bucket: 5, reason: "Legacy counter from Hades." },
  TimesClearedWeapon: { bucket: 5, reason: "Legacy counter from Hades." },
  WeaponHistory: { bucket: 5, reason: "Bookkeeping." },
  WeaponsTouched: { bucket: 5, reason: "Bookkeeping." },
  WeaponUnlocks: { bucket: 5, reason: "Legacy table. Unlocks live in WeaponsUnlocked." },
  BountiesCompleted: { bucket: 5, reason: "Legacy table." },
  PackagedBountyAttempts: { bucket: 5, reason: "Bookkeeping." },
  PackgedBountyAttempts: { bucket: 5, reason: "Misspelt legacy key." },
  PackagedBountyClearRecordTime: { bucket: 3, reason: "Best trial times." },
  PackagedBountyClearStreak: { bucket: 3, reason: "Trial streaks." },
  PackagedBountyHighestClearStreak: { bucket: 3, reason: "Trial streaks." },
  BoonInfoScreenShowTooltips: { bucket: 5, reason: "UI setting." },
  CheckProgressAchievementsRuns: { bucket: 5, reason: "Achievement bookkeeping." },
  CauldronWitchcraftCount: { bucket: 5, reason: "Bookkeeping." },
  FieldsRewardFindersActivated: { bucket: 5, reason: "Bookkeeping." },
  SaveFirstKeepsakeName: { bucket: 5, reason: "Bookkeeping." },
  TotalRequiredEnemyKills: { bucket: 5, reason: "Bookkeeping." },
  SprintAutoHoldDetected: { bucket: 5, reason: "Input bookkeeping." },
  SkyEntranceInputSuccess: { bucket: 5, reason: "Input bookkeeping." },
  NightmaresOccurred: { bucket: 5, reason: "Bookkeeping." },
  ScyllaDefeatMusicRecord: { bucket: 5, reason: "Music bookkeeping." },
  TyphonTremorPresentation: { bucket: 5, reason: "Presentation flag." },
  MetaUpgradeCostCache: { bucket: 5, reason: "Cache." },
  MaxMetaUpgradeCostCache: { bucket: 5, reason: "Cache." },
  MetaUpgradeMaxLevelCountCache: { bucket: 5, reason: "Cache." },
  MetaUpgradeUnlockedCountCache: { bucket: 5, reason: "Cache." },
  PrevMetaUpgradeLayout: { bucket: 5, reason: "UI state." },
};

const PATTERN_RULES = [
  [/^Patched|BackCompat|^Removed|^ResourceAssertIgnored$/, 5, "Patch migration flag. The game sets it once."],
  [/Cache$/, 5, "Cache the game rebuilds."],
  [/Viewed$|^Seen|Seen$|Introduced$|Presentation$/, 5, "\"New\" markers and presentation flags."],
  [/^Speech|^Trigger|^Played|^Remaining|^LastPlay|TextLinePanel|TextLinesChoice|^Music(Record|EndRecord)|^BiomeMusic/, 5, "Dialogue and music bookkeeping."],
  [/^Last|Unviewed/, 5, "Remembers the last thing that happened."],
  [/Successes|Fails$|Kills$|Sales$|Time$|Stats$|Record$|Records$|Damage|Spawns|Visits$|Pickups$|RoomsEntered|UseRecord|ObjectivesCompleted|ObjectivesFailed|CompletedObjectiveSets|LifetimeResources/, 3, "Lifetime stat or record."],
  [/^Assist|^MetaUpgrades|^MetaUpgradesSelected|^MetaUpgradesUnlocked|^ShrinePointClears|^RecordClearedShrine|^RecordLastClearedShrine|^ReturnedRandom|^PromptCustom|^MusicTracks|^EnemyDamage$|^EnemySpawns$/, 5, "Left over from Hades. Few or no Hades II scripts read it."],
];

function ruleForKey(key) {
  if (KEY_RULES[key]) return KEY_RULES[key];
  for (const [pattern, bucket, reason] of PATTERN_RULES) {
    if (pattern.test(key)) return { bucket, reason, pattern: true };
  }
  return null;
}

// Save root keys next to GameState.
const ROOT_RULES = {
  GameState: { bucket: 0 },
  CurrentRun: { bucket: 0 },
  CodexStatus: { group: "codex" },
  NextSeeds: { bucket: 2, reason: "Random seeds. Edited in General." },
  MapState: { bucket: 5, reason: "Per-room object state." },
  AudioState: { bucket: 5, reason: "Audio settings mirror." },
  CurrentHubRoom: { bucket: 5, reason: "Where you are in the Crossroads." },
  Revision: { bucket: 5, reason: "Build of the game that wrote this save." },
  _worldTime: { bucket: 5, reason: "Engine clock." },
  _worldTimeUnmodified: { bucket: 5, reason: "Engine clock." },
};

// Outer header fields of a Hades II save. Layout and sources are from
// Hades2.exe (save-file-work/notes/SCHEMA.md). The game reads most of them
// only for the profile screen and rewrites them on every save.
const HEADER_RULES = {
  version: { bucket: 5, reason: "Format version, 17 or 18. Version 18 adds cosmetics_points." },
  version_flags: { bucket: 5, reason: "Bit 0 set means the game marked this save as cheated. The mark stays on later saves." },
  timestamp: { bucket: 5, reason: "Save time. Shown on the profile screen." },
  location: { bucket: 5, reason: "Copy of GameState.LocationName for the profile screen." },
  runs: { bucket: 3, reason: "Copy of GameState.CompletedRunsCache for the profile screen." },
  accumulated_meta_points: { bucket: 5, reason: "Always 0 in Hades II." },
  active_shrine_points: { bucket: 3, reason: "Fear. Copy of GameState.SpentShrinePointsCache for the profile screen." },
  meta_upgrade_level: { bucket: 3, reason: "Grasp. Copy of GameState.MaxMetaUpgradeCostCache for the profile screen." },
  cosmetics_points: { bucket: 3, reason: "Copy of lifetime Kudos gained, for the profile screen." },
  easy_mode: { bucket: 5, reason: "God Mode setting when the game saved. Shown on the profile screen; the setting itself is not in the save." },
  hard_mode: { bucket: 5, reason: "Always 0 in Hades II." },
  notable_lua_data: { bucket: 5, reason: "Summary the game writes for its own records. Ignored on load." },
  current_map: { bucket: 5, reason: "Map the game loads, unless start_next_map is set." },
  start_next_map: { bucket: 5, reason: "Map to load instead of current_map. Empty most of the time." },
  luabin: { bucket: 0 },
};

// CurrentRun keys worth editing. Everything else in a run is engine state.
const RUN_RULES = {
  "Hero.Health": { bucket: 0 },
  "Hero.MaxHealth": { bucket: 0 },
  "Hero.Mana": { bucket: 0 },
  "Hero.MaxMana": { bucket: 0 },
  "Hero.LastStandsUsed": { bucket: 0 },
  "Hero.MaxLastStands": { bucket: 0 },
  NumRerolls: { bucket: 0 },
  "Hero.HealthBuffer": { bucket: 3, reason: "Armor. The game resets it often." },
  "Hero.Traits": { bucket: 4, reason: "Boons in the run. Needs trait data per boon; very easy to break a run." },
  "Hero.Weapons": { bucket: 5, reason: "Engine state." },
  RunDepthCache: { bucket: 5, reason: "Cache." },
  BiomeDepthCache: { bucket: 5, reason: "Cache." },
};

module.exports = {
  BUCKETS,
  GROUPS,
  ITEM_OVERRIDES,
  KEY_RULES,
  ROOT_RULES,
  HEADER_RULES,
  RUN_RULES,
  ruleForKey,
};
