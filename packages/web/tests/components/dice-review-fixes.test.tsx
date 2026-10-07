// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelDiceOpeningView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DiceOpeningScreen } from "@/components/duel/dice-opening";
import { DEFAULT_DICE_SKIN, setDiceSkin } from "@/components/duel/dice-skins";
import { useNow } from "@/components/duel/opening-clock";

const NAMES = ["Mira", "Dax", "Rin", "Kade"];
const animate = vi.fn(() => ({ cancel: vi.fn(), finish: vi.fn(), onfinish: null }));

beforeEach(() => {
  window.localStorage.clear();
  act(() => setDiceSkin(DEFAULT_DICE_SKIN));
  animate.mockClear();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

function diceView(rounds: Array<Array<number | null>>, over: { elapsed?: number; order?: number[] | null; serverNow?: number } = {}): DuelDiceOpeningView {
  const serverNow = over.serverNow ?? 1_000_000;
  const order = over.order ?? null;
  return {
    phase: "dice", round: rounds.length, serverNow, deadlineAt: new Date(serverNow + 3000 - (over.elapsed ?? 0)).toISOString(),
    rounds: rounds.map((rolls, index) => ({ round: index + 1, rolls })), order,
    finalSeats: order ? order.map((_, lobby) => order.indexOf(lobby)) : null,
  };
}

const screenFor = (opening: DuelDiceOpeningView, mySeat: number | null = 0, receivedAt = performance.now()) => (
  <DiceOpeningScreen opening={opening} receivedAt={receivedAt} mySeat={mySeat} names={NAMES.slice(0, opening.rounds[0]!.rolls.length)} />
);

describe("dice opening: a re-roll round on the same mount", () => {
  it("throws the re-rolled dice again", () => {
    // Round 1 arrives at t=0; round 2 arrives 3 s later, by which time round 1's clock says "landed".
    let t = 50_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => t);
    const { rerender } = render(screenFor(diceView([[5, 3, 5]], { elapsed: 0 }), 0, t));
    const first = animate.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    animate.mockClear();
    t += 3000;
    rerender(screenFor(diceView([[5, 3, 5], [2, null, 2]], { elapsed: 0, serverNow: 1_003_000 }), 0, t));
    clock.mockRestore();
    // Dice 0 and 2 are thrown again; the kept die 1 is not.
    expect(animate.mock.calls.length).toBeGreaterThan(0);
    expect(animate.mock.calls.length).toBeLessThan(first);
  });
});

describe("opening clock: a remount from a cached room", () => {
  it("starts at the sampled server time, not at the old serverNow", () => {
    const seen: Array<number | null> = [];
    function Probe({ opening, receivedAt }: { opening: DuelDiceOpeningView; receivedAt: number }) {
      seen.push(useNow(opening, receivedAt, 100));
      return null;
    }
    const view = diceView([[4, 6, 2]]);
    render(<Probe opening={view} receivedAt={performance.now() - 2400} />);
    expect(seen[0]).toBeGreaterThanOrEqual(1_000_000 + 2400);
  });
});

describe("dice opening: tie in the last round", () => {
  it("says the tie is broken at random, not rolled again", () => {
    const rounds = Array.from({ length: 10 }, () => [4, 4, 4, 2] as Array<number | null>);
    render(screenFor(diceView(rounds, { elapsed: 2400 })));
    expect(screen.getByTestId("dice-status").textContent).toContain("Tie broken at random");
    expect(screen.getByTestId("dice-status").textContent).not.toContain("roll again");
  });

  it("still says roll again before the last round", () => {
    const rounds = Array.from({ length: 9 }, () => [4, 4, 4, 2] as Array<number | null>);
    render(screenFor(diceView(rounds, { elapsed: 2400 })));
    expect(screen.getByTestId("dice-status").textContent).toContain("Tie — roll again");
  });
});

describe("dice opening: screen readers", () => {
  it("announces the rolls of the round and the tie", () => {
    render(screenFor(diceView([[4, 6, 4]], { elapsed: 2400 })));
    const live = screen.getByTestId("dice-live");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Round 1: You 4, Dax 6, Rin 4.");
    expect(live.textContent).toContain("Tie — roll again");
    expect(screen.getByTestId("dice-status").getAttribute("aria-live")).toBeNull();
  });

  it("lists only the seats that rolled again", () => {
    render(screenFor(diceView([[5, 3, 5], [2, null, 6]], { elapsed: 2400 })));
    expect(screen.getByTestId("dice-live").textContent).toContain("Round 2: You 2, Rin 6.");
  });

  it("keeps the turn order in the live text and the seat line out of it", () => {
    render(screenFor(diceView([[3, 6, 1, 4]], { elapsed: 2700, order: [1, 3, 0, 2] })));
    const live = screen.getByTestId("dice-live").textContent;
    expect(live).toContain("Dax goes first. Turn order: Dax → Kade → You → Rin");
    expect(live).not.toContain("You face");
    expect(screen.getByTestId("dice-status").textContent).toContain("You face");
  });
});
