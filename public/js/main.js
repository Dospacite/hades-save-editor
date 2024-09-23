structData = {
  "fields": [
    {
      "label": "signature",
      "type": "padding",
      "size": 4
    },
    {
      "label": "checksum",
      "type": "padding",
      "size": 4
    },
    {
      "label": "save_data",
      "type": "struct",
      "fields": [
        {
          "label": "version",
          "type": "int32"
        },
        {
          "label": "timestamp",
          "type": "int64"
        },
        {
          "label": "location",
          "type": "string"
        },
        {
          "label": "runs",
          "type": "int32"
        },
        {
          "label": "active_meta_points",
          "type": "int32"
        },
        {
          "label": "active_shrine_points",
          "type": "int32"
        },
        {
          "label": "god_mode_enabled",
          "type": "int8"
        },
        {
          "label": "hell_mode_enabled",
          "type": "int8"
        },
        {
          "label": "lua_keys",
          "type": "array",
          "content": {
            "type": "string"
          }
        },
        {
          "label": "current_map_name",
          "type": "string"
        },
        {
          "label": "start_next_map",
          "type": "string"
        },
        {
          "label": "luabin",
          "type": "array",
          "content": {
            "type": "int8"
          }
        }
      ]
    }
  ]
}

structData_2 = {
  "fields": [
    {
      "label": "signature",
      "type": "padding",
      "size": 4
    },
    {
      "label": "checksum",
      "type": "padding",
      "size": 4
    },
    {
      "label": "save_data",
      "type": "struct",
      "fields": [
        {
          "label": "version",
          "type": "int32"
        },
        {
          "label": "timestamp",
          "type": "int64"
        },
        {
          "label": "location",
          "type": "string"
        },
        {
          "label": "padding1",
          "type": "padding",
          "size": 12
        },
        {
          "label": "runs",
          "type": "int32"
        },
        {
          "label": "god_mode_enabled",
          "type": "int8"
        },
        {
          "label": "hell_mode_enabled",
          "type": "int8"
        },
        {
          "label": "lua_keys",
          "type": "array",
          "content": {
            "type": "string"
          }
        },
        {
          "label": "current_map_name",
          "type": "string"
        },
        {
          "label": "start_next_map",
          "type": "string"
        },
        {
          "label": "luabin",
          "type": "array",
          "content": {
            "type": "int8"
          }
        }
      ]
    }
  ]
}

let saveData = null;

const fileSelector = document.getElementById("file-selector");
const fileDownload = document.getElementById("file-download");
const preSelectContent = document.getElementById("pre-select-content");
const saveEdit = document.getElementById("save-edit");
const fileUpload = document.getElementById("file-upload");
const isHadesTwo = document.getElementById("hades2");

fileUpload.ondrop = function (event) {
  event.preventDefault();

  event.target.files = event.dataTransfer.files;
  loadFile(event);
}

fileUpload.ondragover = function (event) {
  event.preventDefault();
  fileUpload.classList.add("file-dragged-over");
}

fileUpload.ondragleave = function (event) {
  event.preventDefault();
  fileUpload.classList.remove("file-dragged-over");
}

fileUpload.ondragend = function (event) {
  fileUpload.classList.remove("file-dragged-over");
}

fileSelector.onchange = function (event) {
  loadFile(event);
}

function loadFile(event) {
  const reader = new FileReader();
  reader.addEventListener("load", (event) => readFile(event));
  reader.readAsArrayBuffer(event.target.files[0]);
}

function readFile(event) {
  let dataUsed = isHadesTwo.checked ? structData_2 : structData;
  let buffer = Buffer.from(event.target.result);
  let struct = new Struct(dataUsed, buffer);
  struct.parse();

  saveData = struct.data;
  applyFields(saveData);

  fileDownload.classList.remove("disabled");
  fileDownload.textContent = "Download Save File";
  fileDownload.addEventListener("click", (event) => downloadFile(event));

  preSelectContent.hidden = true;
  saveEdit.scrollIntoView();
}

