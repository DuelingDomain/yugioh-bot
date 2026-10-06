import { describe, expect, it } from "vitest";
import { SANDBOX_START_PHASES, parseSandboxBoard } from "@yugidraft/shared/duels";
import {
  activeSeats,
  applyAction,
  battleBlockReason,
  checkBuilderState,
  createBuilderState,
  createHistory,
  eliminatedSeats,
  historyReducer,
  isEliminated,
  loadBuilderState,
  type SandboxAction,
  type SandboxBuilderState,
} from "../src/components/sandbox/board-model";

const DM = 46986414;
const BEWD = 89631139;

/** Run actions in order. Any refusal fails the test. */
function run(state: SandboxBuilderState, ...actions: SandboxAction[]): SandboxBuilderState {
  let current = state;
  for (const action of actions) {
    const result = applyAction(current, action);
    expect(result.error, JSON.stringify(action)).toBeUndefined();
    current = result.state;
  }
  return current;
}

const refused = (state: SandboxBuilderState, action: SandboxAction) => {
  const result = applyAction(state, action);
  expect(result.error, JSON.stringify(action)).toBeTruthy();
  expect(result.state).toBe(state);
  return result.error as string;
};

const table = (format: "ffa3" | "ffa4" = "ffa4") => createBuilderState(format);

describe("start phase", () => {
  it("starts at Draw and takes every phase the shared parser takes", () => {
    let state = createBuilderState();
    expect(state.board.startAt).toBe("draw");
    state = run(state, { type: "setAttackFirstTurn", value: true });
    for (const phase of SANDBOX_START_PHASES) {
      state = run(state, { type: "setStartAt", phase });
      expect(state.board.startAt).toBe(phase);
      expect(checkBuilderState(state)).toEqual({ ok: true });
      expect(parseSandboxBoard(state.board)).toEqual(state.board);
    }
  });

  it("refuses Battle on turn 1 without Attack on turn 1, like the parser", () => {
    const state = createBuilderState();
    expect(battleBlockReason(state.board)).toMatch(/Attack on turn 1/);
    refused(state, { type: "setStartAt", phase: "battle" });
    expect(() => parseSandboxBoard({ ...state.board, startAt: "battle" })).toThrow(/attackFirstTurn/);
  });

  it("allows Battle with Attack on turn 1, or when a later seat has the turn", () => {
    const attack = run(createBuilderState(), { type: "setAttackFirstTurn", value: true }, { type: "setStartAt", phase: "battle" });
    expect(attack.board.startAt).toBe("battle");
    const later = run(table("ffa3"), { type: "setTurn", turn: "p1" }, { type: "setStartAt", phase: "battle" });
    expect(battleBlockReason(later.board)).toBeNull();
    expect(checkBuilderState(later)).toEqual({ ok: true });
  });

  it("falls back to Main 1 with a notice when a change would break Battle", () => {
    const base = run(createBuilderState("ffa3"), { type: "setTurn", turn: "p1" }, { type: "setStartAt", phase: "battle" });
    const turned = applyAction(base, { type: "setTurn", turn: "p0" });
    expect(turned.error).toBeUndefined();
    expect(turned.state.board.startAt).toBe("main1");
    expect(turned.notice).toMatch(/Main 1/);
    expect(checkBuilderState(turned.state)).toEqual({ ok: true });

    const attack = run(createBuilderState(), { type: "setAttackFirstTurn", value: true }, { type: "setStartAt", phase: "battle" });
    const off = applyAction(attack, { type: "setAttackFirstTurn", value: false });
    expect(off.state.board.startAt).toBe("main1");
    expect(off.notice).toBeTruthy();
  });

  it("keeps the phase through other edits and through load", () => {
    const state = run(createBuilderState(), { type: "setStartAt", phase: "end" }, { type: "add", seat: "p0", card: DM });
    expect(state.board.startAt).toBe("end");
    expect(loadBuilderState(state.board, state.run)).toEqual(state);
  });

  it("refuses an unknown phase", () => {
    refused(createBuilderState(), { type: "setStartAt", phase: "damage" as never });
  });
});

