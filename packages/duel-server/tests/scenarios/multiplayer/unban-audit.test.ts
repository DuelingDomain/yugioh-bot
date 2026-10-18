import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary, runScenario } from "../../support/session.js";
import type { Scenario } from "../../support/dsl.js";
import { UNBAN_AUDIT_SCENARIOS } from "./unban-audit.js";

async function runAudit(scenario: Scenario): Promise<void> {
  const zoneFixture=scenario.tags.find(tag=>tag.startsWith("switcher-zone-"));
  if (!scenario.tags.includes("foreign-owned-hand") && !zoneFixture) return runScenario(scenario);
  const fixture=zoneFixture ? `
    local source=${zoneFixture==="switcher-zone-late-impossible"?2:1}
    local c1=Duel.GetFieldCard(source,LOCATION_MZONE,0)
    local c2=Duel.GetFieldCard(source,LOCATION_MZONE,1)
    local function restrict(c,zones)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_FORCE_MZONE)
      e:SetValue(zones | (zones<<16))
      c:RegisterEffect(e)
    end
    restrict(c1,${zoneFixture==="switcher-zone-forced"?6:zoneFixture==="switcher-zone-pruned"?3:1})
    restrict(c2,1)
  ` : "Debug.AddCard(5053103,2,0,LOCATION_HAND,0,POS_FACEDOWN)";
  const compiled=compileBoard(scenario.setup);
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
    multiWasmBinary:scenario.setup.mode==="domain"?domainNseatWasmBinary():nseatWasmBinary(),
    startupScripts:[...compiled.options.startupScripts!,{name:zoneFixture?"switcher-card-zones.lua":"foreign-owned-hand.lua",content:fixture}],seed:["1","2","3","4"]});
  try {
    const session=new Session(scenario,game);
    session.reachMainPhase();session.startRecording();
    scenario.steps.forEach((step,index)=>session.run(step,index+1));
  } finally { game.close(); }
}
describeWithCores("2026-10-18 unban audit", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/unban-audit", UNBAN_AUDIT_SCENARIOS,runAudit);
});
