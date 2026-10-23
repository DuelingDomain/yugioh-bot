import { expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { compileBoard } from "../../support/board.js";
import { createEngineGame } from "../../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../../src/practice-bot.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { CHICKEN_GAME_SCENARIOS } from "./chicken-game.js";

describeWithCores("live Chicken Game damage protection", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/chicken-game", CHICKEN_GAME_SCENARIOS);
});

describeWithCores("legacy 1v1 Chicken Game", [needs.cards(), needs.scripts()], () => {
  it.each([[7000, 8000, 7500], [8000, 7000, 7000], [8000, 8000, 7500]])(
    "keeps stock protection at %i vs %i LP", async (own, other, expected) => {
      const compiled = compileBoard({ skipOpeningDraw: true,
        p0: { lp: own, field: "Chicken Game", hand: ["Hinotama"] }, p1: { lp: other } });
      const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"] });
      try {
        let activated = false, resolved = false;
        for (let n = 0; n < 100; n++) {
          const view = game.view(null);
          const prompt = [game.view(0).prompt, game.view(1).prompt].find(p => p != null);
          if (!prompt) throw new Error("Expected a waiting prompt");
          if (activated && view.phase === "main1" && prompt.options.some(o => o.id === "to_ep")) {
            resolved = true;
            break;
          }
          const activation = prompt.options.find(o => o.id.startsWith("activate:") && o.card?.code === 46130346);
          if (activation && !activated) {
            activated = true;
            game.answer(prompt.seat, prompt.id, { choice: activation.id });
          } else game.answer(prompt.seat, prompt.id, choosePracticeBotAnswer(prompt));
        }
        expect(activated).toBe(true);
        expect(resolved).toBe(true);
        expect(game.view(null).seats[1].lp).toBe(expected);
        expect(game.view(null).seats[0].lp).toBe(own);
      } finally { game.close(); }
    },
  );
});
