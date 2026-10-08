// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelDiceOpeningView, DuelOpeningView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { OpeningScreen } from "@/components/duel/opening";
import { DEFAULT_DICE_SKIN, setDiceSkin } from "@/components/duel/dice-skins";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { window.localStorage.clear(); act(() => setDiceSkin(DEFAULT_DICE_SKIN)); });

const NAMES = ["Mira", "Dax", "Rin", "Kade"];

/** A dice view whose round started `elapsed` ms ago by the server clock. */
function diceView(rounds: Array<Array<number | null>>, over: { elapsed?: number; order?: number[] | null; phase?: "dice" | "start" } = {}): DuelDiceOpeningView {
  const serverNow = 1_000_000;
  const order = over.order ?? null;
  return {
    phase: over.phase ?? "dice", round: rounds.length, serverNow, deadlineAt: new Date(serverNow + 3000 - (over.elapsed ?? 0)).toISOString(),
    rounds: rounds.map((rolls, index) => ({ round: index + 1, rolls })), order,
    finalSeats: order ? order.map((_, lobby) => order.indexOf(lobby)) : null,
  };
}

function show(opening: DuelDiceOpeningView, extra: { mySeat?: number | null; names?: string[]; reducedMotion?: boolean } = {}) {
  const props = {
    opening: opening as DuelOpeningView, receivedAt: performance.now(), mySeat: extra.mySeat === undefined ? 0 : extra.mySeat,
    names: extra.names ?? NAMES.slice(0, opening.rounds[0]?.rolls.length ?? 3), reducedMotion: extra.reducedMotion,
    onPick: vi.fn(), onChoose: vi.fn(),
  };
  return { ...render(<OpeningScreen {...props} />), props };
}

const tile = (seat: number) => screen.getByTestId(`dice-tile-${seat}`);
const status = () => screen.getByTestId("dice-status").textContent;