function downloadFile() {
  let dataUsed = isHadesTwo.checked ? structData_2 : structData;
  let output = Buffer.alloc(1E7);
  let outStruct = new Struct(dataUsed, output);
  outStruct.data = saveData;
  outStruct.output()
  output = output.slice(0, outStruct.offset)

  let fileName = document.getElementById("file-download-name").value;

  downloadBlob(output, fileName, "application/octet-stream");
}

function downloadBlob(data, fileName, mimeType) {
  let blob, url;
  blob = new Blob([data], {
    type: mimeType
  });
  url = window.URL.createObjectURL(blob);
  downloadURL(url, fileName);
  setTimeout(function() {
    return window.URL.revokeObjectURL(url);
  }, 1000);
};

function downloadURL(data, fileName) {
  let a;
  a = document.createElement('a');
  a.href = data;
  a.download = fileName;
  document.body.appendChild(a);
  a.style = 'display: none';
  a.click();
  a.remove();
};

saveEditTabButtons = document.getElementsByClassName("save-edit__tab");
// For each element, add a click event listener
for (let i = 0; i < saveEditTabButtons.length; i++) {
  saveEditTabButtons[i].addEventListener("click", function() {
    // Get the parent element of the clicked button
    let parent = this.parentElement;
    // Get all the children of the parent element
    let children = parent.children;
    // For each child, remove the active class
    for (let j = 0; j < children.length; j++) {
      // Get Tab Content
      let tabContent = document.getElementById(children[j].attributes["data-tab"].value);
      tabContent.classList.remove("active");
      children[j].classList.remove("selected");
    }
    // Add the active class to the clicked button
    let tabContent = document.getElementById(this.attributes["data-tab"].value);
    tabContent.classList.add("active");
    this.classList.add("selected");
  });
}


function change(obj, path, value) {
  if(typeof value === "string" && !isNaN(value)) value = Number(value);
  const pathArray = path.split(".");
  const result = pathArray.reduce((acc, curr, i) => {
    if (i === pathArray.length - 1) {
      acc[curr] = value;
    } else {
      acc[curr] = acc[curr] || {};
    }
    return acc[curr];
  }, obj);
}


function resolve(path, obj= self, separator='.') {
  let properties = Array.isArray(path) ? path : path.split(separator);
  return properties.reduce((prev, curr) => prev?.[curr], obj);
}

fields = {
  "general": [
    {
      "label": "Next Seeds",
      "location": "save_data.luabin.0.NextSeeds"
    },
    {
      "label": "God Mode Enabled",
      "location": "save_data.god_mode_enabled",
      "inputType": "checkbox"
    },
    {
      "label": "Hell Mode Enabled",
      "location": "save_data.hell_mode_enabled",
      "inputType": "checkbox"
    }
  ],
  "resources": [
    {
      "label": "Gemstone",
      "location": "save_data.luabin.0.GameState.Resources.Gems"
    },
    {
      "label": "Nectar",
      "location": "save_data.luabin.0.GameState.Resources.GiftPoints"
    },
    {
      "label": "Chthonic Key",
      "location": "save_data.luabin.0.GameState.Resources.LockKeys"
    },
    {
      "label": "Darkness",
      "location": "save_data.luabin.0.GameState.Resources.MetaPoints"
    },
    {
      "label": "Diamond",
      "location": "save_data.luabin.0.GameState.Resources.SuperGems"
    },
    {
      "label": "Ambrosia",
      "location": "save_data.luabin.0.GameState.Resources.SuperGiftPoints"
    },
    {
      "label": "Titan Blood",
      "location": "save_data.luabin.0.GameState.Resources.SuperLockKeys"
    }
  ],
  "gifting": [
    {
      "label": "Achilles",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Achilles_01.Value"
    },
    {
      "label": "Aphrodite",
      "location": "save_data.luabin.0.GameState.Gift.AphroditeUpgrade.Value"
    },
    {
      "label": "Ares",
      "location": "save_data.luabin.0.GameState.Gift.AresUpgrade.Value"
    },
    {
      "label": "Artemis",
      "location": "save_data.luabin.0.GameState.Gift.ArtemisUpgrade.Value"
    },
    {
      "label": "Athena",
      "location": "save_data.luabin.0.GameState.Gift.AthenaUpgrade.Value"
    },
    {
      "label": "Bouldy",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Bouldy_01.Value"
    },
    {
      "label": "Cerberus",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Cerberus_01.Value"
    },
    {
      "label": "Charon",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Charon_01.Value"
    },
    {
      "label": "Demeter",
      "location": "save_data.luabin.0.GameState.Gift.DemeterUpgrade.Value"
    },
    {
      "label": "Dionysus",
      "location": "save_data.luabin.0.GameState.Gift.DionysusUpgrade.Value"
    },
    {
      "label": "Dusa",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Dusa_01.Value"
    },
    {
      "label": "Eurydice",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Eurydice_01.Value"
    },
    {
      "label": "Megaera",
      "location": "save_data.luabin.0.GameState.Gift.NPC_FurySister_01.Value"
    },
    {
      "label": "Hades",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Hades_01.Value"
    },
    {
      "label": "Hermes",
      "location": "save_data.luabin.0.GameState.Gift.HermesUpgrade.Value"
    },
    {
      "label": "Hypnos",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Hypnos_01.Value"
    },
    {
      "label": "Nyx",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Nyx_01.Value"
    },
    {
      "label": "Orpheus",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Orpheus_01.Value"
    },
    {
      "label": "Patroclus",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Patroclus_01.Value"
    },
    {
      "label": "Persephone Home",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Persephone_Home_01.Value"
    },
    {
      "label": "Poseidon",
      "location": "save_data.luabin.0.GameState.Gift.PoseidonUpgrade.Value"
    },
    {
      "label": "Sisyphus",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Sisyphus_01.Value"
    },
    {
      "label": "Skelly",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Skelly_01.Value"
    },
    {
      "label": "Thanatos",
      "location": "save_data.luabin.0.GameState.Gift.NPC_Thanatos_01.Value"
    },
    {
      "label": "Zeus",
      "location": "save_data.luabin.0.GameState.Gift.ZeusUpgrade.Value"
    }

  ]
}

