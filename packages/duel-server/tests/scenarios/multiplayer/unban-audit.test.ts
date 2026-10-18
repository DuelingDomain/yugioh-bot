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
  if (!scenario.tags.includes("foreign-owned-hand")) return runScenario(scenario);
  const compiled=compileBoard(scenario.setup);
  const game=await createEngineGame({...compiled.options,dataDirectory:engineDataDirectory,
    multiWasmBinary:scenario.setup.mode==="domain"?domainNseatWasmBinary():nseatWasmBinary(),
    startupScripts:[...compiled.options.startupScripts!,{name:"foreign-owned-hand.lua",content:"Debug.AddCard(5053103,2,0,LOCATION_HAND,0,POS_FACEDOWN)"}],seed:["1","2","3","4"]});
  try {
    const session=new Session(scenario,game);
    session.reachMainPhase();session.startRecording();
    scenario.steps.forEach((step,index)=>session.run(step,index+1));
  } finally { game.close(); }
}
describeWithCores("2026-10-18 unban audit", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/unban-audit", UNBAN_AUDIT_SCENARIOS,runAudit);
});