describe("dice opening: rolling", () => {
  it("draws one tile and die per player with no RPS controls", () => {
    const { props } = show(diceView([[4, 6, 2]], { elapsed: 200 }));
    expect(screen.getByTestId("opening-screen").getAttribute("data-kind")).toBe("dice");
    expect(screen.getAllByTestId("dice-die")).toHaveLength(3);
    expect(screen.getByTestId("dice-row").getAttribute("data-n")).toBe("3");
    expect(screen.getByRole("heading", { name: "Who goes first?" })).toBeTruthy();
    expect(status()).toContain("Rolling…");
    expect(status()).toContain("Everyone rolls at once");
    expect(screen.getByTestId("dice-sub").textContent).toBe("3-way · Round 1");
    expect(tile(1).getAttribute("data-state")).toBe("rolling");
    expect(screen.queryByTestId("opening-move-rock")).toBeNull();
    expect(screen.queryByTestId("opening-first")).toBeNull();
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it("shows the face of each roll and marks the viewer", () => {
    show(diceView([[4, 6, 2]], { elapsed: 200 }));
    expect(screen.getAllByTestId("dice-die").map((die) => die.getAttribute("data-value"))).toEqual(["4", "6", "2"]);
    expect(tile(0).getAttribute("data-me")).toBe("true");
    expect(within(tile(0)).getByText("You")).toBeTruthy();
    expect(within(tile(1)).queryByText("You")).toBeNull();
  });

  it("gives every face the right number of pips", () => {
    show(diceView([[6, 1, 3]], { elapsed: 200 }));
    const die = screen.getAllByTestId("dice-die")[0]!;
    expect(die.querySelectorAll("[data-on=true]")).toHaveLength(1 + 2 + 3 + 4 + 5 + 6);
  });
});

describe("dice opening: ties", () => {
  it("pulses the tied tiles, names them and keeps the rest", () => {
    show(diceView([[5, 3, 5]], { elapsed: 2400 }), { mySeat: 2 });
    expect(tile(0).getAttribute("data-state")).toBe("tied");
    expect(tile(2).getAttribute("data-state")).toBe("tied");
    expect(tile(1).getAttribute("data-state")).toBe("kept");
    expect(within(tile(0)).getByText("Tie")).toBeTruthy();
    expect(status()).toContain("Tie — roll again");
    expect(status()).toContain("You and Mira tied on 5");
    expect(screen.getByTestId("dice-sub").textContent).toBe("3-way · Round 1");
  });

  it("shows a 4-way double tie as two groups", () => {
    show(diceView([[5, 2, 5, 2]], { elapsed: 2400 }));
    expect(status()).toContain("You and Rin tied on 5 · Dax and Kade tied on 2");
    expect(screen.getAllByText("Tie")).toHaveLength(4);
  });

  it("rolls only the tied players in the next round", () => {
    show(diceView([[5, 3, 5], [2, null, 2]], { elapsed: 2050 }));
    expect(screen.getByTestId("dice-sub").textContent).toBe("3-way · Round 2 · tied players only");
    expect(tile(1).getAttribute("data-state")).toBe("kept");
    expect(within(tile(1)).getByText("Keeps 3")).toBeTruthy();
    expect(within(tile(0)).getByText("Rolled 2")).toBeTruthy();
    expect(within(tile(0)).getByText("was 5")).toBeTruthy();
    expect(status()).toContain("Rolling again…");
  });
});

describe("dice opening: order and seats", () => {
  it("names the first player and ranks every tile, then moves the 3-way tiles to the new order", () => {
    show(diceView([[4, 6, 2]], { elapsed: 2200, order: [1, 0, 2] }));
    expect(status()).toContain("Dax goes first");
    expect(status()).toContain("Turn order: Dax → You → Rin");
    expect(within(tile(1)).getByText("1st")).toBeTruthy();
    expect(within(tile(0)).getByText("2nd")).toBeTruthy();
    expect(tile(1).getAttribute("data-first")).toBeNull();
    cleanup();
    show(diceView([[4, 6, 2]], { elapsed: 2700, order: [1, 0, 2] }));
    expect(status()).toContain("Seats follow the turn order");
    expect(tile(1).getAttribute("data-first")).toBe("true");
    expect(tile(1).style.order).toBe("0");
    expect(tile(0).style.order).toBe("1");
    expect(screen.getByTestId("dice-sub").textContent).toBe("3-way · Seats in turn order");
  });

  it("shows the 4-way facing brackets and the 'You face' line after the move", () => {
    show(diceView([[3, 6, 1, 4]], { elapsed: 2700, order: [1, 3, 0, 2] }));
    expect(screen.getByTestId("dice-pairs").getAttribute("data-on")).toBe("true");
    expect(status()).toContain("You face Rin");
    expect(tile(2).getAttribute("data-face")).toBe("true");
    expect(tile(1).getAttribute("data-face")).toBeNull();
  });

  it("keeps the brackets hidden until the move", () => {
    show(diceView([[3, 6, 1, 4]], { elapsed: 2200, order: [1, 3, 0, 2] }));
    expect(screen.getByTestId("dice-pairs").getAttribute("data-on")).toBe("false");
    expect(status()).toContain("Turn order:");
  });

  it("reads the start phase with the new seats: names and viewer by public seat", () => {
    // Lobby seat 1 won, so it sits in public seat 0. The room now reports names by public seat and my seat 1 = lobby seat 0.
    const start = diceView([[4, 6, 2]], { order: [1, 0, 2], phase: "start" });
    show(start, { mySeat: 1, names: ["Dax", "Mira", "Rin"] });
    expect(screen.getByTestId("opening-screen").getAttribute("data-stage")).toBe("start");
    expect(tile(0).getAttribute("data-me")).toBe("true");
    expect(within(tile(0)).getByText("Mira")).toBeTruthy();
    expect(within(tile(1)).getByText("Dax")).toBeTruthy();
    expect(status()).toContain("Dax goes first");
    expect(status()).toContain("Seats follow the turn order");
    expect(tile(1).style.order).toBe("0");
  });

  it("labels each tile for screen readers with the seat move", () => {
    show(diceView([[4, 6, 2]], { elapsed: 2700, order: [1, 0, 2] }));
    expect(tile(0).getAttribute("aria-label")).toBe("Mira (you), rolled 4, 2nd, moves to seat 2");
    expect(tile(2).getAttribute("aria-label")).toBe("Rin, rolled 2, 3rd, stays in seat 3");
  });
});

describe("dice opening: spectator", () => {
  it("shows no You tag and says who is watching", () => {
    show(diceView([[3, 6, 3, 5]], { elapsed: 2400 }), { mySeat: null });
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.getByTestId("dice-sub").textContent).toBe("4-way · You are watching · Round 1");
    expect(status()).toContain("Mira and Rin tied on 3");
  });

  it("names both facing pairs after the move", () => {
    show(diceView([[3, 6, 2, 5]], { elapsed: 2700, order: [1, 3, 0, 2] }), { mySeat: null });
    expect(status()).toContain("Dax faces Kade · Mira faces Rin");
    expect(document.querySelector("[data-face=true]")).toBeNull();
  });
});

describe("dice opening: random tie-break", () => {
  it("shows the short line next to the tied rolls", () => {
    const rounds = Array.from({ length: 10 }, () => [4, 4, 4, 2]);
    show(diceView(rounds, { order: [2, 0, 1, 3], phase: "start" }), { names: ["Rin", "Mira", "Dax", "Kade"], mySeat: 1 });
    expect(status()).toContain("Tie broken at random");
    expect(within(tile(2)).getByText("1st")).toBeTruthy();
  });

  it("does not show it after a normal order", () => {
    show(diceView([[4, 6, 2]], { elapsed: 2700, order: [1, 0, 2] }));
    expect(status()).not.toContain("random");
  });
});

describe("dice opening: skins and motion", () => {
  it("draws every die in the saved skin, gold by default", () => {
    const { unmount } = show(diceView([[4, 6, 2]], { elapsed: 200 }));
    expect(screen.getAllByTestId("dice-die").every((die) => die.getAttribute("data-skin") === "gold")).toBe(true);
    unmount();
    act(() => setDiceSkin("cardback"));
    show(diceView([[4, 6, 2]], { elapsed: 200 }));
    expect(screen.getAllByTestId("dice-die").every((die) => die.getAttribute("data-skin") === "cardback")).toBe(true);
    act(() => setDiceSkin("crest"));
    expect(screen.getAllByTestId("dice-die").every((die) => die.getAttribute("data-skin") === "crest")).toBe(true);
  });

  it("uses the short reduced-motion timeline", () => {
    // 800 ms is past the reduced tie beat (700 ms) but before the full one (2100 ms).
    show(diceView([[5, 3, 5]], { elapsed: 800 }), { reducedMotion: true });
    expect(screen.getByTestId("opening-screen").getAttribute("data-reduced")).toBe("true");
    expect(tile(0).getAttribute("data-state")).toBe("tied");
    expect(screen.getAllByTestId("dice-die")[0]!.getAttribute("data-reduced")).toBe("true");
    cleanup();
    show(diceView([[5, 3, 5]], { elapsed: 800 }));
    expect(tile(0).getAttribute("data-state")).not.toBe("tied");
  });

  it("follows the server clock as it ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const view = diceView([[5, 3, 5]], { elapsed: 1500 });
    render(<OpeningScreen opening={view} receivedAt={performance.now()} mySeat={0} names={NAMES.slice(0, 3)} onPick={vi.fn()} onChoose={vi.fn()} />);
    expect(tile(0).getAttribute("data-state")).not.toBe("tied");
    act(() => { vi.advanceTimersByTime(800); });
    expect(tile(0).getAttribute("data-state")).toBe("tied");
  });

  it("shows an error from the room", () => {
    const view = diceView([[4, 6, 2]], { elapsed: 200 });
    render(<OpeningScreen opening={view} mySeat={0} names={NAMES.slice(0, 3)} error="Could not load" onPick={vi.fn()} onChoose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not load");
  });
});
