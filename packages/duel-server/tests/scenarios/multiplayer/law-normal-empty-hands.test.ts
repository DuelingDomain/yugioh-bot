import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import type { Scenario } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { domainVariant } from "./domain-variants.js";
import { LAW_NORMAL_EMPTY_HANDS_SCENARIOS } from "./law-normal-empty-hands.js";

// Keep the empty-hand activation fixtures empty. The default first-draw suite proves the FFA draw rule.
const SKIP_OPENING_DRAW = `
do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;

async function runLaw(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  compiled.options.startupScripts![0].content += SKIP_OPENING_DRAW;
  const game = await createEngineGame({
    ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...((scenario.setup.format ?? "1v1") === "1v1" ? {} : {
      multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    }),
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}

describeWithCores("live Law of the Normal Standard", liveNseat, () => {
  runScenarios("multiplayer/law-normal-empty-hands", LAW_NORMAL_EMPTY_HANDS_SCENARIOS, runLaw);
});
describeWithCores("live Law of the Normal Domain", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/law-normal-empty-hands-domain", LAW_NORMAL_EMPTY_HANDS_SCENARIOS.map(scenario => domainVariant({ ...scenario, tags: [...scenario.tags, "ffa-first-draw-included"] })), runLaw);
});
