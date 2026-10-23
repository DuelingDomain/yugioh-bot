import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { createLegacyEngineGame } from "../../../src/legacy/index.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import type { Scenario } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { domainVariant } from "./domain-variants.js";
import { LP_DIFFERENCE_SCENARIOS } from "./lp-differences.js";

async function run(scenario: Scenario): Promise<void> {
  const legacy = scenario.setup.format === "1v1";
  const compiled = compileBoard(scenario.setup);
  // Legacy counter views swap type/count. Check the real counter and emit an LP marker.
  if (legacy && scenario.tags.includes("card:81758313")) compiled.options.startupScripts!.push({ name: "assert-myriad-counters.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_CHAIN_END)
e:SetOperation(function(e)
  local count=c:GetCounter(0x21d)
  if count==0 then return end
  assert(count==2,"Legacy Myriaday must gain exactly two counters")
  e:Reset()
  Duel.Recover(0,100,REASON_EFFECT)
end)
Duel.RegisterEffect(e,0)
` });
  if (scenario.tags.includes("lp-equal-at-resolution")) compiled.options.startupScripts!.push({ name: "equal-lp-before-counters.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local equalize=Effect.CreateEffect(c)
equalize:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
equalize:SetCode(EVENT_CHAIN_SOLVING)
equalize:SetRange(LOCATION_MZONE)
equalize:SetOperation(function(e,tp)
  local me=Duel.MPSeatOf(c)
  aux.MPForEachDuelist(function(p,seat)
    if seat~=me then Duel.SetLP(p,5000) end
  end)
  e:Reset()
end)
c:RegisterEffect(equalize)
` });
  if (scenario.tags.includes("lp-deck-grave-swap")) compiled.options.startupScripts!.push({ name: "swap-deck-grave.lua", content: `
local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local swap=Effect.CreateEffect(c)
swap:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
swap:SetRange(LOCATION_MZONE)
swap:SetCode(EVENT_CHAIN_SOLVING)
swap:SetCondition(function(e,tp,eg,ep,ev)
  return Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_CODE)==23701465
end)
swap:SetOperation(function(e,tp)
  Duel.SwapDeckAndGrave(tp)
  Duel.Recover(tp,100,REASON_EFFECT)
  e:Reset()
end)
c:RegisterEffect(swap)
` });
  const game = await (legacy ? createLegacyEngineGame : createEngineGame)({
    ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
    ...(!legacy ? { multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary() } : {}),
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, i) => {
      session.run(step, i + 1);
      if (scenario.tags.includes("lp-shuffle-hints") && i === 1) session.reachMainPhase();
      if (scenario.tags.includes("lp-shuffle-hints") && step.op === "expectBoard") {
        for (const viewer of [null, 0, 1, 2]) for (const card of game.view(viewer).seats[0].monsters) {
          if (card?.code && (card.position & 0x05) !== 0) expect(card.lpOpponent).toBe(card.code === 90162951 ? 1 : 2);
        }
      }
      if (scenario.tags.includes("lp-banished-hint") && step.op === "expectBoard") {
        for (const viewer of [null, 0, 1, 2]) expect(game.view(viewer).seats[0].banished.find(c => c.code === 81916745)?.lpOpponent).toBe(1);
      }
      // Hints are public for face-up cards; they must not identify a Set card.
      for (const viewer of [null, 0, 1, 2]) {
        if (legacy && viewer === 2) continue;
        for (const seat of game.view(viewer).seats) for (const card of [...seat.monsters, ...seat.spells]) {
          if (card && (card.position & 0x0a) !== 0) expect(card.lpOpponent).toBeUndefined();
        }
      }
      if (scenario.setup.format?.startsWith("ffa") && scenario.id.match(/^lp-difference-90162951-ffa[34](-domain)?$/) && step.op === "pickOpponent") {
        // Every viewer, including a spectator, can inspect the real chosen seat.
        for (const viewer of [null, 0, 1, 2]) expect(game.view(viewer).seats[0].monsters[0]).toMatchObject({ lpOpponent: 1 });
      }
    });
  } finally { game.close(); }
}

describeWithCores("LP differences: Standard multiplayer and legacy 1v1", liveNseat, () => {
  runScenarios("multiplayer/lp-differences", LP_DIFFERENCE_SCENARIOS, run);
});
describeWithCores("LP differences: Domain multiplayer", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/lp-differences-domain", LP_DIFFERENCE_SCENARIOS.filter(s => s.setup.format !== "1v1").map(domainVariant), run);
});
