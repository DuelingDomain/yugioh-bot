import { describe, expect, it } from "vitest";
import { DUEL_OPENING_PICK_MS, type DuelRpsOpeningView } from "@yugidraft/shared/duels";
import {
  myPickText, openingStage, opponentPickText, revealEndsAt, revealOutcome, startText, waitChooseText,
} from "../src/components/duel/opening-model";

const NOW = 1_000_000;
const NAMES: [string, string] = ["Yugi", "Kaiba"];

function view(overrides: Partial<DuelRpsOpeningView> = {}): DuelRpsOpeningView {
  return {
    serverNow: NOW,
    phase: "rps", round: 1, deadlineAt: new Date(NOW + DUEL_OPENING_PICK_MS).toISOString(), picked: [false, false],
    myPick: null, reveal: null, winnerSeat: null, choice: null, choiceByTimeout: false, ...overrides,
  };
}

describe("openingStage", () => {
  it("asks for a pick in round 1", () => {
    expect(openingStage(view(), 0, NOW)).toBe("pick");
  });

  it("shows the choice for the winner and the wait for the loser as soon as the server decides the round", () => {
    const won = view({
      phase: "choose", winnerSeat: 0, picked: [true, true],
      deadlineAt: new Date(NOW + 3_000 + DUEL_OPENING_PICK_MS).toISOString(),
      reveal: { round: 1, picks: ["paper", "rock"], winnerSeat: 0 },
    });
    expect(revealEndsAt(won)).toBe(NOW + 3_000);
    expect(openingStage(won, 0, NOW)).toBe("choose");
    expect(openingStage(won, 1, NOW)).toBe("wait-choose");
    // A clock one minute slow used to hide the buttons for the entire server choice window.
    expect(openingStage(won, 0, NOW - 60_000)).toBe("choose");
    expect(openingStage(won, 0, NOW + 33_000 - 60_000)).toBe("choose");
    expect(openingStage(won, 0, NOW + 3_001)).toBe("choose");
    expect(openingStage(won, 1, NOW + 3_001)).toBe("wait-choose");
    // A spectator never chooses.
    expect(openingStage(won, null, NOW + 3_001)).toBe("wait-choose");
  });

  it("shows a tie, then the next round", () => {
    const tie = view({
      round: 2, deadlineAt: new Date(NOW + 3_000 + DUEL_OPENING_PICK_MS).toISOString(),
      reveal: { round: 1, picks: ["rock", "rock"], winnerSeat: null },
    });
    expect(openingStage(tie, 0, NOW)).toBe("reveal");
    expect(openingStage(tie, 0, NOW + 3_500)).toBe("pick");
  });

  it("does not replay an old reveal in a later round", () => {
    const later = view({ round: 3, reveal: { round: 1, picks: ["rock", "rock"], winnerSeat: null } });
    expect(openingStage(later, 0, NOW)).toBe("pick");
  });

  it("is in the start stage once the order is settled", () => {
    expect(openingStage(view({ phase: "start", winnerSeat: 0, choice: "first" }), 0, NOW)).toBe("start");
  });
});

describe("reveal outcomes", () => {
  const win = view({ reveal: { round: 1, picks: ["paper", "rock"], winnerSeat: 0 } });
  it("identifies a win, a loss, a tie or a spectator's result", () => {
    expect(revealOutcome(win, 0)).toBe("win");
    expect(revealOutcome(win, 1)).toBe("lose");
    expect(revealOutcome(view({ reveal: { round: 1, picks: ["rock", "rock"], winnerSeat: null } }), 0)).toBe("tie");
    expect(revealOutcome(win, null)).toBe("decided");
    expect(revealOutcome(view(), 0)).toBeNull();
  });
});

describe("state chips", () => {
  it("shows what the opponent did without showing the move", () => {
    expect(opponentPickText(view(), 0, "Kaiba")).toEqual({ text: "Opponent is choosing…", done: false });
    expect(opponentPickText(view({ picked: [false, true] }), 0, "Kaiba")).toEqual({ text: "Opponent chose", done: true });
    expect(opponentPickText(view({ picked: [true, false] }), 1, "Yugi")).toEqual({ text: "Opponent chose", done: true });
  });

  it("shows the player's own state, and nothing for a spectator", () => {
    expect(myPickText(view(), 0)).toEqual({ text: "Choose your move", done: false });
    expect(myPickText(view({ picked: [true, false] }), 0)).toEqual({ text: "You chose", done: true });
    expect(myPickText(view(), null)).toBeNull();
  });

  it("tells the loser that the opponent chooses first or second", () => {
    expect(waitChooseText(view({ phase: "choose", winnerSeat: 1 }), 0, NAMES)).toBe("Opponent is choosing to go first or second…");
    expect(waitChooseText(view({ phase: "choose", winnerSeat: 1 }), null, NAMES)).toBe("Kaiba is choosing to go first or second…");
  });

  it("tells who goes first, and when time ran out", () => {
    const base = view({ phase: "start", winnerSeat: 0, choice: "second" });
    expect(startText(base, 0, NAMES)).toBe("You choose to go second");
    expect(startText(base, 1, NAMES)).toBe("Opponent chooses to go second");
    expect(startText({ ...base, choice: "first", choiceByTimeout: true }, 0, NAMES)).toBe("You choose to go first (time ran out)");
    expect(startText(base, null, NAMES)).toBe("Yugi chooses to go second");
  });
});