fields_2 = {
  "general": [
    {
      "label": "Easy Mode Level",
      "location": "save_data.luabin.0.GameState.EasyModeLevel"
    }
  ],
  "currentRun": [
    {
      "label": "Health",
      "location": "save_data.luabin.0.GameState.CurrentRun.Health"
    },
    {
      "label": "Money",
      "location": "save_data.luabin.0.GameState.CurrentRun.Money"
    },
    {
      "label": "Last Stands Used",
      "location": "save_data.luabin.0.GameState.CurrentRun.LastStandsUsed"
    },
    {
      "label": "Max Last Stands",
      "location": "save_data.luabin.0.GameState.CurrentRun.MaxLastStands"
    },
  ],
  "arcanaCards": [
    {
      "label": "The Sorceress",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.ChanneledCast",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Huntress",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.LowManaDamageBonus",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Titan",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.BonusHealth",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Unseen",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.ManaOverTime",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Furies",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.CastBuff",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Boatman",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.StartingGold",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Swift Runner",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.SprintShield",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Lovers",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.ChanneledBlock",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Wayward Son",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.HealthRegen",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Eternity",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.LastStand",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Moon",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.CastCount",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Messenger",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.BonusDodge",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Centaur",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.MaxHealthPerRoom",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Origination",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.StatusVulnerability",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Death",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.MagicCrit",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Seer",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.TradeOff",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Fates",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.DoorReroll",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Champions",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.ScreenReroll",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Excellence",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.RarityBoost",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Divinity",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.EpicRarityBoost",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Queen",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.BonusRarity",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Judgment",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.CardDraw",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Night",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.SorceryRegenUpgrade",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "Strength",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.LowHealthBonus",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    },
    {
      "label": "The Artificer",
      "location": "save_data.luabin.0.GameState.MetaUpgradeState.MetaToRunUpgrade",
      "excludedFields": ["AdjacencyBonuses"],
      "inputType": "dict"
    }
  ],
  "keepsakes": [
    {
      "label": "Silver Wheel",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ManaOverTimeRefundKeepsake",
      "pathTrue": "HecateGift01",
    },
    {
      "label": "Knuckle Bones",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.BossPreDamageKeepsake",
      "pathTrue": "OdysseusGift01",

    },
    {
      "label": "Crystal Figurine",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.BossMetaUpgradeKeepsake",
      "pathTrue": "CirceGift01",
    },
    {
      "label": "Ghost Onion",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.DoorHealReserveKeepsake",
      "pathTrue": "DoraGift01",
    },
    {
      "label": "Luckier Tooth",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ReincarnationKeepsake",
      "pathTrue": "SkellyGift01",
    },
    {
      "label": "Engraved Pin",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.BlockDeathKeepsake",
      "pathTrue": "MorosGift01",
    },
    {
      "label": "Evil Eye",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.DeathVengeanceKeepsake",
      "pathTrue": "NemesisGift01",
    },
    {
      "label": "Gold Purse",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.BonusMoneyKeepsake",
      "pathTrue": "CharonGift01",
    },
    {
      "label": "White Antler",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.LowHealthCritKeepsake",
      "pathTrue": "ArtemisGift01",
    },
    {
      "label": "Moon Beam",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.SpellTalentKeepsake",
      "pathTrue": "SeleneGift01",
    },
    {
      "label": "Silken Sash",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ArmorGainKeepsake",
      "pathTrue": "ArachneGift01",
    },
    {
      "label": "Experimental Hammer",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.TempHammerKeepsake",
      "pathTrue": "IcarusGift01",
    },
    {
      "label": "Aromatic Phial",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.FountainRarityKeepsake",
      "pathTrue": "NarcissusGift01",
    },
    {
      "label": "Transcendent Embryo",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.RandomBlessingKeepsake",
      "pathTrue": "ChaosGift01",
    },
    {
      "label": "Concave Stone",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.UnpickedBoonKeepsake",
      "pathTrue": "EchoGift01",
    },
    {
      "label": "Cloud Bangl",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceZeusBoonKeepsake",
      "pathTrue": "ZeusGift01",
    },
    {
      "label": "Iridescent Fan",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceHeraBoonKeepsake",
      "pathTrue": "HeraGift01",
    },
    {
      "label": "Vivid Sea",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForcePoseidonBoonKeepsake",
      "pathTrue": "PoseidonGift01",
    },
    {
      "label": "Purest Hope",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceApolloBoonKeepsake",
      "pathTrue": "ApolloGift01",
    },
    {
      "label": "Barley Sheaf",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceDemeterBoonKeepsake",
      "pathTrue": "DemeterGift01",
    },
    {
      "label": "Beautiful Mirror",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceAphroditeBoonKeepsake",
      "pathTrue": "AphroditeGift01",
    },
    {
      "label": "Adamant Shard",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceHephaestusBoonKeepsake",
      "pathTrue": "HephaestusGift01",
    },
    {
      "label": "Everlasting Ember",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.ForceHestiaBoonKeepsake",
      "pathTrue": "HestiaGift01",
    },
    {
      "label": "Blackened Fleece",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.DamagedDamageBoostKeepsake",
      "pathTrue": "MedeaGift01",
    },
    {
      "label": "Lion Fang",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.DecayingBoostKeepsake",
      "pathTrue": "HeraclesGift01",
    },
    {
      "label": "Discordant Bell",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.EscalatingKeepsake",
      "pathTrue": "ErisGift01",
    },
    {
      "label": "Metallic Droplet",
      "location": "save_data.luabin.0.GameState.KeepsakeChambers.TimedBuffKeepsake",
      "pathTrue": "HermesGift01",
    },
  ],
  "bossDrops":[
    {
      "label": "Cinder",
      "location": "save_data.luabin.0.GameState.Resources.MixerFBoss"
    },
    {
      "label": "Pearl",
      "location": "save_data.luabin.0.GameState.Resources.MixerGBoss"
    },
    {
      "label": "Tears",
      "location": "save_data.luabin.0.GameState.Resources.MixerHBoss"
    },
    {
      "label": "Zodiac Sand",
      "location": "save_data.luabin.0.GameState.Resources.MixerIBoss"
    },
    {
      "label": "Wool",
      "location": "save_data.luabin.0.GameState.Resources.MixerNBoss"
    },
    {
      "label": "Golden Apple",
      "location": "save_data.luabin.0.GameState.Resources.MixerOBoss"
    }
  ],
  "plants": [
    {
      "label": "Garlic",
      "location": "save_data.luabin.0.GameState.Resources.PlantNGarlic"
    },
    {
      "label": "Mandrake",
      "location": "save_data.luabin.0.GameState.Resources.PlantOMandrake"
    },
    {
      "label": "Thalamus",
      "location": "save_data.luabin.0.GameState.Resources.PlantChaosThalamus"
    },
    {
      "label": "Moly",
      "location": "save_data.luabin.0.GameState.Resources.PlantFMoly"
    },
    {
      "label": "Nightshade",
      "location": "save_data.luabin.0.GameState.Resources.PlantFNightshade"
    },
    {
      "label": "Cattail",
      "location": "save_data.luabin.0.GameState.Resources.PlantGCattail"
    },
    {
      "label": "Lotus",
      "location": "save_data.luabin.0.GameState.Resources.PlantGLotus"
    },
    {
      "label": "Myrtle",
      "location": "save_data.luabin.0.GameState.Resources.PlantHMyrtle"
    },
    {
      "label": "Wheat",
      "location": "save_data.luabin.0.GameState.Resources.PlantHWheat"
    },
    {
      "label": "Poppy",
      "location": "save_data.luabin.0.GameState.Resources.PlantIPoppy"
    },
    {
      "label": "Shaderot",
      "location": "save_data.luabin.0.GameState.Resources.PlantIShaderot"
    },
    {
      "label": "Deathcap",
      "location": "save_data.luabin.0.GameState.Resources.PlantMoney"
    },
    {
      "label": "Moss",
      "location": "save_data.luabin.0.GameState.Resources.PlantNMoss"
    },
    {
      "label": "Driftwood",
      "location": "save_data.luabin.0.GameState.Resources.PlantODriftwood"
    }
  ],
  "gifts": [
    {
      "label": "Nectar",
      "location": "save_data.luabin.0.GameState.Resources.GiftPoints"
    },
    {
      "label": "Bath Salt",
      "location": "save_data.luabin.0.GameState.Resources.GiftPointsRare"
    },
    {
      "label": "Twin Lures",
      "location": "save_data.luabin.0.GameState.Resources.GiftPointsEpic"
    },
    {
      "label": "Ambrosia",
      "location": "save_data.luabin.0.GameState.Resources.SuperGiftPoints"
    },
    {
      "label": "Witch's Delights",
      "location": "save_data.luabin.0.GameState.Resources.FamiliarPoints"
    }
  ],
  "resources": [
    {
      "label": "Moon Dust",
      "location": "save_data.luabin.0.GameState.Resources.CardUpgradePoints"
    },
    {
      "label": "Obol Points",
      "location": "save_data.luabin.0.GameState.Resources.CharonPoints"
    },
    {
      "label": "Nightmare",
      "location": "save_data.luabin.0.GameState.Resources.WeaponPointsRare"
    },
    {
      "label": "Dark",
      "location": "save_data.luabin.0.GameState.Resources.Mixer6Common"
    },
    {
      "label": "Entropy",
      "location": "save_data.luabin.0.GameState.Resources.MixerMythic"
    },
    {
      "label": "Psyche",
      "location": "save_data.luabin.0.GameState.Resources.MemPointsCommon"
    },
    {
      "label": "Star Dust",
      "location": "save_data.luabin.0.GameState.Resources.Mixer5Common"
    },
    {
      "label": "Ashes",
      "location": "save_data.luabin.0.GameState.Resources.MetaCardPointsCommon"
    },
    {
      "label": "Bones",
      "location": "save_data.luabin.0.GameState.Resources.MetaCurrency"
    },
    {
      "label": "Fate Fabric",
      "location": "save_data.luabin.0.GameState.Resources.MetaFabric"
    },
    {
      "label": "Shadow",
      "location": "save_data.luabin.0.GameState.Resources.MixerShadow"
    },
    {
      "label": "Plasma",
      "location": "save_data.luabin.0.GameState.Resources.OreChaosProtoplasm"
    },
    {
      "label": "Silver",
      "location": "save_data.luabin.0.GameState.Resources.OreFSilver"
    },
    {
      "label": "Limestone",
      "location": "save_data.luabin.0.GameState.Resources.OreGLime"
    },
    {
      "label": "Glassrock",
      "location": "save_data.luabin.0.GameState.Resources.OreHGlassrock"
    },
    {
      "label": "Marble",
      "location": "save_data.luabin.0.GameState.Resources.OreIMarble"
    },
    {
      "label": "Bronze",
      "location": "save_data.luabin.0.GameState.Resources.OreNBronze"
    },
    {
      "label": "Iron",
      "location": "save_data.luabin.0.GameState.Resources.OreOIron"
    },
    {
      "label": "Rubbish",
      "location": "save_data.luabin.0.GameState.Resources.TrashPoints"
    },
  ],
  "fishery": [
    {
      "label": "Moper",
      "location": "save_data.luabin.0.GameState.Resources.FishFCommon"
    },
    {
      "label": "Figment",
      "location": "save_data.luabin.0.GameState.Resources.FishFRare"
    },
    {
      "label": "Soulbelly",
      "location": "save_data.luabin.0.GameState.Resources.FishFLegendary"
    },
    {
      "label": "Chiton",
      "location": "save_data.luabin.0.GameState.Resources.FishGCommon"
    },
    {
      "label": "Gutternose",
      "location": "save_data.luabin.0.GameState.Resources.FishGRare"
    },
    {
      "label": "Stalkfin",
      "location": "save_data.luabin.0.GameState.Resources.FishGLegendary"
    },
    {
      "label": "Soby",
      "location": "save_data.luabin.0.GameState.Resources.FishHCommon"
    },
    {
      "label": "Anguish",
      "location": "save_data.luabin.0.GameState.Resources.FishHRare"
    },
    {
      "label": "Tearjerker",
      "location": "save_data.luabin.0.GameState.Resources.FishHLegendary"
    },
    {
      "label": "Jiffy",
      "location": "save_data.luabin.0.GameState.Resources.FishICommon"
    },
    {
      "label": "Goldfish",
      "location": "save_data.luabin.0.GameState.Resources.FishIRare"
    },
    {
      "label": "Styxeon",
      "location": "save_data.luabin.0.GameState.Resources.FishILegendary"
    },
    {
      "label": "Roach",
      "location": "save_data.luabin.0.GameState.Resources.FishNCommon"
    },
    {
      "label": "Spike",
      "location": "save_data.luabin.0.GameState.Resources.FishNRare"
    },
    {
      "label": "Zeel",
      "location": "save_data.luabin.0.GameState.Resources.FishNLegendary"
    },
    {
      "label": "Squid",
      "location": "save_data.luabin.0.GameState.Resources.FishOCommon"
    },
    {
      "label": "Chrab",
      "location": "save_data.luabin.0.GameState.Resources.FishORare"
    },
    {
      "label": "Tuna",
      "location": "save_data.luabin.0.GameState.Resources.FishOLegendary"
    },
    {
      "label": "Starfish",
      "location": "save_data.luabin.0.GameState.Resources.FishPCommon"
    },
    {
      "label": "Discus",
      "location": "save_data.luabin.0.GameState.Resources.FishPRare"
    },
    {
      "label": "Godray",
      "location": "save_data.luabin.0.GameState.Resources.FishPLegendary"
    },
    {
      "label": "Slavug",
      "location": "save_data.luabin.0.GameState.Resources.FishBCommon"
    },
    {
      "label": "Chrustacean",
      "location": "save_data.luabin.0.GameState.Resources.FishBRare"
    },
    {
      "label": "Flameater",
      "location": "save_data.luabin.0.GameState.Resources.FishBLegendary"
    },
    {
      "label": "Mati",
      "location": "save_data.luabin.0.GameState.Resources.FishChaosCommon"
    },
    {
      "label": "Projelly",
      "location": "save_data.luabin.0.GameState.Resources.FishChaosRare"
    },
    {
      "label": "Voidskate",
      "location": "save_data.luabin.0.GameState.Resources.FishChaosLegendary"
    }
  ],
}

