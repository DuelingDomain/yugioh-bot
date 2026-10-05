// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { acquireCoinLock, resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { clearPromptRevealHold, holdPromptReveal } from "@/components/duel/prompt-reveal";
import { clearLpMotion, lpMotionRemainingMs, noteLpMotion } from "@/components/duel/lp-motion";
import {
  boardQuietNow,
  RESULT_TIMING,
  resultGate,
  useResultGate,
  type ResultGateInput,
} from "@/components/duel/result-reveal";

const base: ResultGateInput = {
  over: true,
  live: true,
  status: "completed",
  reasonKind: "life-points",
  reducedMotion: false,
  sinceEndMs: 0,
  quietForMs: null,
};

const gate = (patch: Partial<ResultGateInput>) => resultGate({ ...base, ...patch });

describe("resultGate", () => {
  it("shows nothing while the duel is not over", () => {
    expect(gate({ over: false, sinceEndMs: 99_999, quietForMs: 99_999 }).show).toBe(false);
  });

  it("waits while the board is busy", () => {
    expect(gate({ sinceEndMs: 1500, quietForMs: null })).toMatchObject({ show: false, reason: "waiting" });
  });

  it("waits for the human pause after the board turns quiet", () => {
    expect(gate({ sinceEndMs: 2000, quietForMs: 0 }).show).toBe(false);
    expect(gate({ sinceEndMs: 2900, quietForMs: RESULT_TIMING.pauseMs - 1 }).show).toBe(false);
    expect(gate({ sinceEndMs: 3000, quietForMs: RESULT_TIMING.pauseMs })).toMatchObject({ show: true, reason: "quiet" });
  });

  it("keeps the pause about a second and a half", () => {
    expect(RESULT_TIMING.pauseMs).toBeGreaterThanOrEqual(1200);
    expect(RESULT_TIMING.pauseMs).toBeLessThanOrEqual(1800);
  });

  it("shows at the hard cap even when the board never reports quiet", () => {
    expect(gate({ sinceEndMs: RESULT_TIMING.capMs - 1, quietForMs: null }).show).toBe(false);
    expect(gate({ sinceEndMs: RESULT_TIMING.capMs, quietForMs: null })).toMatchObject({ show: true, reason: "cap" });
  });

  it("shows at once for a duel that was already finished when the room opened", () => {
    expect(gate({ live: false, sinceEndMs: 0, quietForMs: null })).toMatchObject({ show: true, reason: "opened-finished" });
  });

  it.each(["surrender", "time", "connection"] as const)("shows at once for a %s ending (no board FX)", (reasonKind) => {
    expect(gate({ reasonKind, sinceEndMs: 0, quietForMs: null })).toMatchObject({ show: true, reason: "off-board" });
  });

  it.each(["interrupted", "cancelled"] as const)("shows at once for a %s table", (status) => {
    expect(gate({ status, reasonKind: "other", sinceEndMs: 0 })).toMatchObject({ show: true, reason: "off-board" });
  });

  it("waits for board FX after a deck-out, a draw or an effect win", () => {
    expect(gate({ reasonKind: "deck-out", sinceEndMs: 100, quietForMs: null }).show).toBe(false);
    expect(gate({ reasonKind: "other", status: "completed", sinceEndMs: 100, quietForMs: null }).show).toBe(false);
  });

  it("uses only a short pause under reduced motion, whatever the board does", () => {
    expect(gate({ reducedMotion: true, sinceEndMs: 0, quietForMs: null }).show).toBe(false);
    expect(gate({ reducedMotion: true, sinceEndMs: RESULT_TIMING.reducedPauseMs, quietForMs: null })).toMatchObject({ show: true, reason: "reduced" });
    expect(RESULT_TIMING.reducedPauseMs).toBeLessThanOrEqual(500);
  });
});

describe("boardQuietNow", () => {
  beforeEach(() => {
    clearPromptRevealHold();
    clearLpMotion();
  });
  afterEach(() => {
    clearPromptRevealHold();
    clearLpMotion();
  });

  it("is quiet with nothing running", () => {
    expect(boardQuietNow(null)).toBe(true);
  });

  it("is busy while a script animation runs on the board", () => {
    const running = { finished: Promise.resolve(), playState: "running", effect: { getTiming: () => ({ iterations: 1 }) } };
    expect(boardQuietNow({ getAnimations: () => [running] })).toBe(false);
    expect(boardQuietNow({ getAnimations: () => [{ ...running, playState: "finished" }] })).toBe(true);
  });

  it("is busy while an FX layer holds the board (battle, summon, destroy)", () => {
    holdPromptReveal(500);
    expect(boardQuietNow(null)).toBe(false);
    clearPromptRevealHold();
    expect(boardQuietNow(null)).toBe(true);
  });

  it("is busy while an LP counter rolls", () => {
    noteLpMotion(700);
    expect(lpMotionRemainingMs()).toBeGreaterThan(0);
    expect(boardQuietNow(null)).toBe(false);
    clearLpMotion();
    expect(boardQuietNow(null)).toBe(true);
  });
});

