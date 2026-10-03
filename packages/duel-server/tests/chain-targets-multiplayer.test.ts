import { describe, expect, it } from "vitest";
import type { DuelFormat } from "@yugidraft/shared/duels";
import type { CardDatabase } from "../src/cards.js";
import { createEventContext, createRevealMap, noteChainTargetLog, projectView, type StoredChainLink } from "../src/views.js";

const source = { controller: 0, location: 8, sequence: 0 };
const targets = [{ controller: 2, location: 8, sequence: 1 }];
const link: StoredChainLink = { index: 1, seat: 0, code: 5318639, description: "MST", zone: source, targets };

describe("multiplayer chain target projection", () => {
  it.each(["ffa3", "ffa4", "tag"] as const)("keeps live source and target coordinates in %s views", (format: DuelFormat) => {
    const view = projectView({
      lib: { duelQueryLocation: () => [], duelQueryCount: () => 0 } as never,
      handle: {} as never, cards: { get: () => undefined } as unknown as CardDatabase,
      viewer: null, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000, 8000, 8000],
      prompt: null, promptSeat: null, log: [], events: [], result: null,
      reveals: createRevealMap(), mode: "normal", format, chain: [link],
    });
    expect(view.chain[0]).toMatchObject({ zone: source, targets });
    expect(view.prompt).toBeNull();
  });

  it("accepts retarget notes for every living table seat", () => {
    const ctx = createEventContext("ffa4");
    noteChainTargetLog(ctx, "YGD:CHAIN_TARGET:1;2:8:0,3:4:1");
    noteChainTargetLog(ctx, "YGD:CHAIN_TARGET:1;4:8:0");
    expect(ctx.chainTargetNotes).toEqual([{ index: 1, targets: [
      { controller: 2, location: 8, sequence: 0 }, { controller: 3, location: 4, sequence: 1 },
    ] }]);
  });
});