function applyFields() {
  let fieldsToUse = isHadesTwo.checked ? fields_2 : fields;
  for (const tab in fieldsToUse) {
    let tabButton = document.querySelector(`[data-tab="${tab}"]`);
    tabButton.classList.remove("hidden");
    let tabDiv = document.getElementById(tab);
    for(let item in fieldsToUse[tab]) {
      item = fieldsToUse[tab][item];

      // Grab Item Value in Save Data
      let value = resolve(item.location, saveData);

      if(value === undefined) { // Create Data
        change(saveData, item.location, 0);
        value = 0;
      }

      // If Value is of type Object, initiate list generation
      if(item.inputType === "dict") {
        let dictElement = applyDictionary(value, item, saveData);
        tabDiv.appendChild(dictElement);
        continue;
      }

      if (typeof value === "object") {
        let listElement = applyList(value, item.label, item.location, saveData);
        tabDiv.appendChild(listElement);
        continue;
      }

      // Set InputID that is used for Label and Input
      let inputID = item.label.toLowerCase().replaceAll(" ", "");

      // Create Input
      let input = document.createElement("input");
      input.setAttribute("id", inputID);

      if(item.inputType === "checkbox") {
        input.type = "checkbox";

        input.checked = value;

        input.onchange = function (event) {
          change(saveData, item.location, event.target.checked);
        }

      } else {
        // Set Input Value
        input.value = value;

        // Set Input onChange action
        input.onchange = function (event) {
          change(saveData, item.location, event.target.value);
          if(item.location.includes("Keepsake")) {
            change(saveData, "save_data.luabin.0.GameState.GiftPresentation." + item.location.split(".")[5], true);
            change(saveData, "save_data.luabin.0.GameState.TextLinesRecord." + item.pathTrue, true);
          }
        }
      }

      // Create Label
      let label = document.createElement("label");
      label.setAttribute("for", inputID);
      label.innerText = item.label;

      // Set Input inside of Label
      label.appendChild(input);

      // Set Label inside of Tab
      tabDiv.appendChild(label);
    }
  }
}

