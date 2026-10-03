import { describe, expect, it } from "vitest";
import {
  DUEL_OPENING_PICK_MS,
  DUEL_OPENING_REVEAL_MS,
  DuelOpeningError,
  newOpening,
  openingNeedsSwap,
  openingView,
  rpsWinner,
  settleOpening,
  submitOpeningChoice,
  submitOpeningPick,
  swapOpeningSeats,
} from "../../src/duels/opening.js";

describe("rock-paper-scissors rules", () => {
  it("rock beats scissors, scissors beat paper, paper beats rock", () => {
    expect(rpsWinner(["rock", "scissors"])).toBe(0);
    expect(rpsWinner(["scissors", "rock"])).toBe(1);
    expect(rpsWinner(["scissors", "paper"])).toBe(0);
    expect(rpsWinner(["paper", "scissors"])).toBe(1);
    expect(rpsWinner(["paper", "rock"])).toBe(0);
    expect(rpsWinner(["rock", "paper"])).toBe(1);
  });

  it("calls the same move a tie", () => {
    expect(rpsWinner(["paper", "paper"])).toBeNull();
  });
});

describe("opening state", () => {
  it("hides a pick from the other seat until both are in", () => {
    let state = newOpening(7, 1000);
    state = submitOpeningPick(state, 0, "rock", 1500);
    expect(state.phase).toBe("rps");
    expect(openingView(state, 0).myPick).toBe("rock");
    expect(openingView(state, 1).myPick).toBeNull();
    expect(openingView(state, null).myPick).toBeNull();
    expect(openingView(state, 1).picked).toEqual([true, false]);
    // Nothing in the other seat's view tells what seat 0 picked.
    expect(JSON.stringify(openingView(state, 1))).not.toContain("rock");
  });

  it("refuses a second pick in the same round and a pick after the game", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 1, "paper", 10);
    expect(() => submitOpeningPick(state, 1, "rock", 11)).toThrow(DuelOpeningError);
    state = submitOpeningPick(state, 0, "rock", 12);
    expect(state.phase).toBe("choose");
    expect(() => submitOpeningPick(state, 0, "rock", 13)).toThrow(/over/);
  });

  it("replays a tie with a new round and a fresh deadline", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 0, "rock", 100);
    state = submitOpeningPick(state, 1, "rock", 200);
    expect(state.phase).toBe("rps");
    expect(state.round).toBe(2);
    expect(state.picks).toEqual([null, null]);
    expect(state.reveal).toEqual({ round: 1, picks: ["rock", "rock"], winnerSeat: null });
    expect(state.deadline).toBe(200 + DUEL_OPENING_REVEAL_MS + DUEL_OPENING_PICK_MS);
  });

  it("opens the choice for the winner, and only the winner may choose", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 0, "rock", 100);
    state = submitOpeningPick(state, 1, "scissors", 200);
    expect(state.phase).toBe("choose");
    expect(state.winnerSeat).toBe(0);
    expect(() => submitOpeningChoice(state, 1, "first", 300)).toThrow(/Only the winner/);
    const done = submitOpeningChoice(state, 0, "second", 300);
    expect(done.phase).toBe("start");
    expect(done.choice).toBe("second");
    expect(done.choiceByTimeout).toBe(false);
  });

  it("needs a seat swap only when the winner's choice does not match the winner's seat", () => {
    const base = (winnerSeat: 0 | 1, choice: "first" | "second") => {
      let state = newOpening(7, 0);
      state = submitOpeningPick(state, winnerSeat, "rock", 1);
      state = submitOpeningPick(state, winnerSeat === 0 ? 1 : 0, "scissors", 2);
      return submitOpeningChoice(state, winnerSeat, choice, 3);
    };
    expect(openingNeedsSwap(base(0, "first"))).toBe(false);
    expect(openingNeedsSwap(base(0, "second"))).toBe(true);
    expect(openingNeedsSwap(base(1, "first"))).toBe(true);
    expect(openingNeedsSwap(base(1, "second"))).toBe(false);
  });

  it("swaps every seat-indexed field with the seats", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 1, "paper", 1);
    state = submitOpeningPick(state, 0, "rock", 2);
    state = submitOpeningChoice(state, 1, "first", 3);
    const swapped = swapOpeningSeats(state);
    expect(swapped.winnerSeat).toBe(0);
    expect(swapped.reveal).toEqual({ round: 1, picks: ["paper", "rock"], winnerSeat: 0 });
    expect(openingNeedsSwap(swapped)).toBe(false);
  });
});

describe("opening timeouts", () => {
  it("does nothing before the deadline", () => {
    const state = newOpening(7, 0);
    expect(settleOpening(state, DUEL_OPENING_PICK_MS - 1)).toBe(state);
  });

  it("picks at random for a player who did not pick", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 0, "rock", 5);
    // random() = 0.5 picks index 1 (paper) for seat 1, which beats rock.
    const settled = settleOpening(state, DUEL_OPENING_PICK_MS, () => 0.5);
    expect(settled.phase).toBe("choose");
    expect(settled.reveal?.picks).toEqual(["rock", "paper"]);
    expect(settled.winnerSeat).toBe(1);
  });

  it("picks for both players when neither picked, and a tie starts another round", () => {
    const state = newOpening(7, 0);
    const settled = settleOpening(state, DUEL_OPENING_PICK_MS, () => 0);
    expect(settled.round).toBe(2);
    expect(settled.reveal?.winnerSeat).toBeNull();
  });

  it("makes a winner who does not choose go first", () => {
    let state = newOpening(7, 0);
    state = submitOpeningPick(state, 1, "rock", 1);
    state = submitOpeningPick(state, 0, "scissors", 2);
    expect(state.winnerSeat).toBe(1);
    const settled = settleOpening(state, state.deadline);
    expect(settled.phase).toBe("start");
    expect(settled.choice).toBe("first");
    expect(settled.choiceByTimeout).toBe(true);
    expect(openingNeedsSwap(settled)).toBe(true);
  });
});
