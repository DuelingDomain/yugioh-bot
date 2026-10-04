import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import {
  collectFreshEvents,
  auraTintOf,
  cueDuration,
  hasCentreBanner,
  isHeavySummon,
  slamCrackCount,
  slamStrengthOf,
  slamTierOf,
  pacedCueDuration,
  positionChangeOf,
  type PositionEvent,
} from "../../src/components/duel/event-queue";
import { CHAIN_TIMING } from "../../src/components/duel/duel-timing";

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
  it("consumes confirmations without allocating a feedback banner", () => {
    const confirm = event(18, "confirm");
    expect(collectFreshEvents([confirm], 17)).toEqual({ nextCursor: 18, fresh: [confirm] });
    expect(hasCentreBanner("confirm")).toBe(false);
    expect(cueDuration("confirm", false)).toBe(0);
    expect(cueDuration("confirm", true)).toBe(0);
  });

  it("consumes board-only target updates without allocating a banner duration", () => {
    const target = { ...event(18, "target", 1), targets: [] };
    expect(collectFreshEvents([target], 17)).toEqual({ nextCursor: 18, fresh: [target] });
    expect(hasCentreBanner("target")).toBe(false);
    expect(cueDuration("target", false)).toBe(0);
    expect(cueDuration("target", true)).toBe(0);
  });

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

describe("heavy rule by attack", () => {
  const strong = (attack: number, level = 4, summonKind?: DuelEvent["summonKind"]): DuelEvent => ({
    id: 1, kind: "summon", text: "s", ...(summonKind ? { summonKind } : {}),
    card: { code: 100, name: "x", description: "", type: 0x21, attack, defense: 0, level, attribute: 0, race: "" },
  });
  it("counts a monster with 2500 ATK or more whatever its Level", () => {
    expect(isHeavySummon(strong(2500))).toBe(true);
    expect(isHeavySummon(strong(2400, 6))).toBe(false);
  });

  it("slams heavy and typed summons and nothing else", () => {
    expect(slamStrengthOf(strong(1800, 4))).toBe(0);
    expect(slamStrengthOf(strong(1800, 4, "special"))).toBe(0);
    expect(slamStrengthOf(strong(1800, 4, "tribute"))).toBeGreaterThan(0);
    expect(slamStrengthOf(strong(1800, 4, "fusion"))).toBeGreaterThan(0);
    expect(slamStrengthOf({ ...strong(3000), kind: "set" })).toBe(0);
    expect(slamStrengthOf({ id: 2, kind: "summon", text: "s" })).toBe(0);
    // An old server that only says "special" is read from the Extra Deck origin and card type.
    const xyz = { ...strong(1000, 4, "special"), card: { ...strong(1000).card!, type: 0x800001 } };
    expect(slamStrengthOf(xyz, 0x40)).toBeGreaterThan(0);
    expect(slamStrengthOf(xyz)).toBe(0);
  });

  it("grows with Level and ATK and stays inside 0.6 to 1.6", () => {
    const weak = slamStrengthOf(strong(1500, 5, "tribute"));
    const mid = slamStrengthOf(strong(2500, 7));
    const big = slamStrengthOf(strong(3000, 10));
    const top = slamStrengthOf(strong(5000, 12, "tribute"));
    expect(weak).toBeLessThan(mid);
    expect(mid).toBeLessThan(big);
    expect(big).toBeLessThan(top);
    expect(weak).toBeGreaterThanOrEqual(0.6);
    expect(top).toBeLessThanOrEqual(1.6);
  });

  it("gives stronger slams more cracks and a higher tier", () => {
    expect(slamCrackCount(1.6)).toBeGreaterThan(slamCrackCount(0.6));
    expect(slamTierOf(0.6)).toBe(1);
    expect(slamTierOf(1)).toBe(2);
    expect(slamTierOf(1.5)).toBe(3);
  });
});

describe("auraTintOf", () => {
  it("tints by attribute and falls back to gold and purple", () => {
    expect(auraTintOf(0x04)).not.toEqual(auraTintOf(0x02));
    expect(auraTintOf(0x20)[0]).toBe("184 120 255");
    expect(auraTintOf(0)).toEqual(["244 214 144", "155 126 255"]);
    expect(auraTintOf(undefined)).toEqual(auraTintOf(0));
  });
});

describe("chain banners", () => {
  it("has no centre banner for a link resolving or resolved, nor for the chain end", () => {
    expect(hasCentreBanner("chain-resolving")).toBe(false);
    expect(hasCentreBanner("chain-resolved")).toBe(false);
    expect(hasCentreBanner("chain-end")).toBe(false);
  });

  it("keeps the Activate and Negated banners, at their own length", () => {
    expect(hasCentreBanner("activate")).toBe(true);
    expect(hasCentreBanner("chain-negated")).toBe(true);
    // The activate banner is one activate beat, so it is gone when its link starts to resolve.
    expect(cueDuration("activate", false)).toBe(CHAIN_TIMING.activateMs);
    expect(cueDuration("activate", false)).toBe(1170);
    expect(cueDuration("chain-negated", false)).toBe(1300);
    expect(cueDuration("activate", true)).toBe(960);
  });

  it("never squeezes the activate banner below the readable floor, whatever the backlog", () => {
    for (const count of [2, 6, 20, 60]) {
      expect(pacedCueDuration("activate", false, count)).toBeGreaterThanOrEqual(CHAIN_TIMING.readableFloorMs.activate);
    }
    expect(pacedCueDuration("activate", false, 60)).toBe(CHAIN_TIMING.readableFloorMs.activate);
    expect(pacedCueDuration("summon", false, 60)).toBe(300);
  });
});

describe("pacedCueDuration", () => {
  it("keeps a short backlog at a readable pace", () => {
    expect(pacedCueDuration("summon", false, 1)).toBe(1600);
    expect(pacedCueDuration("summon", false, 6)).toBe(800);
  });

  it("never lets a long backlog trail the board by much more than about 9 s", () => {
    for (const count of [10, 20, 28]) {
      expect(pacedCueDuration("summon", false, count) * count).toBeLessThanOrEqual(9000);
    }
    expect(pacedCueDuration("summon", false, 60)).toBe(300);
  });
});

describe("positionChangeOf", () => {
  function position(location: number, fromPosition: number, toPosition: number, flip = false): PositionEvent {
    return {
      id: 1,
      kind: "position",
      text: "position",
      zone: { controller: 0, location, sequence: 2 },
      fromPosition,
      toPosition,
      ...(flip ? { flip: true } : {}),
    } as PositionEvent;
  }

  it("keeps an activated Set Spell/Trap upright (engine sends 0xA to 0x5)", () => {
    // Both values carry a defense bit; only a monster zone may turn the card sideways.
    const change = positionChangeOf(position(0x08, 0x0a, 0x05, true));
    expect(change).toMatchObject({ reveal: true, turn: false, fromDefense: false, toDefense: false });
  });

  it("keeps a flipped face-down Defense monster sideways", () => {
    const change = positionChangeOf(position(0x04, 0x08, 0x04, true));
    expect(change).toMatchObject({ reveal: true, turn: false, fromDefense: true, toDefense: true });
  });

  it("turns a monster between Attack and Defense", () => {
    expect(positionChangeOf(position(0x04, 0x01, 0x04))).toMatchObject({ turn: true, fromDefense: false, toDefense: true });
  });
});