describe("resultGate and the coin toss", () => {
  it("does not show while a coin plays, not at the cap and not in reduced motion", () => {
    expect(gate({ sinceEndMs: RESULT_TIMING.capMs + 5000, quietForMs: null, coinPlaying: true })).toMatchObject({ show: false });
    expect(gate({ sinceEndMs: 1500, quietForMs: RESULT_TIMING.pauseMs + 1, coinPlaying: true })).toMatchObject({ show: false });
    expect(gate({ reducedMotion: true, sinceEndMs: RESULT_TIMING.reducedPauseMs + 500, coinPlaying: true })).toMatchObject({ show: false });
    expect(gate({ sinceEndMs: RESULT_TIMING.capMs, quietForMs: null, coinPlaying: false })).toMatchObject({ show: true, reason: "cap" });
  });
});

describe("useResultGate", () => {
  type Props = Parameters<typeof useResultGate>[0];
  const board = { current: null };
  const props = (patch: Partial<Props> = {}): Props => ({
    slug: "duel-a",
    status: "active",
    hasResult: false,
    reason: null,
    reducedMotion: false,
    board,
    ...patch,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    clearPromptRevealHold();
    clearLpMotion();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearPromptRevealHold();
    clearLpMotion();
  });

  it("is false while the duel is live", () => {
    const { result } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    expect(result.current).toBe(false);
  });

  it("holds the screen until the board is quiet, then adds the pause", async () => {
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    holdPromptReveal(1500);
    rerender(props({ status: "completed", hasResult: true, reason: "LP reached 0" }));
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
    expect(result.current).toBe(false);
    // Hold ends at 1500 ms; quiet from then; the pause adds RESULT_TIMING.pauseMs.
    await act(async () => { await vi.advanceTimersByTimeAsync(1500 - 1400 + RESULT_TIMING.pauseMs - 200); });
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current).toBe(true);
  });

  it("waits for a 3-coin toss that ends the duel, past the cap, then adds the pause", async () => {
    resetCoinTossState();
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    // The coin layer takes the lock when the toss event arrives, with the result in the same batch.
    const release = acquireCoinLock();
    rerender(props({ status: "completed", hasResult: true, reason: "LP reached 0" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TIMING.capMs + 3000); });
    expect(result.current).toBe(false);
    release();
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TIMING.pauseMs - 300); });
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(result.current).toBe(true);
    resetCoinTossState();
  });

  it("shows after the cap when the board never settles", async () => {
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    rerender(props({ status: "completed", hasResult: true, reason: "LP reached 0" }));
    // A hold that keeps being renewed, as a stuck FX layer would.
    const renew = setInterval(() => holdPromptReveal(500), 100);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TIMING.capMs - 200); });
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(result.current).toBe(true);
    clearInterval(renew);
  });

  it("shows on the first render for a duel that was finished when it opened", () => {
    const { result } = renderHook((p: Props) => useResultGate(p), {
      initialProps: props({ status: "completed", hasResult: true, reason: "LP reached 0" }),
    });
    expect(result.current).toBe(true);
  });

  it("shows at once for a surrender that ends a live duel", () => {
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    holdPromptReveal(3000);
    rerender(props({ status: "completed", hasResult: true, reason: "Surrendered" }));
    expect(result.current).toBe(true);
  });

  it("uses a short pause under reduced motion", async () => {
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props({ reducedMotion: true }) });
    holdPromptReveal(3000);
    rerender(props({ reducedMotion: true, status: "completed", hasResult: true, reason: "LP reached 0" }));
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TIMING.reducedPauseMs + RESULT_TIMING.tickMs); });
    expect(result.current).toBe(true);
  });

  it("shows when the engine result arrives before the session status changes", async () => {
    const { result, rerender } = renderHook((p: Props) => useResultGate(p), { initialProps: props() });
    rerender(props({ hasResult: true, reason: "LP reached 0" }));
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(RESULT_TIMING.pauseMs + RESULT_TIMING.tickMs * 2); });
    expect(result.current).toBe(true);
  });
});
