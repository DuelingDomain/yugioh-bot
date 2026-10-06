import { describe, expect, it } from "vitest";
import * as shared from "../src/duels/index.js";

const { parseSandboxBoard, SandboxBoardError } = shared;
const phases = ["draw", "standby", "main1", "battle", "main2", "end"] as const;
const code = 89631139;

function rejects(board: unknown, path: string, message?: RegExp) {
  expect(() => parseSandboxBoard(board)).toThrow(SandboxBoardError);
  try { parseSandboxBoard(board); } catch (error) {
    expect(error).toMatchObject({ path });
    if (message) expect((error as Error).message).toMatch(message);
  }
}

describe("sandbox v2 board contract", () => {
  it("exports the supported phases", () => {
    expect(shared).toHaveProperty("SANDBOX_START_PHASES", phases);
  });

  it.each(phases)("accepts startAt %s with first-turn attacks enabled", (startAt) => {
    expect(parseSandboxBoard({ startAt, attackFirstTurn: true }).startAt).toBe(startAt);
  });

  it.each(phases.filter((phase) => phase !== "battle"))("accepts %s without first-turn attacks", (startAt) => {
    expect(parseSandboxBoard({ startAt }).startAt).toBe(startAt);
  });

  it.each([undefined, false])("rejects Battle Phase on turn 1 with attackFirstTurn=%s", (attackFirstTurn) => {
    rejects({ startAt: "battle", ...(attackFirstTurn === undefined ? {} : { attackFirstTurn }) }, "startAt", /turn 1.*attackFirstTurn/i);
  });

  it.each(["p1", "p2", "p3"])("allows Battle Phase after skipped turns before %s", (turn) => {
    expect(parseSandboxBoard({ format: "ffa4", turn, startAt: "battle" }).startAt).toBe("battle");
  });

  it.each(["ffa3", "ffa4"])("keeps empty eliminated seats in %s", (format) => {
    const board = { format, eliminated: ["p2"], p2: { lp: 0, hand: [], monsters: [null], pendulum: [null, null] } };
    const parsed = parseSandboxBoard(board);
    expect(parsed).toMatchObject(board);
    expect(parsed).not.toBe(board);
    expect(parsed).toHaveProperty("eliminated", ["p2"]);
    expect(parsed.eliminated).not.toBe(board.eliminated);
  });

  it("allows two eliminated seats in FFA4 without moving the active seats", () => {
    expect(parseSandboxBoard({ format: "ffa4", turn: "p2", eliminated: ["p0", "p3"] }))
      .toMatchObject({ turn: "p2", eliminated: ["p0", "p3"] });
  });

  it("requires a Deck Master only on active Domain seats", () => {
    const board = { format: "ffa3", mode: "domain", eliminated: ["p2"], p0: { deckMaster: code }, p1: { deckMaster: code } };
    expect(parseSandboxBoard(board)).toMatchObject(board);
    rejects({ ...board, p1: {} }, "p1.deckMaster");
    rejects({ ...board, p2: { deckMaster: code } }, "p2.deckMaster", /eliminated/i);
  });

  it.each([
    [{ eliminated: [] }, "eliminated"],
    [{ format: "tag", eliminated: ["p2"] }, "eliminated"],
    [{ format: "ffa3", eliminated: ["p3"] }, "eliminated[0]"],
    [{ format: "ffa4", eliminated: ["p4"] }, "eliminated[0]"],
    [{ format: "ffa4", eliminated: [2] }, "eliminated[0]"],
    [{ format: "ffa4", eliminated: ["p2", "p2"] }, "eliminated[1]"],
    [{ format: "ffa3", eliminated: ["p1", "p2"] }, "eliminated"],
    [{ format: "ffa4", eliminated: ["p1", "p2", "p3"] }, "eliminated"],
    [{ format: "ffa4", eliminated: ["p0"] }, "turn"],
    [{ format: "ffa4", turn: "p2", eliminated: ["p2"] }, "turn"],
    [{ format: "ffa4", eliminated: null }, "eliminated"],
    [{ format: "ffa4", eliminated: "p2" }, "eliminated"],
    [{ format: "ffa4", eliminated: Array(1) }, "eliminated[0]"],
    [{ format: "ffa4", eliminated: ["p2"], p1: { lp: 0 } }, "p1.lp"],
    [{ format: "ffa4", eliminated: ["p2"], p2: { lp: -1 } }, "p2.lp"],
  ])("rejects invalid elimination state: %j", (board, path) => rejects(board, path as string));

  it.each(["hand", "monsters", "spells", "pendulum", "grave", "banished", "deck", "extra"])(
    "rejects cards in an eliminated seat's %s", (zone) => {
      rejects({ format: "ffa3", eliminated: ["p2"], p2: { [zone]: [code] } }, `p2.${zone}`, /eliminated/i);
    },
  );

  it.each(["field", "deckMaster"])("rejects an eliminated seat's %s", (zone) => {
    rejects({ format: "ffa3", eliminated: ["p2"], p2: { [zone]: code } }, `p2.${zone}`, /eliminated/i);
  });

  it("accepts explicit empty elimination lists in FFA and keeps older boards unchanged", () => {
    expect(parseSandboxBoard({ format: "ffa3", eliminated: [] })).toHaveProperty("eliminated", []);
    expect(parseSandboxBoard({})).not.toHaveProperty("eliminated");
    expect(parseSandboxBoard({}).startAt).toBe("draw");
  });
});
