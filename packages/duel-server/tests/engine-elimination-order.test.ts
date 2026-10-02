import { describe, expect, it } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory } from "./engine-data-dir.js";

describe("engine elimination groups", () => {
  it.each([
    ["simultaneous", "Duel.SetLP(1,0) Duel.SetLP(2,0)", [[1, 2]]],
    ["separate turns", "if Duel.GetTurnCount()==1 then Duel.SetLP(1,0) else Duel.SetLP(2,0) end", [[1], [2]]],
  ] as const)("publishes %s losses for players and spectators", async (_name, operation, expected) => {
    const game = await createEngineGame({
      mode: "normal", format: "ffa3", dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
      decks: Array.from({ length: 3 }, () => ({ main: Array(40).fill(20057949), extra: [], side: [] })),
      startupScripts: [{ name: "losses.lua", content: `
        local e=Effect.GlobalEffect()
        e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
        e:SetOperation(function() ${operation} end)
        Duel.RegisterEffect(e,0)
      ` }],
    });
    try {
      for (let step = 0; step < 20 && !game.view(null).result; step++) {
        const promptSeat = game.view(null).turnSeat;
        const prompt = game.view(promptSeat).prompt;
        expect(prompt).not.toBeNull();
        game.answer(prompt!.seat, prompt!.id, chooseSurrenderedAnswer(prompt!));
      }
      expect(game.view(null).result?.winnerSeat).toBe(0);
      for (const viewer of [null, 0, 1, 2]) {
        expect(game.view(viewer).eliminationOrder).toEqual(expected);
      }
      // Consumers cannot change the order kept by the engine.
      game.view(0).eliminationOrder?.[0]?.push(99);
      expect(game.view(null).eliminationOrder).toEqual(expected);
    } finally {
      game.close();
    }
  });
});
