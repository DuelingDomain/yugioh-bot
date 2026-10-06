// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { BattleFx } from "@/components/duel/battle-fx";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { coinHeldClock } from "@/components/duel/battle-clock";
import { planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import {
  coinBarrierFor,
  coinLpWaitMs,
  noteCoinLpEvents,
  noteCoinToss,
  releaseCoinBarriers,
  resetCoinBarriers,
  whenCoinBarrierClears,
} from "@/components/duel/coin-barrier";
import { CoinTossFx } from "@/components/duel/coin-toss-fx";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { duelFxClock } from "@/components/duel/fx-clock";
import { clearLpHolds, takeLpHold } from "@/components/duel/life-points";
import { clearPromptRevealHold } from "@/components/duel/prompt-reveal";

const KEY = "coin-barrier";
const zone = (controller: number, location: number, sequence = 0) => ({ controller, location, sequence });
// Jirai Gumo: when it declares an attack, a coin is tossed and called; a wrong call halves the LP of its controller.
const gumo = { code: 94212438, name: "Jirai Gumo", type: 33, attack: 2200, defense: 100, level: 5, race: "Insect", attribute: 1 };
const gaia = { code: 6368038, name: "Gaia The Fierce Knight", type: 17, attack: 2300, defense: 2100, level: 7, race: "Warrior", attribute: 1 };

const phase = { id: 1, kind: "phase", text: "battle" } as unknown as DuelEvent;
const attack = { id: 2, kind: "attack", seat: 0, text: "attack", card: gumo, zone: zone(0, 4), target: zone(1, 4) } as unknown as DuelEvent;
const declared = [phase, attack];
/** The attack, the coin it calls (wrong), the halved LP, then the fight (Gaia is hurt for 100). */
const full = (): DuelEvent[] => [
  ...declared,
  { id: 3, kind: "activate", text: "a", card: gumo, zone: zone(0, 4), chainIndex: 1 },
  { id: 4, kind: "chain-resolving", text: "r", card: gumo, chainIndex: 1 },
  { id: 5, kind: "toss", text: "Coin toss", seat: 0, toss: { type: "coin", results: ["tails"] }, card: gumo },
  { id: 6, kind: "damage", seat: 0, amount: 4000, cause: "effect", text: "halve" },
  { id: 7, kind: "damage", seat: 1, amount: 100, cause: "battle", text: "" },
  { id: 8, kind: "chain-resolved", text: "r", chainIndex: 1 },
  { id: 9, kind: "chain-end", text: "end" },
] as unknown as DuelEvent[];

const seats = [
  { seat: 0, monsters: [{ controller: 0, location: 4, sequence: 0, position: 1, ...gumo }] },
  { seat: 1, monsters: [{ controller: 1, location: 4, sequence: 0, position: 1, ...gaia }] },
] as unknown as DuelSeatView[];

/** What the chain layer does in the render pass: the beats are planned, then the toss is noted. */
const noteToss = () => {
  planChainBeats(full(), { now: duelFxClock.now(), reduced: false, duelKey: KEY });
  noteCoinToss(full()[4], full(), false);
};

const playLayer = () => document.body.querySelector("[data-style]");

describe("coin barrier", () => {
  let board: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    resetCoinBarriers();
    resetCoinTossState();
    resetChainBeats(KEY);
    clearPromptRevealHold();
    clearBattleHolds();
    clearLpHolds();
    board = document.createElement("div");
    board.innerHTML = `
      <div data-zones="0:4:0"><div data-card-art></div></div>
      <div data-zones="1:4:0"><div data-card-art></div></div>
      ${[0, 1].map((seat) => `<div data-lp-seat="${seat}" data-side="${seat === 0 ? "you" : "opp"}"><strong>8000</strong></div>`).join("")}`;
    document.body.appendChild(board);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const z = this.closest("[data-zones]")?.getAttribute("data-zones");
      return ((z === "0:4:0" ? { left: 100, top: 400, width: 60, height: 88 } : z === "1:4:0" ? { left: 100, top: 100, width: 60, height: 88 } : { left: 0, top: 0, width: 60, height: 20 })) as DOMRect;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    board.remove();
    resetCoinBarriers();
    resetCoinTossState();
    vi.useRealTimers();
  });

  const mountBoth = () => {
    const tree = (events: DuelEvent[]) => (
      <>
        <CoinTossFx events={events} duelKey={KEY} reducedMotion={false} />
        <BattleFx events={events} reducedMotion={false} seats={seats} />
      </>
    );
    const view = render(tree([phase]));
    return {
      send: (events: DuelEvent[]) => {
        // The chain layer plans its beats in the render phase, before the coin layer and the battle layer run.
        planChainBeats(events, { now: duelFxClock.now(), reduced: false, duelKey: KEY });
        act(() => { view.rerender(tree(events)); });
      },
    };
  };

  it("holds the battle of Jirai Gumo until the coin result is gone, then plays it", () => {
    const { send } = mountBoth();
    send(declared);
    expect(playLayer()).toBeNull();
    send(full());
    const end = coinBarrierFor(7);
    // The coin plan is real: it lasts longer than the picture of one coin, and it starts after the chain beat.
    expect(end - duelFxClock.now()).toBeGreaterThan(1500);
    // The LP counter of the defender reads its hold when the snapshot lands: it waits for the coin AND the strike.
    expect(takeLpHold(1)).toBeGreaterThan(end - duelFxClock.now());
    // Behind the coin, nothing of the fight shows: no strike, no break, no LP roll.
    act(() => { vi.advanceTimersByTime(end - duelFxClock.now() - 200); });
    expect(playLayer()).toBeNull();
    // The coin is over: the strike plays, and the LP roll of the battle waits for the strike.
    act(() => { vi.advanceTimersByTime(400); });
    expect(playLayer()).not.toBeNull();
  });

  it("holds the LP roll of the halved life behind the coin", () => {
    const { send } = mountBoth();
    send(declared);
    send(full());
    const wait = coinLpWaitMs(0);
    expect(wait).toBeGreaterThan(1500);
    // The note is taken once: a later roll of the same seat is not held again.
    expect(coinLpWaitMs(0)).toBe(0);
  });

  it("starts the battle at once when no coin was tossed", () => {
    const { send } = mountBoth();
    send(declared);
    send([...declared, { id: 3, kind: "damage", seat: 1, amount: 100, cause: "battle", text: "" } as unknown as DuelEvent]);
    expect(playLayer()).not.toBeNull();
  });

  it("lets the battle go when the coin picture ends early or fails", () => {
    noteToss();
    const fn = vi.fn();
    whenCoinBarrierClears(7, fn);
    expect(coinBarrierFor(7)).toBeGreaterThan(0);
    expect(fn).not.toHaveBeenCalled();
    releaseCoinBarriers();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(coinBarrierFor(7)).toBe(0);
  });

  it("holds the strike for at most the plan, even when no picture releases it", () => {
    noteToss();
    const fn = vi.fn();
    whenCoinBarrierClears(7, fn);
    const end = coinBarrierFor(7);
    act(() => { vi.advanceTimersByTime(end - duelFxClock.now() + 50); });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not hold an event that comes before the toss", () => {
    noteToss();
    expect(coinBarrierFor(4)).toBe(0);
    expect(coinBarrierFor(5)).toBe(0);
    expect(coinBarrierFor(6)).toBeGreaterThan(0);
  });

  it("gives a battle clock that reads the coin end lazily, never earlier than its stamp", () => {
    const t0 = duelFxClock.now();
    const clock = coinHeldClock(t0, 7);
    expect(clock.startedAt).toBe(t0);
    noteToss();
    expect(clock.startedAt).toBeGreaterThan(t0 + 1500);
    expect(coinHeldClock(t0, null).startedAt).toBe(t0);
  });

  it("leaves the replay (passive) alone: it takes no part in the barrier", () => {
    const events = full();
    const view = render(<CoinTossFx events={[]} duelKey={KEY} reducedMotion={false} passive />);
    planChainBeats(events, { now: duelFxClock.now(), reduced: false, duelKey: KEY });
    act(() => { view.rerender(<CoinTossFx events={events} duelKey={KEY} reducedMotion={false} passive />); });
    expect(coinBarrierFor(7)).toBe(0);
    expect(coinLpWaitMs(0)).toBe(0);
  });

  it("keeps notes for LP changes of another seat apart", () => {
    noteToss();
    noteCoinLpEvents(full().filter((event) => event.kind === "damage"));
    expect(coinLpWaitMs(1)).toBeGreaterThan(0);
    expect(coinLpWaitMs(0)).toBeGreaterThan(0);
  });
});
