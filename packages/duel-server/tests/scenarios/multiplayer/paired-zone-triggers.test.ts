import { runScenarios } from "../../support/runner.js";
import { expect } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { expectPrompt, expectNoEvent, pickOpponent, type DuelistId } from "../../support/dsl.js";
import { PAIRED_ZONE_TRIGGERS_SCENARIOS } from "./paired-zone-triggers.js";
// The opening-draw skip is intentional: keep the card fixture hand and Deck counts fixed.
// rule-proof-ffa-order.test.ts checks the first draw without this skip in the default test:engine gate.
const SKIP_OPENING_DRAW = `
do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;
describeWithCores("live paired zone trigger actions", liveNseat, () => {
  runScenarios("multiplayer/paired-zone-triggers", PAIRED_ZONE_TRIGGERS_SCENARIOS, async (proof) => {
    const scenario = structuredClone(proof);
    if(process.env.SEAT_PROOF_DOMAIN === "1") {
      scenario.setup.mode="domain";
      for(const seat of ["p0","p1","p2","p3"] as const) if(scenario.setup[seat]) {
        scenario.setup[seat]!.deckMaster="Blue-Eyes White Dragon";
        for(const step of scenario.steps) if(step.op==="expectBoard" && step.board[seat]) step.board[seat]!.deckMaster={inZone:true,returns:0,nextCost:0};
      }
    }
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
        if (prompt?.context?.type === "opponent" && step.op !== "pickOpponent" && !step.op.startsWith("expect")) {
          throw new Error(`${scenario.id}: unexpected opponent prompt before ${step.op}`);
        }
        if (step.op === "select") {
          const current = Array.from({ length: count }, (_, seat) => game.view(seat).prompt).find(Boolean);
          if (current?.context?.type === "action" || current?.source?.code === 14220547) continue;
        }
        session.run(step, at++);
      }
      if (scenario.tags.includes("branded-fusion")) expect(game.view(0).seats[0].monsters.find(card => card?.code === 54541900)?.attack).toBe(3000);
    } finally { game.close(); }
  });
});
