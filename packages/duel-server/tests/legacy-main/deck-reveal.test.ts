// MAIN'S TEST, run against the legacy 1v1 engine (src/legacy). A copy of packages/duel-server/tests/deck-reveal.test.ts from origin/main (09b4196a)
// with only the import paths changed. Do not edit it to make the legacy engine pass: the legacy engine must match the approved legacy pin. See legacy-1v1/README.md.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelAnswer, type DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";

// Observe decoded messages from the real stock WASM; no fake effects or production edits.
const observed = vi.hoisted(() => ({ messages: [] as OcgMessage[] }));
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return {
    ...actual,
    default: async (...args: Parameters<typeof actual.default>) => {
      const core = await actual.default(...args);
      const getMessage = core.duelGetMessage.bind(core);
      core.duelGetMessage = (...messageArgs) => {
        const messages = getMessage(...messageArgs);
        observed.messages.push(...messages);
        return messages;
      };
      return core;
    },
  };
});

const ROTA = 32807846;
const KOJIKOCY = 1184620;
const OGAMA = 645794;
const TEMPEST = 2572890;
const TRAP_TRICK = 80101899;
const TORRENTIAL = 53582587;
const FILLER = 32274490; // Skull Servant: no effects, not a Warrior/search target.
const MIMIGHOUL_FAIRY = 43066927;

beforeEach(() => { observed.messages.length = 0; });

async function openGame(first: number, targets: number[]): Promise<EngineGame> {
  return createEngineGame({
    mode: "normal",
    seed: ["1", "2", "3", "4"],
    dataDirectory: engineDataDirectory,
    settings: { ...defaultDuelSettings("normal"), startingHand: 5, shuffleDeck: false, validateDeck: false, banlist: "none" },
    decks: [
      { main: [first, ...Array<number>(39 - targets.length).fill(FILLER), ...targets], extra: [], side: [] },
      { main: Array<number>(40).fill(FILLER), extra: [], side: [] },
    ],
  });
}

function drive(game: EngineGame, choose: (seat: number, prompt: DuelPrompt) => DuelAnswer | "stop" | null): void {
  for (let step = 0; step < 100; step++) {
    const seat = game.view(0).prompt ? 0 : 1;
    const prompt = game.view(seat).prompt;
    if (!prompt) throw new Error("No waiting prompt");
    const answer = choose(seat, prompt);
    if (answer === "stop") return;
    const ids = prompt.options.map((option) => option.id);
    game.answer(seat, prompt.id, answer ?? (ids.includes("no") ? { choice: "no" }
      : ids.includes("to_ep") ? { choice: "to_ep" } : choosePracticeBotAnswer(prompt)));
  }
  throw new Error("Effect never resolved");
}

function option(prompt: DuelPrompt, prefix: string, code: number): string | undefined {
  return prompt.options.find((entry) => entry.id.startsWith(prefix) && entry.card?.code === code)?.id;
}

