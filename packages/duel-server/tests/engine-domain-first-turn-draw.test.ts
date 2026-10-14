import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

// A Main Deck Deck Master is created directly in DMZ, separately from the five
// opening cards. Reaching Main Phase 1 proves the first Draw Phase has finished.
const deck = { main: Array(40).fill(15025844), extra: [], side: [], deckMaster: 48305365 };

describeWithCores("Domain turn-1 Draw Phase", [needs.domain(dataDirectory),
  needs.file("legacy Domain core", `${dataDirectory}/ocgcore.domain.legacy.wasm`),
  ...needs.domainMulti(dataDirectory, `${dataDirectory}/ocgcore.multi-domain.wasm`)], () => {
  it.each(["ffa3", "ffa4"] as const)("%s: the first player draws with the existing default", async (format) => {
    const game = await createEngineGame({ mode: "domain", format, dataDirectory,
      seed: ["1", "2", "3", "4"],
      settings: { ...defaultDuelSettings("domain", format), shuffleDeck: false },
      decks: Array.from({ length: seatCountFor(format) }, () => deck) });
    try {
      const view = game.view(0);
      expect(view).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1" });
      expect(view.seats.map((seat) => seat.hand.length)).toEqual(format === "ffa3" ? [6, 5, 5] : [6, 5, 5, 5]);
      expect(view.seats[0]!.deckCount).toBe(34);
      for (const seat of view.seats) expect(seat.deckMaster).toMatchObject({ card: { code: deck.deckMaster }, inZone: true });
      expect(view.events.filter((event) => event.kind === "move" && event.reason === "draw"
        && event.seat === 0 && event.zone?.sequence === 5)).toHaveLength(1);
    } finally { game.close(); }
  });

  it.each((["ffa3", "ffa4"] as const).flatMap((format) =>
    [false, true].map((firstTurnDraw) => ({ format, firstTurnDraw }))))(
    "$format: setting $firstTurnDraw controls only the first player's draw", async ({ format, firstTurnDraw }) => {
      const game = await createEngineGame({ mode: "domain", format, dataDirectory,
        seed: ["1", "2", "3", "4"],
        settings: { ...defaultDuelSettings("domain", format), firstTurnDraw, shuffleDeck: false,
          startingHand: 4, drawPerTurn: 2 },
        decks: Array.from({ length: seatCountFor(format) }, () => deck) });
      try {
        const view = game.view(0);
        expect(view).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1" });
        expect(view.seats[0]!.hand).toHaveLength(firstTurnDraw ? 6 : 4);
        expect(view.seats[0]!.deckCount).toBe(firstTurnDraw ? 34 : 36);
        expect(view.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        game.answer(0, view.prompt!.id, { choice: "to_ep" });
        const next = game.view(1);
        expect(next).toMatchObject({ turn: 2, turnSeat: 1, phase: "main1" });
        expect(next.seats[1]!.hand).toHaveLength(6);
        expect(next.seats[1]!.deckCount).toBe(34);
      } finally { game.close(); }
    });

  it.each([false, true])("a saved draw rule %s wins over conflicting Domain FFA settings", async (firstTurnDraw) => {
    const game = await createEngineGame({ mode: "domain", format: "ffa3", dataDirectory, firstTurnDraw,
      seed: ["1", "2", "3", "4"],
      settings: { ...defaultDuelSettings("domain", "ffa3"), firstTurnDraw: !firstTurnDraw, shuffleDeck: false },
      decks: [deck, deck, deck] });
    try {
      expect(game.view(0).seats[0]!.hand).toHaveLength(firstTurnDraw ? 6 : 5);
    } finally { game.close(); }
  });

  it.each(["pinned", "legacy"] as const)("%s: Domain 1v1 first player still skips the draw", async (engine) => {
    const createGame = engine === "legacy" ? createLegacyEngineGame : createEngineGame;
    const game = await createGame({ mode: "domain", format: "1v1" as DuelFormat, dataDirectory,
      seed: ["1", "2", "3", "4"],
      settings: { ...defaultDuelSettings("domain"), shuffleDeck: false }, decks: [deck, deck] });
    try {
      const view = game.view(0);
      expect(view).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1" });
      expect(view.seats.map((seat) => seat.hand.length)).toEqual([5, 5]);
      expect(view.seats[0]!.deckCount).toBe(35);
      expect(view.events.filter((event) => event.kind === "move" && event.reason === "draw"
        && event.seat === 0 && event.zone?.sequence === 5)).toHaveLength(0);
    } finally { game.close(); }
  });
});
