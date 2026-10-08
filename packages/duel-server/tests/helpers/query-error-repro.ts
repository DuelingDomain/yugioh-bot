import type { DuelFormat } from "@yugidraft/shared/duels";
import { compileBoard } from "../support/board.js";
import { engineDataDirectory as DATA } from "../engine-data-dir.js";

export function queryErrorOptions(format: DuelFormat = "1v1") {
  const seat = { deck: Array(20).fill("Mystical Elf") };
  const compiled = compileBoard({ format, p0: { ...seat, monsters: ["Mystical Elf"] }, p1: seat,
    ...(format === "ffa4" ? { p2: seat, p3: seat } : {}),
  }, DATA);
  return { ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: DATA,
    startupScripts: [...compiled.options.startupScripts!, { name: "query-fixture.lua", content: `assert(load([=[
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_SINGLE)
e:SetCode(EFFECT_UPDATE_ATTACK)
e:SetValue(function() query_fixture_missing.failure() end)
c:RegisterEffect(e)
]=], 'c15025844.lua'))()` }],
  };
}
