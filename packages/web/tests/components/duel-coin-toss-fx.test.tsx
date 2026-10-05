// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { CoinTossFx } from "@/components/duel/coin-toss-fx";
import { MatchSheetLog } from "@/components/duel/log-line";
import { isCoinTossActive, resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { COIN_TIMING } from "@/components/duel/coin-plan";
import { clearPromptRevealHold, promptRevealHoldMs } from "@/components/duel/prompt-reveal";
import { duelFxClock } from "@/components/duel/fx-clock";

const FLIP_LAND = COIN_TIMING.fadeInMs + 1500; // the first coin lands this long after it starts
const STEP = FLIP_LAND + COIN_TIMING.holdMs + COIN_TIMING.outroMs;

function toss(id: number, results: Array<"heads" | "tails">): DuelEvent {
  return { id, kind: "toss", seat: 0, text: "Coin toss", toss: { type: "coin", results },
    card: { code: 10, name: "Barrel Dragon" } } as unknown as DuelEvent;
}
const other = (id: number): DuelEvent => ({ id, kind: "info", text: "x" } as unknown as DuelEvent);

const live = () => screen.getByTestId("coin-toss-live").textContent;
const cover = () => document.body.querySelector('[data-testid="coin-toss"]');
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function Harness({ events, reduced = false, passive = false, skipThrough = null }: {
  events: DuelEvent[]; reduced?: boolean; passive?: boolean; skipThrough?: number | null;
}) {
  const log = events.filter((event) => event.kind === "toss").map((event) => ({ id: event.id, text: "Barrel Dragon tossed", eventId: event.id }));
  return (
    <div>
      <button type="button" data-testid="menu-button" onClick={() => (window as unknown as { clicked: number }).clicked++}>Menu</button>
      <div data-testid="open-menu" role="menu">Open card menu</div>
      <MatchSheetLog entries={[{ id: 1, text: "Turn 1" }, ...log]} playerName={() => "P"} players="A v B" />
      <CoinTossFx events={events} duelKey="duel-1" reducedMotion={reduced} passive={passive} skipThrough={skipThrough} />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  (window as unknown as { clicked: number }).clicked = 0;
  resetCoinTossState();
  clearPromptRevealHold();
});
afterEach(() => {
  cleanup();
  duelFxClock.setReviewSpeed(null);
  duelFxClock.setReducedMotion(false);
  resetCoinTossState();
  vi.useRealTimers();
});

describe("CoinTossFx", () => {
  it("shows nothing and locks nothing for events that were there at mount (resync, reload)", () => {
    render(<Harness events={[other(1), toss(2, ["heads", "tails"])]} />);
    advance(500);
    expect(cover()).toBeNull();
    expect(isCoinTossActive()).toBe(false);
    expect(screen.getByRole("list", { name: "Duel log" }).textContent).toContain("Barrel Dragon tossed");
  });

  it("does not replay old tosses when events up to skipThrough arrive late", () => {
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(5, ["heads"])]} skipThrough={5} />);
    advance(500);
    expect(cover()).toBeNull();
    expect(isCoinTossActive()).toBe(false);
  });

  it("plays a 3-toss sequence in order, each result only after its coin has landed", () => {
    const { rerender } = render(<Harness events={[other(1)]} />);
    rerender(<Harness events={[other(1), toss(2, ["heads", "tails", "heads"])]} />);
    expect(isCoinTossActive()).toBe(true);
    // The cover is a direct child of the page, not inside the duel tree.
    advance(100);
    expect(cover()?.parentElement).toBe(document.body);
    const seen: Array<[number, string]> = [];
    let last = live();
    for (let t = 100; t < 3 * STEP + 2500; t += 50) {
      advance(50);
      if (live() !== last) { last = live(); if (last) seen.push([t + 50, last]); }
    }
    expect(seen.map(([, text]) => text)).toEqual(["Toss 1: Heads", "Toss 2: Tails", "Toss 3: Heads", "Result: Heads, Tails, Heads"]);
    // Nothing is read out before the first coin lands, and each next result comes a full toss later.
    expect(seen[0][0]).toBeGreaterThanOrEqual(FLIP_LAND);
    expect(seen[0][0]).toBeLessThan(FLIP_LAND + 200);
    expect(seen[1][0] - seen[0][0]).toBeGreaterThanOrEqual(STEP - 60);
    expect(seen[2][0] - seen[1][0]).toBeGreaterThanOrEqual(STEP - 60);
    expect(cover()).toBeNull();
    expect(isCoinTossActive()).toBe(false);
  });

  it("hides the log line until the last coin has landed, then shows it", () => {
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["heads", "tails"])]} />);
    const log = () => screen.getByRole("list", { name: "Duel log" }).textContent ?? "";
    expect(log()).not.toContain("Barrel Dragon tossed");
    advance(FLIP_LAND + 100); // coin 1 landed, coin 2 not yet
    expect(log()).not.toContain("Barrel Dragon tossed");
    advance(STEP); // coin 2 lands
    expect(log()).toContain("Barrel Dragon tossed");
    expect(log()).toContain("Turn 1");
  });

  it("blocks clicks and keys while it plays, keeps an open menu, and works again after", () => {
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["tails"])]} />);
    advance(300);
    fireEvent.click(screen.getByTestId("menu-button"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: " " });
    expect((window as unknown as { clicked: number }).clicked).toBe(0);
    expect(onKey).not.toHaveBeenCalled();
    // The menu that was open is still there, untouched.
    expect(screen.getByTestId("open-menu").textContent).toBe("Open card menu");
    advance(STEP + 500);
    expect(isCoinTossActive()).toBe(false);
    fireEvent.click(screen.getByTestId("menu-button"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect((window as unknown as { clicked: number }).clicked).toBe(1);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("open-menu")).toBeTruthy();
    window.removeEventListener("keydown", onKey);
  });

  it("holds the next prompt until the toss has ended", () => {
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["heads", "tails"])]} />);
    expect(promptRevealHoldMs()).toBeGreaterThan(2 * STEP - 100);
  });

  it("reduced motion: fades to the face, the same 1.2 s hold, input still blocked", () => {
    const { rerender } = render(<Harness events={[]} reduced />);
    rerender(<Harness events={[toss(2, ["tails"])]} reduced />);
    advance(100);
    expect(cover()?.getAttribute("data-rm")).toBe("true");
    expect(live()).toBe("");
    advance(COIN_TIMING.reducedFadeMs + 50);
    expect(live()).toBe("Tails");
    advance(COIN_TIMING.holdMs - 300);
    expect(isCoinTossActive()).toBe(true);
    fireEvent.click(screen.getByTestId("menu-button"));
    expect((window as unknown as { clicked: number }).clicked).toBe(0);
    advance(300 + COIN_TIMING.outroMs + 100);
    expect(isCoinTossActive()).toBe(false);
  });

  it("follows the FX speed: half speed takes twice as long", () => {
    duelFxClock.setReviewSpeed(0.5);
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["heads"])]} />);
    advance(FLIP_LAND + 200);
    expect(live()).toBe("");
    advance(FLIP_LAND + 200);
    expect(live()).toBe("Heads");
    advance(2 * (COIN_TIMING.holdMs + COIN_TIMING.outroMs) + 400);
    expect(isCoinTossActive()).toBe(false);
  });

  it("safety: when the picture cannot run, the lock is released after the plan plus a margin", () => {
    vi.spyOn(duelFxClock, "requestAnimationFrame").mockReturnValue(1);
    const { rerender } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["heads"])]} />);
    expect(isCoinTossActive()).toBe(true);
    advance(STEP);
    expect(isCoinTossActive()).toBe(true);
    advance(COIN_TIMING.safetyMarginMs + 200);
    expect(isCoinTossActive()).toBe(false);
    vi.restoreAllMocks();
  });

  it("passive (replay): the coin plays but nothing is locked and the cover takes no pointer", () => {
    const { rerender } = render(<Harness events={[]} passive />);
    rerender(<Harness events={[toss(2, ["heads"])]} passive />);
    advance(300);
    expect(cover()?.getAttribute("data-passive")).toBe("true");
    expect(isCoinTossActive()).toBe(false);
    fireEvent.click(screen.getByTestId("menu-button"));
    expect((window as unknown as { clicked: number }).clicked).toBe(1);
    advance(FLIP_LAND);
    expect(live()).toBe("Heads");
  });

  it("gives everything back when it unmounts mid toss", () => {
    const { rerender, unmount } = render(<Harness events={[]} />);
    rerender(<Harness events={[toss(2, ["heads"])]} />);
    expect(isCoinTossActive()).toBe(true);
    unmount();
    expect(isCoinTossActive()).toBe(false);
    expect(cover()).toBeNull();
  });
});
