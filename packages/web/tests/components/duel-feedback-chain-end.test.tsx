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
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DuelFeedback chain end", () => {
  it("shows no centre banner when the chain ends, but still plays its quiet cue", () => {
    const { container, rerender } = render(view([]));
    const end = ev("chain-end", "Chain ended");
    rerender(view([end]));
    expect(container.querySelector('[data-kind="chain-end"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Chain end/i);
    expect(play).toHaveBeenCalledWith("chain-end");
  });

  it("still shows the banner for a link that resolves", () => {
    const { container, rerender } = render(view([]));
    rerender(view([ev("chain-resolving", "Resolving", 1)]));
    act(() => undefined);
    expect(container.querySelector('[data-kind="chain-resolving"]')).not.toBeNull();
  });
});
