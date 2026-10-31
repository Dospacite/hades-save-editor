"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { LuaDataReader, inherit, list } = require("../scripts/lib/lua-data");

function read(source) {
  const reader = new LuaDataReader();
  reader.load(source, "test.lua");
  return reader;
}

test("reads nested tables, lists, strings and numbers", () => {
  const { globals, warnings } = read(`
    -- comment
    --[[ block
    comment ]]
    ResourceData =
    {
      BaseResource = { DebugOnly = true, IconScale = 0.34 },
      OreFSilver =
      {
        InheritFrom = { "BaseResource" },
        IconPath = "Items\\\\Resources\\\\Silver",
        Cost = { [1] = 5, ["Two"] = 2; },
        Text = [[long
string]],
      },
    }
  `);
  assert.deepEqual(warnings, []);
  assert.equal(globals.ResourceData.OreFSilver.IconPath, "Items\\Resources\\Silver");
  assert.deepEqual(list(globals.ResourceData.OreFSilver.InheritFrom), ["BaseResource"]);
  assert.equal(globals.ResourceData.OreFSilver.Cost.Two, 2);
  assert.equal(globals.ResourceData.OreFSilver.Text, "long\nstring");
});

test("runs locals, arithmetic, field assignments and table helpers", () => {
  const { globals } = read(`
    local Multiplier = 2
    TraitData = TraitData or {}
    TraitSetData = {}
    TraitSetData.Keepsakes = { GoldKeepsake = { Value = 3 * Multiplier, Negative = -1 } }
    OverwriteTableKeys( TraitData, TraitSetData.Keepsakes )
    function Ignored( a ) if a then return 1 end end
    if fullGame then
      TraitData.Extra = { Name = "x" .. "y" }
    end
  `);
  assert.equal(globals.TraitData.GoldKeepsake.Value, 6);
  assert.equal(globals.TraitData.GoldKeepsake.Negative, -1);
  assert.equal(globals.TraitData.Extra.Name, "xy");
  assert.equal(globals.Ignored, undefined);
});

test("follows Import calls through the onImport hook", () => {
  const files = {
    "Main.lua": 'Import "Other.lua"\nAfter = Before.Value',
    "Other.lua": "Before = { Value = 7 }",
  };
  const reader = new LuaDataReader();
  reader.onImport = (file) => reader.load(files[file], file);
  reader.onImport("Main.lua");
  assert.equal(reader.globals.After, 7);
});

test("inherit merges parents but never inherits DebugOnly", () => {
  const { globals } = read(`
    Data = {
      Base = { DebugOnly = true, Scale = 1, Icon = "base" },
      Child = { InheritFrom = { "Base" }, Icon = "child" },
    }
  `);
  const resolved = inherit(globals.Data);
  assert.equal(resolved.Child.Scale, 1);
  assert.equal(resolved.Child.Icon, "child");
  assert.equal(resolved.Child.DebugOnly, undefined);
  assert.equal(resolved.Base.DebugOnly, true);
});
