import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import {
  collectFreshEvents,
  isHeavySummon,
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


describe("isHeavySummon", () => {
  const card = (level: number, type = 0x21) => ({
    code: 100, name: "x", description: "", type, attack: 0, defense: 0, level, attribute: 0, race: "",
  });
  const summon = (level: number, summonKind?: DuelEvent["summonKind"], type?: number): DuelEvent => ({
    id: 1, kind: "summon", text: "s", card: card(level, type), ...(summonKind ? { summonKind } : {}),
  });

  it("counts Level or Rank 7 and higher", () => {
    expect(isHeavySummon(summon(7))).toBe(true);
    expect(isHeavySummon(summon(12, "special"))).toBe(true);
    expect(isHeavySummon(summon(6))).toBe(false);
  });

  it("counts every Tribute Summon, whatever the level", () => {
    expect(isHeavySummon(summon(5, "tribute"))).toBe(true);
  });

  it("ignores other kinds, hidden cards and non-monsters", () => {
    expect(isHeavySummon({ ...summon(8), kind: "set" })).toBe(false);
    expect(isHeavySummon({ id: 2, kind: "summon", text: "s" })).toBe(false);
    expect(isHeavySummon({ ...summon(8), card: { ...card(8), code: 0 } })).toBe(false);
    expect(isHeavySummon(summon(8, undefined, 0x2))).toBe(false);
  });
});
