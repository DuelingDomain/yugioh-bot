// @vitest-environment jsdom
import React, { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DuelClockDisplay } from "@/components/duel/room-settings";
import { usePromptReveal } from "@/components/duel/prompt-reveal";
import { duelFxClock } from "@/components/duel/fx-clock";
import { makeSeriesRoom } from "../helpers/duel-series";

const session = makeSeriesRoom({ series: null, status: "active" }).session;
afterEach(() => { cleanup(); duelFxClock.setReviewSpeed(null); duelFxClock.resetReviewTimeline(); vi.useRealTimers(); });

it.each([false, true])("shows paused banks without a countdown or answering marker (bank=%s)", bank => {
  vi.useFakeTimers();
  const clock = { turn: 1, remainingMs: [30_000, 45_000], activeSeat: 0, startedAt: null, serverNow: 100_000 };
  render(<DuelClockDisplay clock={clock} session={session} bank={bank} />);
  const timer = screen.getByRole("timer");
  expect(timer.textContent).toContain("0:30");
  expect(timer.querySelector('[data-active="true"]')).toBeNull();
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(timer.textContent).toContain("0:30");
});

it.each([false, true])("marks the decision owner only after server presentation grace (bank=%s)", bank => {
  vi.useFakeTimers();
  const clock = { turn: 1, remainingMs: [30_000, 45_000], activeSeat: 1, startedAt: 102_000, serverNow: 100_000 };
  render(<DuelClockDisplay clock={clock} session={session} bank={bank} />);
  const timer = screen.getByRole("timer");
  expect(timer.querySelector('[data-active="true"]')).toBeNull();
  act(() => { vi.advanceTimersByTime(3_000); });
  expect(timer.querySelector('[data-active="true"]')?.textContent).toContain("Imran");
  expect(timer.textContent).toContain("0:44");
  expect(timer.textContent).toContain("0:30");
});

it("keeps a funded clock paused through the actual prompt-reveal cap at 0.5x", async () => {
  vi.useFakeTimers();
  duelFxClock.setReviewSpeed(0.5);
  duelFxClock.resetReviewTimeline();
  const clock = { turn: 1, remainingMs: [100, 100], activeSeat: 0, startedAt: 117_000, serverNow: 100_000 };
  const animation = { playState: "running", finished: new Promise(() => {}) };
  function Decision() {
    const board = useRef({ getAnimations: () => [animation] } as unknown as HTMLElement);
    const revealed = usePromptReveal({ promptId: "slow-animation", board, reducedMotion: false });
    return <><div data-testid="decision" data-revealed={String(revealed)} /><DuelClockDisplay clock={clock} session={session} bank /></>;
  }
  render(<Decision />);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByTestId("decision").getAttribute("data-revealed")).toBe("false");
  expect(screen.getByRole("timer").querySelector('[data-active="true"]')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
  expect(screen.getByTestId("decision").getAttribute("data-revealed")).toBe("true");
  expect(screen.getByRole("timer").querySelector('[data-active="true"]')).toBeNull();
});
