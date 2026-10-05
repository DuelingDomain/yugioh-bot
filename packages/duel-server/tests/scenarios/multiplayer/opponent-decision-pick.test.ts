import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEngineGame } from "../../../src/engine.js";
import { repoMultiScriptsDirectory } from "../../../src/multi-scripts.js";
import { currentEngineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import type { Scenario } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { nseatWasmBinary, Session } from "../../support/session.js";
import { OPPONENT_DECISION_PICK_SCENARIOS, OPPONENT_DECISION_WRAPPER_SCENARIOS } from "./opponent-decision-pick.js";

async function runUnrelatedWrapper(scenario: Scenario) {
  const compiled = compileBoard(scenario.setup);
  const scratch = join(repoMultiScriptsDirectory(), "../.build");
  mkdirSync(scratch, { recursive: true });
  const overlay = mkdtempSync(join(scratch, "decision-wrapper-proof-"));
  cpSync(repoMultiScriptsDirectory(), overlay, { recursive: true });
  writeFileSync(join(overlay, "c74191942.lua"), `
aux.MPChooseOpponent=function(tp)
  Duel.Damage(1-tp,500,REASON_EFFECT)
  return true
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
  aux.MPChooseOpponent(tp)
end
`);
  const game = await createEngineGame({ ...compiled.options, dataDirectory: currentEngineDataDirectory(),
    multiScriptsDirectory: overlay, multiWasmBinary: nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); rmSync(overlay, { recursive: true, force: true }); }
}

describeWithCores("live resolution-time opponent decisions", liveNseat, () => {
  runScenarios("multiplayer/opponent-decision-pick", OPPONENT_DECISION_PICK_SCENARIOS);
  runScenarios("multiplayer/opponent-decision-wrapper", OPPONENT_DECISION_WRAPPER_SCENARIOS, runUnrelatedWrapper);
});
