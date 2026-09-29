import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import {
  collectFreshEvents,
} from "../../src/components/duel/event-queue";

function event(
  id: number,
  kind: DuelEvent["kind"],
  chainIndex?: number,
): DuelEvent {
  return {
    id,
    kind,
    text: kind,
    ...(chainIndex != null ? { chainIndex } : {}),
  };
}

/** Three-link resolution: resolving/resolved pairs plus chain-end. */
const threeLinkResolution: DuelEvent[] = [
  event(11, "chain-resolving", 3),
  event(12, "chain-resolved", 3),
  event(13, "chain-resolving", 2),
  event(14, "chain-resolved", 2),
  event(15, "chain-resolving", 1),
  event(16, "chain-resolved", 1),
  event(17, "chain-end"),
];

describe("collectFreshEvents", () => {
  it("keeps a three-link resolution batch in engine id order", () => {
    const { nextCursor, fresh } = collectFreshEvents(threeLinkResolution, 10);

    expect(fresh.map((item) => item.id)).toEqual([11, 12, 13, 14, 15, 16, 17]);
    expect(fresh.map((item) => item.kind)).toEqual([
      "chain-resolving",
      "chain-resolved",
      "chain-resolving",
      "chain-resolved",
      "chain-resolving",
      "chain-resolved",
      "chain-end",
    ]);
    expect(fresh.map((item) => item.chainIndex)).toEqual([3, 3, 2, 2, 1, 1, undefined]);
    expect(nextCursor).toBe(17);
  });

  it("sorts a shuffled snapshot without inventing sequence", () => {
    const shuffled = [
      threeLinkResolution[6],
      threeLinkResolution[2],
      threeLinkResolution[0],
      threeLinkResolution[5],
      threeLinkResolution[1],
      threeLinkResolution[4],
      threeLinkResolution[3],
    ];

    const { fresh } = collectFreshEvents(shuffled, 10);
    expect(fresh.map((item) => item.id)).toEqual([11, 12, 13, 14, 15, 16, 17]);
  });

  it("does not replay the same snapshot after the cursor advances", () => {
    const first = collectFreshEvents(threeLinkResolution, 10);
    const second = collectFreshEvents(threeLinkResolution, first.nextCursor);

    expect(second.fresh).toEqual([]);
    expect(second.nextCursor).toBe(first.nextCursor);
  });

});

