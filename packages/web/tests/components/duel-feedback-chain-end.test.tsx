// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

const play = vi.fn();
vi.mock("@/components/duel/feedback-audio", () => ({
  createDuelFeedbackAudio: () => ({
    unlock: async () => true,
    setMuted: () => undefined,
    setVolume: () => undefined,
    play,
    playBattle: () => undefined,
    stopAll: () => undefined,
    dispose: () => undefined,
  }),
}));

import { DuelFeedback } from "@/components/duel/feedback";
import { planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { chainStepDelay } from "@/components/duel/chain-state";

let id = 100;
const ev = (kind: DuelEvent["kind"], text: string, chainIndex?: number): DuelEvent => ({
  id: id++, kind, text, ...(chainIndex != null ? { chainIndex } : {}),
});

const view = (events: DuelEvent[]) => (
  <DuelFeedback events={events} duelKey="t" soundEnabled reducedMotion={false} />
);

beforeEach(() => {
  vi.useFakeTimers();
  play.mockClear();
  resetChainBeats("t");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DuelFeedback chain end", () => {
  it.each([false, true])("keeps target updates out of banners and sound queues (reduced motion %s)", (reducedMotion) => {
    const feedback = (events: DuelEvent[]) => <DuelFeedback events={events} duelKey="t" soundEnabled reducedMotion={reducedMotion} />;
    const { container, rerender } = render(feedback([]));
    const activate = ev("activate", "Mystical Space Typhoon", 1);
    const target = { ...ev("target", "Chain Link 1 targets 1 card", 1), targets: [{ controller: 1, location: 8, sequence: 0 }] };
    rerender(feedback([activate, target]));
    expect(container.querySelector('[data-kind="activate"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(container.querySelector("[data-kind]")).toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(container.textContent).toBe("");
    expect(play).not.toHaveBeenCalledWith("target");
  });

  it("shows no centre banner when the chain ends, but still plays its quiet cue", () => {
    const { container, rerender } = render(view([]));
    const end = ev("chain-end", "Chain ended");
    rerender(view([end]));
    expect(container.querySelector('[data-kind="chain-end"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Chain end/i);
    expect(play).toHaveBeenCalledWith("chain-end");
  });

  it("shows no banner for a link resolving or resolved, but keeps their quiet cues", () => {
    const { container, rerender } = render(view([]));
    const resolving = ev("chain-resolving", "chain-resolving", 1);
    const resolved = ev("chain-resolved", "chain-resolved", 1);
    rerender(view([resolving, resolved]));
    act(() => { vi.advanceTimersByTime(50); });
    expect(container.querySelector('[data-kind="chain-resolving"]')).toBeNull();
    expect(container.querySelector('[data-kind="chain-resolved"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Resolving|Resolved/);
    expect(play).toHaveBeenCalledWith("chain-resolving");
    expect(play).toHaveBeenCalledWith("chain-resolved");
  });

  it("does not let a resolving or resolved link queue up behind or in front of other banners", () => {
    const { container, rerender } = render(view([]));
    const events = [ev("chain-resolving", "chain-resolving", 2), ev("chain-resolved", "chain-resolved", 2), ev("chain-resolving", "chain-resolving", 1), ev("chain-negated", "chain-negated", 1)];
    rerender(view(events));
    act(() => { vi.advanceTimersByTime(0); });
    // The Negated banner is the first and only banner: nothing waits behind a resolving banner.
    expect(container.querySelector('[data-kind="chain-negated"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector("[data-kind]")).toBeNull();
  });

  it("still shows the Activate banner, with the link number", () => {
    const { container, rerender } = render(view([]));
    const activate = ev("activate", "Mirror Force", 2);
    rerender(view([activate]));
    const cue = container.querySelector('[data-kind="activate"]');
    expect(cue).not.toBeNull();
    expect(cue?.textContent).toContain("Activate");
    expect(cue?.textContent).toContain("Chain 2");
    expect(cue?.textContent).toContain("Mirror Force");
  });

  it("still shows the Negated banner", () => {
    const { container, rerender } = render(view([]));
    rerender(view([ev("chain-negated", "chain-negated", 1)]));
    const cue = container.querySelector('[data-kind="chain-negated"]');
    expect(cue).not.toBeNull();
    expect(cue?.textContent).toContain("Negated");
  });

  it("holds the Negated banner and the resolve sounds until the board plays their beat", () => {
    const { container, rerender } = render(view([]));
    const events = [ev("chain-resolving", "chain-resolving", 1), ev("chain-negated", "chain-negated", 1), ev("chain-resolved", "chain-resolved", 1)];
    planChainBeats(events, { now: performance.now(), reduced: false, duelKey: "t" });
    rerender(view(events));
    act(() => { vi.advanceTimersByTime(0); });
    // Beat one (resolving) is due now; the negated beat is one step later, the resolved beat after that.
    expect(play).toHaveBeenCalledWith("chain-resolving");
    expect(play).not.toHaveBeenCalledWith("chain-resolved");
    expect(container.querySelector('[data-kind="chain-negated"]')).toBeNull();
    act(() => { vi.advanceTimersByTime(chainStepDelay("chain-resolving", 2, false) + 10); });
    expect(container.querySelector('[data-kind="chain-negated"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(chainStepDelay("chain-negated", 1, false) + 10); });
    expect(play).toHaveBeenCalledWith("chain-resolved");
  });
});