describe("eliminated seats", () => {
  it("takes a seat out: cards go, LP stays, the board still parses", () => {
    let state = run(table(), { type: "add", seat: "p1", card: DM }, { type: "place", at: { seat: "p1", zone: "monster", index: 0 }, card: BEWD }, { type: "setLp", seat: "p1", lp: 3000 });
    state = run(state, { type: "toggleEliminated", seat: "p1" });
    expect(state.board.eliminated).toEqual(["p1"]);
    expect(state.board.p1).toEqual({ lp: 3000 });
    expect(isEliminated(state.board, "p1")).toBe(true);
    expect(activeSeats(state.board)).toEqual(["p0", "p2", "p3"]);
    expect(checkBuilderState(state)).toEqual({ ok: true });
    expect(parseSandboxBoard(state.board)).toEqual(state.board);
  });

  it("keeps seats in seat order and puts one back empty", () => {
    let state = run(table(), { type: "toggleEliminated", seat: "p3" }, { type: "toggleEliminated", seat: "p1" });
    expect(eliminatedSeats(state.board)).toEqual(["p1", "p3"]);
    expect(state.board.eliminated).toEqual(["p1", "p3"]);
    state = run(state, { type: "toggleEliminated", seat: "p1" });
    expect(state.board.eliminated).toEqual(["p3"]);
    expect(state.board.p1).toBeUndefined();
    state = run(state, { type: "toggleEliminated", seat: "p3" });
    expect(state.board.eliminated).toBeUndefined();
  });

  it("only works on 3-way and 4-way", () => {
    expect(refused(createBuilderState(), { type: "toggleEliminated", seat: "p1" })).toMatch(/3-way and 4-way/);
    expect(refused(createBuilderState("tag"), { type: "toggleEliminated", seat: "p1" })).toMatch(/3-way and 4-way/);
    refused(table("ffa3"), { type: "toggleEliminated", seat: "p3" });
  });

  it("keeps the turn player and two players in", () => {
    const state = table("ffa3");
    expect(refused(state, { type: "toggleEliminated", seat: "p0" })).toMatch(/turn player/);
    const one = run(state, { type: "toggleEliminated", seat: "p1" });
    expect(refused(one, { type: "toggleEliminated", seat: "p2" })).toMatch(/two players/);
    const moved = run(table("ffa4"), { type: "setTurn", turn: "p2" }, { type: "toggleEliminated", seat: "p0" });
    expect(isEliminated(moved.board, "p0")).toBe(true);
    expect(refused(moved, { type: "setTurn", turn: "p0" })).toMatch(/out/);
    const two = run(table("ffa4"), { type: "toggleEliminated", seat: "p1" }, { type: "toggleEliminated", seat: "p3" });
    refused(two, { type: "toggleEliminated", seat: "p2" });
  });

  it("refuses card edits on a seat that is out, and allows LP 0 only there", () => {
    const state = run(table(), { type: "toggleEliminated", seat: "p2" });
    refused(state, { type: "add", seat: "p2", card: DM });
    refused(state, { type: "place", at: { seat: "p2", zone: "monster", index: 0 }, card: DM });
    refused(state, { type: "paste", seat: "p2", codes: [DM] });
    const zero = run(state, { type: "setLp", seat: "p2", lp: 0 });
    expect(zero.board.p2).toEqual({ lp: 0 });
    expect(checkBuilderState(zero)).toEqual({ ok: true });
    refused(zero, { type: "setLp", seat: "p1", lp: 0 });
  });

  it("drops players out when the format cannot hold them", () => {
    const four = run(table("ffa4"), { type: "toggleEliminated", seat: "p3" }, { type: "toggleEliminated", seat: "p2" });
    const three = run(four, { type: "setFormat", format: "ffa3" });
    expect(three.board.eliminated).toEqual(["p2"]);
    expect(checkBuilderState(three)).toEqual({ ok: true });
    const solo = run(four, { type: "setFormat", format: "1v1" });
    expect(solo.board.eliminated).toBeUndefined();
    expect(solo.board.p2).toBeUndefined();
    expect(checkBuilderState(solo)).toEqual({ ok: true });
  });

  it("does not need a Deck Master on a seat that is out in Domain mode", () => {
    let state = run(table("ffa3"), { type: "setMode", mode: "domain" });
    for (const seat of ["p0", "p1", "p2"] as const) state = run(state, { type: "add", seat, zone: "extra", card: DM }, { type: "place", at: { seat, zone: "deckMaster", index: 0 }, card: DM });
    state = run(state, { type: "toggleEliminated", seat: "p2" });
    expect(state.board.p2).toBeUndefined();
    expect(checkBuilderState(state)).toEqual({ ok: true });
    const back = run(state, { type: "toggleEliminated", seat: "p2" });
    expect(checkBuilderState(back).ok).toBe(false);
  });

  it("round-trips through load and the shared parser", () => {
    const state = run(table(), { type: "toggleEliminated", seat: "p1" }, { type: "setLp", seat: "p1", lp: 0 }, { type: "add", seat: "p0", card: DM });
    expect(loadBuilderState(state.board, state.run)).toEqual(state);
  });
});

describe("history replace", () => {
  it("swaps the board and keeps undo", () => {
    const first = createBuilderState();
    const next = run(createBuilderState("ffa3"), { type: "add", seat: "p1", card: DM });
    let history = historyReducer(createHistory(first), { type: "replace", state: next });
    expect(history.present).toBe(next);
    expect(history.past).toEqual([first]);
    history = historyReducer(history, { type: "undo" });
    expect(history.present).toBe(first);
    expect(historyReducer(history, { type: "replace", state: first })).toBe(history);
  });
});
