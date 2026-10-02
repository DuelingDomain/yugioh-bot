import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { expectPrompt, pickOpponent, type DuelistId } from "../../support/dsl.js";
import { BANQUET_RETURN_OWNER_SCENARIOS } from "./banquet-return-owner.js";
// Keep the count fixture stable across cores with different first-turn draw flags.
// This is the same one-phase fixture pattern used by compileBoard for turn:p1.
const SKIP_OPENING_DRAW = `
do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;
describeWithCores("live Banquet temporary return", liveNseat, () => {
  runScenarios("multiplayer/banquet-return-owner", BANQUET_RETURN_OWNER_SCENARIOS, async (scenario) => {
    const compiled = compileBoard(scenario.setup);
    compiled.options.startupScripts![0].content += SKIP_OPENING_DRAW;
    const count = scenario.setup.format === "1v1" ? 2 : scenario.setup.format === "ffa3" ? 3 : 4;
    const game = await createEngineGame({ ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory, multiWasmBinary: nseatWasmBinary() });
    try {
      const session = new Session(scenario, game);
      session.reachMainPhase(); session.startRecording();
      let at = 1;
      for (const step of scenario.steps) {
        session.run(expectPrompt({}), at++);
        const prompt = Array.from({ length: count }, (_, seat) => game.view(seat).prompt).find(Boolean);
        if (prompt?.context?.type === "opponent") {
          session.run(pickOpponent(`p${count - 1}` as DuelistId, `p${prompt.seat}` as DuelistId), at++);
          session.run(expectPrompt({}), at++);
        }
        if (step.op === "select" && Array.from({ length: count }, (_, seat) => game.view(seat).prompt).find(Boolean)?.context?.type === "action") continue;
        session.run(step, at++);
      }
    } finally { game.close(); }
  });
});
