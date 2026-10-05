// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { CoinTossFx } from "@/components/duel/coin-toss-fx";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { COIN_TIMING } from "@/components/duel/coin-plan";
import { chainBeatAt, planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { clearPromptRevealHold } from "@/components/duel/prompt-reveal";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { duelFxClock } from "@/components/duel/fx-clock";
import { CARDS as C } from "@/components/duel/fx-lab/cards";

const zone = (controller: number, location: number, sequence = 0) => ({ controller, location, sequence });
const geometry = () => ({ distance: 300 });
const KEY = "coin-order";
const options = (now: number) => ({ now, reduced: false, duelKey: KEY, geometry });

// Barrel Dragon: its effect resolves, the coin is tossed (2 heads), the target breaks, then the move to the grave.
const batch = (): DuelEvent[] => {
  const why = { cause: "effect" as const, sourceKind: "monster" as const, sourceCode: C.celtic.code, sourceSeat: 0 };
  return [
    { id: 1, kind: "activate", text: "a", card: C.celtic, zone: zone(0, 4), chainIndex: 1 },
    { id: 2, kind: "chain-resolving", text: "r", card: C.celtic, chainIndex: 1 },
    { id: 3, kind: "toss", text: "Coin toss", seat: 0, toss: { type: "coin", results: ["heads", "heads"] }, card: C.celtic },
    { id: 4, kind: "move", text: "destroy", card: C.kuriboh, from: zone(1, 4), zone: zone(1, 16), reason: "destroy", ...why },
    { id: 5, kind: "destroy", text: "destroy", card: C.kuriboh, zone: zone(1, 4), ...why },
    { id: 6, kind: "chain-resolved", text: "r", chainIndex: 1 },
    { id: 7, kind: "chain-end", text: "end" },
  ] as unknown as DuelEvent[];
};

const PLAN_MS = 2 * (COIN_TIMING.fadeInMs + 1500 + COIN_TIMING.holdMs + COIN_TIMING.outroMs);

beforeEach(() => {
  vi.useFakeTimers();
  resetCoinTossState();
  clearPromptRevealHold();
  clearBattleHolds();
  resetMoveSchedule(KEY);
  resetChainBeats(KEY);
});
afterEach(() => {
  cleanup();
  resetCoinTossState();
  vi.useRealTimers();
});

describe("coin toss before the moves", () => {
  it("the move that follows a toss starts only after the last coin is gone, and the chain waits too", () => {
    const events = batch();
    const { rerender } = render(<CoinTossFx events={[]} duelKey={KEY} reducedMotion={false} />);
    const t0 = duelFxClock.now();
    // The render phase of ChainFx plans the beats, then the layout effects run: the coin first, MoveFx after it.
    planChainBeats(events, { now: t0, reduced: false, duelKey: KEY });
    act(() => { rerender(<CoinTossFx events={events} duelKey={KEY} reducedMotion={false} />); });
    const plans = planMoves(events, options(t0));
    const move = plans.find((plan) => plan.id === 4)!;
    // The coin plan starts after the beat of the resolving link, so its end is later than that beat plus both coins.
    const planEnd = chainBeatAt(2) + COIN_TIMING.chainLeadMs + PLAN_MS;
    expect(move.startAt).toBeGreaterThanOrEqual(planEnd - 50);
    expect(move.landAt).toBeGreaterThan(move.startAt);
    // The chain does not close under the coin either.
    expect(chainBeatAt(7)).toBeGreaterThanOrEqual(planEnd - 50);
  });

  it("a later batch (a bot move with no chain) waits for the coin too", () => {
    // Only the toss in the first batch: the serial move queue holds no earlier move that could hide the hold.
    const events = batch().filter((event) => event.kind !== "move" && event.kind !== "destroy");
    const { rerender } = render(<CoinTossFx events={[]} duelKey={KEY} reducedMotion={false} />);
    const t0 = duelFxClock.now();
    planChainBeats(events, { now: t0, reduced: false, duelKey: KEY });
    act(() => { rerender(<CoinTossFx events={events} duelKey={KEY} reducedMotion={false} />); });
    act(() => { vi.advanceTimersByTime(1000); });
    const later = [{ id: 8, kind: "move", text: "bot draws", card: C.kuriboh, from: zone(1, 1), zone: zone(1, 2), reason: "draw" }] as unknown as DuelEvent[];
    const now = duelFxClock.now();
    planChainBeats(later, { now, reduced: false, duelKey: KEY });
    const move = planMoves(later, options(now)).find((plan) => plan.id === 8)!;
    const planEnd = chainBeatAt(2) + COIN_TIMING.chainLeadMs + PLAN_MS;
    expect(move.startAt).toBeGreaterThanOrEqual(planEnd - 50);
  });

  it("without a toss the same batch plays at once (the hold is only for a coin)", () => {
    const events = batch().filter((event) => event.kind !== "toss");
    const t0 = duelFxClock.now();
    planChainBeats(events, { now: t0, reduced: false, duelKey: KEY });
    const move = planMoves(events, options(t0)).find((plan) => plan.id === 4)!;
    expect(move.startAt).toBeLessThan(t0 + PLAN_MS);
  });
});
