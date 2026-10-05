import { describe, expect, it } from "vitest";
import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";

const cards = {
  get: (code: number) => code === 81480460 ? { code, name: "Barrel Dragon", type: 33 } : undefined,
  resolveLabel: () => "",
} as unknown as CardDatabase;
const coin = (player = 1): OcgMessage => ({ type: OcgMessageType.TOSS_COIN, player, results: [true, false, true] });
const chain: merged.StoredChainLink[] = [
  { index: 1, seat: 1, code: 81480460, zone: { controller: 1, location: 4, sequence: 0 }, targets: [] },
  { index: 2, seat: 0, code: 12580477, zone: { controller: 0, location: 8, sequence: 0 }, targets: [] },
];

describe.each([["merged", merged], ["legacy", legacy]] as const)("%s coin toss views", (_name, views) => {
  it("emits one public event with ordered results and the resolving source, rather than the last link", () => {
    const ctx = views.createEventContext() as never;
    views.observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 }, cards, chain, 6, ctx);
    const stored = views.observeDuelEvent(coin(), cards, chain, 7, ctx)!;
    expect(stored).toMatchObject({
      id: 7, kind: "toss", seat: 1, chainIndex: 1, sourceCode: 81480460,
      card: { code: 81480460, name: "Barrel Dragon" },
      text: "Coin toss: Heads, Tails, Heads", publicText: "Coin toss: Heads, Tails, Heads",
      revealCardTo: "all", toss: { type: "coin", results: ["heads", "tails", "heads"] },
    });
    for (const viewer of [0, 1, null]) {
      const projected = views.projectStoredEvent(stored, viewer);
      expect(projected).toMatchObject({ kind: "toss", seat: 1, sourceCode: 81480460, card: stored.card, toss: stored.toss });
      expect(projected.toss!.results).not.toBe(stored.toss!.results);
    }
  });

  it("does not guess a source when no link is resolving", () => {
    const event = views.observeDuelEvent(coin(), cards, chain, 1)!;
    expect(event).toMatchObject({ kind: "toss", seat: 1, toss: { type: "coin", results: ["heads", "tails", "heads"] } });
    expect(event.card).toBeUndefined();
    expect(event.sourceCode).toBeUndefined();
    expect(event.chainIndex).toBeUndefined();
  });

  it("retains an unknown source code and clears it after the link ends", () => {
    const ctx = views.createEventContext() as never;
    views.observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 2 }, cards, chain, 1, ctx);
    const event = views.observeDuelEvent(coin(0), cards, chain, 2, ctx)!;
    expect(event).toMatchObject({ seat: 0, sourceCode: 12580477, chainIndex: 2 });
    expect(event.card).toBeUndefined();
    views.observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVED, chain_size: 2 }, cards, chain, 3, ctx);
    expect(views.observeDuelEvent(coin(0), cards, chain, 4, ctx)!.sourceCode).toBeUndefined();
  });

  it("does not emit a dice event", () => {
    expect(views.observeDuelEvent({ type: OcgMessageType.TOSS_DICE, player: 0, results: [2, 6] }, cards, [], 1)).toBeNull();
  });
});

describe("coin toss snapshot projection", () => {
  const cases = [
    ["merged", "1v1", merged], ["legacy", "1v1", legacy],
    ["merged", "ffa3", merged], ["merged", "ffa4", merged], ["merged", "tag", merged],
  ] as const;
  it.each(cases)("%s %s: every seat and spectator get the same toss and log link", (_name, format: DuelFormat, views) => {
    const count = seatCountFor(format);
    const seat = count - 1;
    const ctx = (views === merged ? merged.createEventContext(format) : legacy.createEventContext()) as never;
    const event = views.observeDuelEvent(coin(seat), cards, [], 9, ctx)!;
    expect(event.seat).toBe(seat);
    for (const viewer of [...Array.from({ length: count }, (_, i) => i), null]) {
      const view = views.projectView({
        lib: {
          duelQueryField: () => ({ players: [{ deck_size: 20, extra_size: 0 }, { deck_size: 20, extra_size: 0 }], chain: [] }),
          duelQueryLocation: () => [], duelQueryCount: () => 20,
        } as never,
        handle: {} as never, cards, viewer, format,
        revision: 1, turn: 1, turnSeat: seat, phase: "main1", lp: Array(count).fill(8000) as [number, number],
        prompt: null, promptSeat: null, result: null, mode: "normal", reveals: views.createRevealMap(count),
        events: [event], log: [{ id: 3, text: event.text, audience: "all", eventId: 9 }, { id: 4, text: "Main Phase 1", audience: "all" }],
      });
      expect(view.events).toEqual([views.projectStoredEvent(event, viewer)]);
      expect(view.log).toEqual([{ id: 3, text: "Coin toss: Heads, Tails, Heads", eventId: 9 }, { id: 4, text: "Main Phase 1" }]);
    }
  });
});
