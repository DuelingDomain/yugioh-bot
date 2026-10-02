import { describe, expect, it } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import type { DuelAnswer } from "@yugidraft/shared/duels";

describe("hand arrival order through the real engine view", () => {
  it.each(["normal", "domain"] as const)("%s: keeps a searched Warrior on the right after the core shuffles, with usable engine coordinates", async (mode) => {
    const rota = 32807846;
    const warrior = 91152256; // Celtic Guardian
    const options: Parameters<typeof createEngineGame>[0] = {
      mode, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
      decks: [0, 1].map(() => ({ main: [rota, ...Array(mode === "domain" ? 59 : 39).fill(warrior)], extra: [], side: [], deckMaster: 89631139 })),
      settings: { visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240,
        startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss", validateDeck: false, shuffleDeck: false },
    };
    const game = await createEngineGame(options);
    const commands: Array<{ seat: number; id: string; answer: DuelAnswer }> = [];
    const answer = (seat: number, id: string, answer: DuelAnswer) => {
      commands.push({ seat, id, answer }); game.answer(seat, id, answer);
    };
    try {
      const before = game.view(0).seats[0]!.hand;
      const action = game.view(0).prompt!;
      const activate = action.options.find((o) => o.id.startsWith("activate:") && o.card?.code === rota)!;
      expect(activate).toBeDefined();
      answer(0, action.id, { choice: activate.id });
      for (let i = 0; i < 20; i++) {
        const view = game.view(0);
        if (view.events.some((e) => e.addedToHand) && view.chain.length === 0) break;
        const seat = view.prompt ? 0 : 1;
        const prompt = game.view(seat).prompt!;
        answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
      }
      const view = game.view(0);
      const hand = view.seats[0]!.hand;
      const add = view.events.find((e) => e.addedToHand)!;
      expect(add).toBeDefined();
      expect(hand.map((c) => c.handId).slice(0, -1)).toEqual(before.filter((c) => c.code !== rota).map((c) => c.handId));
      expect(hand.at(-1)?.handId).toBeTruthy();
      expect(hand.at(-1)?.handId).toBe(add.handId);
      const summon = view.prompt!.options.find((o) => o.id.startsWith("summon:") && o.sequence === hand.at(-1)!.sequence)!;
      expect(summon).toBeDefined();
      answer(0, view.prompt!.id, { choice: summon.id });
      for (let i = 0; i < 10 && !game.view(0).seats[0]!.monsters.some((c) => c?.code === warrior); i++) {
        const seat = game.view(0).prompt ? 0 : 1;
        const prompt = game.view(seat).prompt!;
        answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
      }
      expect(game.view(0).seats[0]!.monsters.some((c) => c?.code === warrior)).toBe(true);
      expect(game.view(0).seats[0]!.hand.map((c) => c.handId)).toEqual(hand.slice(0, -1).map((c) => c.handId));
      // Replay/worker reconstruction uses the seed and accepted engine answers, not a client's history.
      const replay = await createEngineGame(options);
      try {
        expect(replay.view(0).seats[0]!.hand).toEqual(before);
        for (const command of commands) replay.answer(command.seat, command.id, command.answer);
        for (const viewer of [0, 1, null]) expect(replay.view(viewer).seats).toEqual(game.view(viewer).seats);
      } finally { replay.close(); }
    } finally { game.close(); }
  });
});