function evidence(game: EngineGame, target: number, location: number): void {
  console.log(JSON.stringify({
    target,
    messages: observed.messages.filter((message) =>
      message.type === OcgMessageType.CONFIRM_CARDS || message.type === OcgMessageType.SHUFFLE_HAND ||
      (message.type === OcgMessageType.MOVE && message.card === target) ||
      (message.type === OcgMessageType.SET && message.code === target)),
    views: [0, 1, null].map((seat) => {
      const view = game.view(seat);
      return { seat,
        cards: (location === OcgLocation.HAND ? view.seats[0]!.hand : view.seats[0]!.spells)
          .filter(Boolean).map((card) => ({ code: card?.code ?? null, position: card?.position, sequence: card?.sequence })),
        events: view.events.filter((event) => event.zone?.controller === 0 && event.zone.location === location &&
          (location !== OcgLocation.HAND || event.addedToHand)).map((event) => ({
            kind: event.kind, text: event.text, code: event.card?.code ?? null,
            reason: event.reason, addedToHand: event.addedToHand, faceDown: event.faceDown,
          })),
        confirmations: view.log.filter((entry) => /Confirmed/.test(entry.text)),
      };
    }),
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
}

describe("Deck reveal diagnosis (stock core, real card scripts)", () => {
  it("keeps Mimighoul Fairy's confirmation to its owner private after summoning to the opponent's field", async () => {
    const game = await openGame(MIMIGHOUL_FAIRY, []);
    try {
      drive(game, (seat, prompt) => {
        if (observed.messages.some((message) => message.type === OcgMessageType.CONFIRM_CARDS) && game.view(0).chain.length === 0) return "stop";
        const activate = seat === 0 ? option(prompt, "activate:", MIMIGHOUL_FAIRY) : undefined;
        return activate ? { choice: activate } : null;
      });
      expect(observed.messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.CONFIRM_CARDS, player: 0,
        cards: [{ code: MIMIGHOUL_FAIRY, controller: 1, location: OcgLocation.MZONE, sequence: expect.any(Number) }],
      }));
      const owner = game.view(0);
      const move = owner.events.find((event) => event.kind === "move" && event.zone?.location === OcgLocation.MZONE);
      expect(move).toMatchObject({ from: { controller: 0, location: OcgLocation.HAND }, zone: { controller: 1, location: OcgLocation.MZONE } });
      expect(owner.events.find((event) => event.kind === "confirm")).toMatchObject({ moveId: move!.id, card: { code: MIMIGHOUL_FAIRY } });
      expect(game.view(0).log.some((entry) => entry.text === "Confirmed Mimighoul Fairy")).toBe(true);
      for (const viewer of [1, null]) {
        const view = game.view(viewer);
        expect(view.events.find((event) => event.kind === "confirm")).toMatchObject({ text: "A card was confirmed" });
        expect(view.events.find((event) => event.kind === "confirm")?.card).toBeUndefined();
        expect(view.log.some((entry) => entry.text === "Confirmed Mimighoul Fairy")).toBe(false);
      }
    } finally { game.close(); }
  });

  it("BUG 1: retains the searched Warrior's identity in the opponent's event stream", async () => {
    const game = await openGame(ROTA, [KOJIKOCY]);
    try {
      drive(game, (seat, prompt) => {
        if (game.view(0).seats[0]!.hand.some((card) => card.code === KOJIKOCY) && game.view(0).chain.length === 0) return "stop";
        const activate = seat === 0 ? option(prompt, "activate:", ROTA) : undefined;
        return activate ? { choice: activate } : null;
      });
      evidence(game, KOJIKOCY, OcgLocation.HAND);
      expect(observed.messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.CONFIRM_CARDS, player: 1,
        cards: expect.arrayContaining([expect.objectContaining({ code: KOJIKOCY, location: OcgLocation.HAND })]),
      }));
      expect(game.view(1).log.some((entry) => entry.text === "Confirmed Kojikocy")).toBe(true);
      // The confirmation is lost to the structured history/animation stream today.
      const reveal = game.view(1).events.find((event) => event.zone?.location === OcgLocation.HAND && event.card?.code === KOJIKOCY);
      expect(reveal?.card?.code, "Confirmed search must expose the card in the opponent's history/animation event").toBe(KOJIKOCY);
      for (const viewer of [0, 1, null]) {
        expect(game.view(viewer).events.find((event) => event.kind === "confirm")?.card?.code).toBe(KOJIKOCY);
        expect(game.view(viewer).log.some((entry) => entry.text === "Confirmed Kojikocy")).toBe(true);
      }
      for (const viewer of [1, null]) {
        expect(game.view(viewer).seats[0]!.hand.every((card) => card.code == null)).toBe(true);
        const move = game.view(viewer).events.find((event) => event.addedToHand);
        expect(move?.reason).toBe("add");
        expect(move?.card).toBeUndefined();
      }
    } finally { game.close(); }
  });

  it("BUG 2: publishes Ogama's core-generated Set confirmation to the opponent and spectator", async () => {
    const game = await openGame(OGAMA, [TEMPEST]);
    try {
      drive(game, (seat, prompt) => {
        if (game.view(0).seats[0]!.spells.some((card) => card?.code === TEMPEST) && game.view(0).chain.length === 0) return "stop";
        if (seat === 0) {
          const summon = option(prompt, "summon:", OGAMA);
          if (summon) return { choice: summon };
          if (prompt.options.some((entry) => entry.id === "yes")) return { choice: "yes" };
          const activate = option(prompt, "chain:", OGAMA);
          if (activate) return { choice: activate };
        }
        return null;
      });
      evidence(game, TEMPEST, OcgLocation.SZONE);
      const set = game.view(0).events.find((event) => event.kind === "set");
      expect(set).toMatchObject({ card: { code: TEMPEST }, text: "Player 1 Sets Majespecter Tempest" });
      expect(game.view(0).seats[0]!.spells.find((card) => card?.code === TEMPEST)!.position & OcgPosition.FACEDOWN).not.toBe(0);
      expect(observed.messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.CONFIRM_CARDS, player: 0,
        cards: expect.arrayContaining([expect.objectContaining({ code: TEMPEST, location: OcgLocation.SZONE })]),
      }));
      for (const viewer of [1, null]) {
        expect(game.view(viewer).events.find((event) => event.kind === "set")).toMatchObject({ text: "Player 1 Sets a card" });
        expect(game.view(viewer).events.find((event) => event.kind === "set")?.card).toBeUndefined();
        expect(game.view(viewer).seats[0]!.spells.filter(Boolean).every((card) => card?.code == null)).toBe(true);
        // The same-batch move from the controller's own Deck makes this confirmation public.
        expect(game.view(viewer).log.some((entry) => entry.text.includes("Confirmed Majespecter Tempest"))).toBe(true);
        expect(game.view(viewer).events.find((event) => event.kind === "confirm")?.card?.code).toBe(TEMPEST);
      }
      // The move link makes this confirmation public even when player is 0.
      const reveal = game.view(1).events.find((event) => event.zone?.location === OcgLocation.SZONE && event.card?.code === TEMPEST);
      expect(reveal?.card?.code, "Deck Set confirmation must expose the card in the opponent's history/animation event").toBe(TEMPEST);
    } finally { game.close(); }
  });

  it("BUG 2 baseline: Trap Trick publicly banishes its match but keeps the Set event controller-only", async () => {
    const game = await openGame(TRAP_TRICK, [TORRENTIAL, TORRENTIAL]);
    try {
      drive(game, (seat, prompt) => {
        if (game.view(0).seats[0]!.spells.some((card) => card?.code === TORRENTIAL) && game.view(0).chain.length === 0) return "stop";
        if (seat === 0) {
          const set = option(prompt, "sset:", TRAP_TRICK);
          if (set) return { choice: set };
          const activate = option(prompt, "activate:", TRAP_TRICK) ?? option(prompt, "chain:", TRAP_TRICK);
          if (activate) return { choice: activate };
        }
        return null;
      });
      evidence(game, TORRENTIAL, OcgLocation.SZONE);
      expect(observed.messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.CONFIRM_CARDS, player: 0,
        cards: expect.arrayContaining([expect.objectContaining({ code: TORRENTIAL, location: OcgLocation.SZONE })]),
      }));
      for (const viewer of [0, 1, null]) {
        expect(game.view(viewer).seats[0]!.banished[0]?.code).toBe(TORRENTIAL);
        const deckSet = game.view(viewer).events.find((event) => event.kind === "move" && event.from?.location === OcgLocation.DECK && event.zone?.location === OcgLocation.SZONE);
        expect(deckSet?.card?.code).toBe(viewer === 0 ? TORRENTIAL : undefined);
        expect(game.view(viewer).events.find((event) => event.kind === "confirm")?.card?.code).toBe(TORRENTIAL);
        if (viewer !== 0) expect(game.view(viewer).seats[0]!.spells.filter(Boolean).every((card) => card?.code == null)).toBe(true);
      }
    } finally { game.close(); }
  });

  it("keeps an ordinary Set from hand and draws hidden from opponents and spectators", async () => {
    const game = await openGame(TRAP_TRICK, []);
    try {
      drive(game, (seat, prompt) => {
        if (game.view(0).seats[0]!.spells.some((card) => card?.code === TRAP_TRICK)) return "stop";
        const set = seat === 0 ? option(prompt, "sset:", TRAP_TRICK) : undefined;
        return set ? { choice: set } : null;
      });
      expect(observed.messages.some((message) => message.type === OcgMessageType.CONFIRM_CARDS)).toBe(false);
      for (const viewer of [1, null]) {
        const view = game.view(viewer);
        expect(view.events.some((event) => event.kind === "confirm")).toBe(false);
        expect(view.events.find((event) => event.kind === "set")?.card).toBeUndefined();
        expect(view.events.filter((event) => event.reason === "draw" && event.seat === 0).every((event) => !event.card)).toBe(true);
        expect(view.seats[0]!.spells.filter(Boolean).every((card) => card?.code == null)).toBe(true);
      }
    } finally { game.close(); }
  });
});
