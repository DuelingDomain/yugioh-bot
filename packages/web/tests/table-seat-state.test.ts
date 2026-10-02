import { describe, expect, it } from "vitest";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { tableLayout } from "@/components/duel/table/geometry";
import {
  attackLockAt,
  firstAttackTurn,
  lastSeatDamage,
  placeLabel,
  placings,
  seatsOut,
  seatStrip,
  trackOutOrder,
} from "@/components/duel/table/seat-state";

const engineOf = (id: keyof typeof FFA3_FIXTURES.states) => FFA3_FIXTURES.states[id].room.engine!;

describe("seat-state", () => {
  it("lists the seats that are out", () => {
    expect(seatsOut(engineOf("main"))).toEqual([]);
    expect(seatsOut(engineOf("elimination"))).toEqual([2]);
  });

  it("keeps the order in which seats left, as groups", () => {
    const first = trackOutOrder([], engineOf("elimination"));
    expect(first).toEqual([[2]]);
    expect(trackOutOrder(first, engineOf("elimination"))).toBe(first);
    expect(trackOutOrder(first, engineOf("result"))).toEqual([[2], [1]]);
    expect(trackOutOrder([[2], [1]], engineOf("main"))).toEqual([]);
  });

  it("puts seats that are already out when the shell opens into one group", () => {
    expect(trackOutOrder([], engineOf("result"))).toEqual([[1, 2]]);
  });

  it("starts from the order a room knows", () => {
    expect(trackOutOrder([[2], [1]], engineOf("result"))).toEqual([[2], [1]]);
  });

  it("puts the winner first and the last group out second", () => {
    const rows = placings(engineOf("result"), [[2], [1]]);
    expect(rows.map((row) => [row.seat, row.place, row.winner])).toEqual([
      [0, 1, true],
      [1, 2, false],
      [2, 3, false],
    ]);
  });

  it("gives seats that left in one update the same place", () => {
    expect(placings(engineOf("result"), [[1, 2]]).map((row) => row.place)).toEqual([1, 2, 2]);
  });

  it("gives seats with no known order of leaving the same place", () => {
    const rows = placings(engineOf("result"));
    expect(rows.map((row) => row.place)).toEqual([1, 2, 2]);
  });

  it("ranks live seats by Life Points while the duel runs", () => {
    const rows = placings({ ...engineOf("main"), result: null });
    expect(rows.map((row) => row.seat)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.place)).toEqual([1, 2, 3]);
  });

  it("writes places in words", () => {
    expect([1, 2, 3, 4, 11, 12, 21].map(placeLabel)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "21st"]);
  });

  it("knows when the first attack is legal", () => {
    expect(firstAttackTurn("ffa3", 3)).toBe(4);
    expect(firstAttackTurn("ffa4", 4)).toBe(5);
    expect(firstAttackTurn("tag", 4)).toBe(4);
    expect(firstAttackTurn("1v1", 2)).toBe(2);
    expect(attackLockAt("ffa3", 3, 2)).toEqual({ firstTurn: 4, turnsLeft: 2 });
    expect(attackLockAt("ffa3", 3, 4)).toBeNull();
    expect(attackLockAt("ffa3", 3, null)).toBeNull();
  });

  it("builds the seat strip in turn order with the viewer marked", () => {
    const engine = engineOf("elimination");
    const layout = tableLayout("ffa3", engine, 0);
    const strip = seatStrip(layout, engine, null, (seat) => `S${seat}`);
    expect(strip.map((entry) => entry.seat)).toEqual([0, 1, 2]);
    expect(strip.filter((entry) => entry.you).map((entry) => entry.seat)).toEqual([0]);
    expect(strip.find((entry) => entry.seat === 2)?.status).toBe("eliminated");
    expect(strip.find((entry) => entry.seat === 0)?.status).toBe("turn");
  });

  it("marks the seat after the turn seat as next, and skips a seat that is out", () => {
    const main = engineOf("main");
    const layout = tableLayout("ffa3", main, 0);
    const strip = seatStrip(layout, main, null, (seat) => `S${seat}`);
    expect(strip.find((entry) => entry.seat === main.turnSeat)?.status).toBe("turn");
    expect(strip.filter((entry) => entry.status === "next")).toHaveLength(1);
    expect(strip.filter((entry) => entry.status === "active")).toHaveLength(1);
    // The seat that is choosing keeps "choosing" even if it is next.
    const next = strip.find((entry) => entry.status === "next")!.seat;
    expect(seatStrip(layout, main, next, (seat) => `S${seat}`).find((entry) => entry.seat === next)?.status).toBe("choosing");
    // With the next seat out, "next" moves on to the live seat after it.
    const out = engineOf("elimination");
    const outStrip = seatStrip(tableLayout("ffa3", out, 0), out, null, (seat) => `S${seat}`);
    const nextOut = outStrip.find((entry) => entry.status === "next");
    expect(nextOut).toBeDefined();
    expect(nextOut!.seat).not.toBe(2);
  });
});

describe("lastSeatDamage", () => {
  const ev = (id: number, seat: number, amount: number) => ({ id, kind: "damage" as const, seat, amount, text: "" });
  it("returns the newest damage of the seat", () => {
    expect(lastSeatDamage([ev(1, 1, 500), ev(2, 0, 300), ev(3, 1, 1200)], 1)).toBe(1200);
  });
  it("returns null when the newest LP event healed or none exists", () => {
    expect(lastSeatDamage([ev(1, 1, 500), ev(2, 1, -400)], 1)).toBeNull();
    expect(lastSeatDamage([ev(1, 0, 500)], 1)).toBeNull();
  });
});