function applyDictionary(dict, item, data) {
  let title = item.label;
  let location = item.location;

  let dictElement = document.createElement("div");
  dictElement.classList.add("save-edit__list");

  // Create Title
  let dictTitle = document.createElement("span");
  dictTitle.innerText = title;
  dictElement.appendChild(dictTitle);

  for (const key in dict) {
    if (item.excludedFields && item.excludedFields.includes(key)) { continue; }
    let label = document.createElement("label");
    label.innerText = key;
    dictElement.appendChild(label);

    let dictItem = document.createElement("input");

    if(typeof dict[key] === "boolean") {
      dictItem.type = "checkbox";
      dictItem.checked = dict[key];
      dictItem.onchange = function (event) {
        change(data, location + "." + key, event.target.checked);
      }
    } else {
      dictItem.value = dict[key];
      dictItem.onchange = function (event) {
        change(data, location + "." + key, event.target.value);
      }
    }

    dictElement.appendChild(dictItem);
  }

  return dictElement;

}


function applyList(list, title, location, data) {
  let listElement = document.createElement("div");
  listElement.classList.add("save-edit__list");

  // Create Title
  let listTitle = document.createElement("span");
  listTitle.innerText = title;
  listElement.appendChild(listTitle);

  // Create Add Button
  let listAddButton = document.createElement("button");
  listAddButton.attributes["data-iteration"] = 1;
  listAddButton.innerText = "Add Field";

  // Add Button Functionality
  listAddButton.onclick = function () {

    // Create new Input Element
    let listItem = document.createElement("input");
    listItem.value = "0";
    listItem.onchange = function (event) {
      change(data, location + "." + (Number(listAddButton.attributes["data-iteration"]) - 1), event.target.value);
    }
    // Add new Field to Save Data
    let value = resolve(location, data);
    value[listAddButton.attributes["data-iteration"]] = 0;
    change(data, location, value);

    // Add item
    listElement.appendChild(listItem);
    listAddButton.attributes["data-iteration"]++;
  }

  listElement.appendChild(listAddButton);

  for (const key in list) {
    let listItem = document.createElement("input");
    listItem.value = list[key];
    listElement.appendChild(listItem);
    listAddButton.attributes["data-iteration"]++;
  }

  return listElement;
}
