// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/hand-order-engine.test.ts from origin/main (09b4196a)
// with only the import paths changed. Do not edit it to make the legacy engine pass: the legacy engine must equal main. See legacy-1v1/README.md.
import { describe, expect, it, vi } from "vitest";
import type { OcgCoreSync } from "ocgcore-wasm";
import { createEngineGame } from "../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import type { DuelAnswer, DuelEngineView } from "@yugidraft/shared/duels";

// Observe the real query used by projectView, without adding a test API to the engine host.
const rawHands = vi.hoisted(() => new Map<number, Array<number | undefined>>());
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options) as OcgCoreSync;
    const query = core.duelQueryLocation.bind(core);
    core.duelQueryLocation = (handle, request) => {
      const result = query(handle, request);
      if (request.location === actual.OcgLocation.HAND) rawHands.set(request.controller, result.map((card) => card?.code));
      return result;
    };
    return core;
  } };
});

function expectEngineOrder(view: DuelEngineView, viewer: number | null) {
  for (const seat of view.seats) {
    expect(seat.hand.map((c) => c.sequence)).toEqual(seat.hand.map((_, i) => i));
    if (seat.seat === viewer) expect(seat.hand.map((c) => c.code)).toEqual(rawHands.get(seat.seat));
    else expect(seat.hand.every((c) => c.code == null)).toBe(true);
  }
}

describe("engine hand order through the real engine view", () => {
  it.each(["normal", "domain"] as const)("%s: follows raw hand queries through ROTA, summon and accepted-answer replay", async (mode) => {
    const rota = 32807846;
    const warrior = 91152256; // Celtic Guardian
    const options: Parameters<typeof createEngineGame>[0] = {
      mode, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
      decks: [0, 1].map(() => ({ main: [rota, 89631139, warrior, 46986414, 83764718, ...Array(mode === "domain" ? 55 : 35).fill(warrior)], extra: [], side: [], deckMaster: 89631139 })),
      settings: { visibility: "public", banlist: "none", cardPool: "both", turnSeconds: 240,
        startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss", validateDeck: false, shuffleDeck: false },
    };
    const game = await createEngineGame(options);
    const commands: Array<{ seat: number; id: string; answer: DuelAnswer }> = [];
    const answer = (seat: number, id: string, answer: DuelAnswer) => {
      commands.push({ seat, id, answer }); game.answer(seat, id, answer);
      for (const viewer of [0, 1, null]) expectEngineOrder(game.view(viewer), viewer);
    };
    try {
      const before = game.view(0).seats[0]!.hand;
      for (const viewer of [0, 1, null]) expectEngineOrder(game.view(viewer), viewer);
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
      const arrival = hand.find((c) => c.handId === add.handId)!;
      expect(arrival).toBeDefined();
      expect(arrival.code).toBe(warrior);
      expect(hand[arrival.sequence]).toBe(arrival);
      for (const viewer of [1, null]) {
        const audience = game.view(viewer);
        const searched = audience.events.find((event) => event.id === add.id)!;
        expect(searched.handId).toMatch(/^sleeve-/);
        expect(audience.seats[0]!.hand.find((card) => card.handId === searched.handId)).toBeDefined();
      }
      const summon = view.prompt!.options.find((o) => o.id.startsWith("summon:") && o.sequence === arrival.sequence)!;
      expect(summon).toBeDefined();
      answer(0, view.prompt!.id, { choice: summon.id });
      for (let i = 0; i < 10 && !game.view(0).seats[0]!.monsters.some((c) => c?.code === warrior); i++) {
        const seat = game.view(0).prompt ? 0 : 1;
        const prompt = game.view(seat).prompt!;
        answer(seat, prompt.id, choosePracticeBotAnswer(prompt));
      }
      expect(game.view(0).seats[0]!.monsters.some((c) => c?.code === warrior)).toBe(true);
      expect(game.view(0).seats[0]!.hand.map((c) => c.handId)).toEqual(hand.filter((c) => c !== arrival).map((c) => c.handId));
      // Replay/worker reconstruction uses the seed and accepted engine answers, not a client's history.
      const replay = await createEngineGame(options);
      try {
        expect(replay.view(0).seats[0]!.hand).toEqual(before);
        for (const command of commands) {
          replay.answer(command.seat, command.id, command.answer);
          for (const viewer of [0, 1, null]) expectEngineOrder(replay.view(viewer), viewer);
        }
        for (const viewer of [0, 1, null]) {
          const recovered = replay.view(viewer);
          const original = game.view(viewer);
          expect(recovered.seats).toEqual(original.seats);
          expect(recovered.events).toEqual(original.events);
        }
      } finally { replay.close(); }
      // Game two gets a fresh core and an independently built hand after changing the deck for siding.
      const nextGame = await createEngineGame({ ...options, decks: options.decks.map((deck) => ({
        ...deck, main: [deck.main[4]!, ...deck.main.slice(0, 4), ...deck.main.slice(5)],
      })) });
      try {
        for (const viewer of [0, 1, null]) expectEngineOrder(nextGame.view(viewer), viewer);
        expect(nextGame.view(0).seats[0]!.hand.map((c) => c.code)).not.toEqual(before.map((c) => c.code));
        expect(nextGame.view(0).events.filter((e) => e.reason === "draw")).toHaveLength(10);
      } finally { nextGame.close(); }
    } finally { game.close(); }
  });
});
