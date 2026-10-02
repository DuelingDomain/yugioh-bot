import { describe, expect, it } from "vitest";
import { eliminationOrder } from "@/lib/duel/elimination-order";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { placings } from "@/components/duel/table/seat-state";

const result = FFA3_FIXTURES.states.result.room.engine!;
const log = (...texts: string[]) => texts.map((text, id) => ({ id, text }));

describe("elimination order", () => {
  it("prefers engine groups, retaining simultaneous elimination ties", () => {
    const engine = { ...result, eliminationOrder: [[1, 2]], log: log("Player 3 is eliminated", "Player 2 is eliminated") };
    expect(eliminationOrder(engine)).toEqual([[1, 2]]);
    expect(placings(engine, eliminationOrder(engine)).map((row) => row.place)).toEqual([1, 2, 2]);
  });

  it("reads the real engine wording and one-based player numbers in log order", () => {
    const engine = { ...result, log: log("Player 3 is eliminated (surrender)", "Player 2 takes 400 damage", "Player 2 is eliminated (LP reached 0)") };
    expect(eliminationOrder(engine)).toEqual([[2], [1]]);
    expect(placings(engine, eliminationOrder(engine)).map((row) => [row.seat, row.place])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it("ignores duplicates, invalid seats, and seats whose elimination is still pending", () => {
    const engine = { ...result, log: log("Player 0 is eliminated", "Player 99 is eliminated", "Player 1 is eliminated", "Player 3 is eliminated", "Player 3 is eliminated", "Player 2 is eliminated") };
    expect(eliminationOrder(engine)).toEqual([[2], [1]]);
  });

  it("keeps previously observed groups when the log has been cut", () => {
    expect(eliminationOrder({ ...result, log: log("Player 2 is eliminated (surrender)") }, [[2]])).toEqual([[2], [1]]);
  });

  it("groups unknown earlier eliminations together before the retained log", () => {
    expect(eliminationOrder({ ...result, log: log("Player 2 is eliminated") })).toEqual([[2], [1]]);
    expect(eliminationOrder({ ...result, log: [] })).toEqual([[1, 2]]);
  });

  it("sanitizes engine groups without mutating the view", () => {
    const engine = { ...result, eliminationOrder: [[2, 99, 2], [0], [1, 2], []] };
    expect(eliminationOrder(engine)).toEqual([[2], [1]]);
    expect(engine.eliminationOrder).toEqual([[2, 99, 2], [0], [1, 2], []]);
  });

  it("falls back to logs when the optional view field is not an array", () => {
    expect(eliminationOrder({ ...result, eliminationOrder: null, log: log("Player 3 is eliminated", "Player 2 is eliminated") })).toEqual([[2], [1]]);
  });

  it("clears old observations when no seats are eliminated", () => {
    expect(eliminationOrder(FFA3_FIXTURES.states.main.room.engine!, [[2], [1]])).toEqual([]);
  });
});
