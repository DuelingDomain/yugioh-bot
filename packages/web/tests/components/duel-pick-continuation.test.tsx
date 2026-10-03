// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import {
  continuesPick,
  keepsPickOpen,
  PICK_CONTINUATION,
  usePickContinuation,
} from "@/components/duel/pick-continuation";
import { duelFxClock } from "@/components/duel/fx-clock";
import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { usePromptAnswerable, usePromptReveal } from "@/components/duel/prompt-reveal";

function toggle(overrides: Partial<DuelPrompt> = {}): DuelPrompt {
  return {
    id: "p1",
    seat: 0,
    kind: "toggle",
    title: "Select the card(s) to use as Synchro Material",
    options: [
      { id: "select:0", label: "A", selected: false },
      { id: "select:1", label: "B", selected: false },
    ] as DuelPrompt["options"],
    ...overrides,
  };
}

describe("continuesPick", () => {
  it("accepts a re-ask of the same material pick for the same seat", () => {
    expect(continuesPick(toggle({ id: "p1" }), toggle({ id: "p2" }))).toBe(true);
  });

  it("still accepts it when the chosen set and the options changed", () => {
    const next = toggle({
      id: "p2",
      finishable: true,
      options: [{ id: "unselect:0", label: "A", selected: true }, { id: "select:0", label: "B", selected: false }] as DuelPrompt["options"],
    });
    expect(continuesPick(toggle(), next)).toBe(true);
  });

  it("rejects a missing prompt on either side", () => {
    expect(continuesPick(null, toggle())).toBe(false);
    expect(continuesPick(toggle(), null)).toBe(false);
    expect(continuesPick(undefined, undefined)).toBe(false);
  });

  it("rejects another seat", () => {
    expect(continuesPick(toggle(), toggle({ id: "p2", seat: 1 }))).toBe(false);
  });

  it("rejects another title, description or card source: that is a new decision", () => {
    expect(continuesPick(toggle(), toggle({ id: "p2", title: "Select the Tuner" }))).toBe(false);
    expect(continuesPick(toggle({ description: "a" }), toggle({ id: "p2", description: "b" }))).toBe(false);
    const sourced = (name: string) => ({ source: { name } }) as unknown as Partial<DuelPrompt>;
    expect(continuesPick(toggle(sourced("Rose")), toggle({ id: "p2", ...sourced("Dragon") }))).toBe(false);
  });

  it("rejects another prompt kind", () => {
    expect(continuesPick(toggle(), toggle({ id: "p2", kind: "cards" }))).toBe(false);
    expect(continuesPick(toggle({ kind: "cards" }), toggle({ id: "p2", kind: "cards" }))).toBe(false);
  });

  it("rejects chain, position and action contexts", () => {
    const chain = { type: "chain", forced: false } as const;
    expect(continuesPick(toggle({ context: chain }), toggle({ id: "p2", context: chain }))).toBe(false);
    expect(continuesPick(toggle(), toggle({ id: "p2", context: chain }))).toBe(false);
    expect(continuesPick(toggle({ context: { type: "position" } }), toggle({ id: "p2", context: { type: "position" } }))).toBe(false);
  });

  it("rejects the very same prompt id: nothing new arrived", () => {
    expect(continuesPick(toggle({ id: "p1" }), toggle({ id: "p1" }))).toBe(false);
  });
});

describe("keepsPickOpen", () => {
  it("is true for a card click on a board pick", () => {
    expect(keepsPickOpen(toggle(), { selected: ["select:0"] })).toBe(true);
  });

  it("is false for Finish and Cancel: the pick is over", () => {
    expect(keepsPickOpen(toggle(), { finish: true })).toBe(false);
    expect(keepsPickOpen(toggle(), { cancel: true })).toBe(false);
  });

  it("is false for prompts that are not a board pick", () => {
    expect(keepsPickOpen(toggle({ kind: "cards" }), { selected: ["x"] })).toBe(false);
    expect(keepsPickOpen(toggle({ context: { type: "chain", forced: false } }), { selected: ["x"] })).toBe(false);
  });
});

describe("usePickContinuation", () => {
  beforeEach(() => {
    vi.useFakeTimers(); setAnimationSpeed(1); duelFxClock.resetReviewTimeline();
  });
  afterEach(() => {
    cleanup();
    setAnimationSpeed(1); duelFxClock.resetReviewTimeline(); vi.useRealTimers();
  });

  const click: DuelAnswer = { selected: ["select:0"] };

  function setup(initial: DuelPrompt | null) {
    return renderHook(({ prompt }: { prompt: DuelPrompt | null }) => usePickContinuation(prompt), {
      initialProps: { prompt: initial },
    });
  }

  it("the first prompt of a pick is not a continuation", () => {
    const { result } = setup(toggle());
    expect(result.current.continuing).toBe(false);
  });

  it("a re-ask right after the player's own click continues at once, with no flash", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), click));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(true);
  });

  it("a re-ask that nobody answered is not a continuation", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("an opponent prompt in between ends the chance", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), click));
    rerender({ prompt: toggle({ id: "o1", seat: 1 }) });
    expect(result.current.continuing).toBe(false);
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("an answer too long ago does not count", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), click));
    act(() => void vi.advanceTimersByTime(PICK_CONTINUATION.windowMs + 1));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("accepts a network follow-up after 2.5 real seconds at 2x", () => {
    setAnimationSpeed(2); duelFxClock.resetReviewTimeline();
    const { result, rerender } = setup(toggle());
    act(() => result.current.noteAnswer(toggle(), click));
    rerender({ prompt: null });
    act(() => void vi.advanceTimersByTime(2500));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(true);
  });

  it("expires the network window after 4 real seconds at 0.5x", () => {
    setAnimationSpeed(0.5); duelFxClock.resetReviewTimeline();
    const { result, rerender } = setup(toggle());
    act(() => result.current.noteAnswer(toggle(), click));
    act(() => void vi.advanceTimersByTime(PICK_CONTINUATION.windowMs + 1));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("lets the pace change after the visual hold without a network-wait lease", () => {
    const { result } = setup(toggle());
    act(() => result.current.noteAnswer(toggle(), click));
    act(() => void vi.advanceTimersByTime(PICK_CONTINUATION.holdMs + 1));
    setAnimationSpeed(2);
    expect(duelFxClock.factor()).toBe(2);
  });

  it("Finish ends the pick: the next prompt gets its normal beat", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), { finish: true }));
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("stays decided for a prompt id while it re-renders", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), click));
    rerender({ prompt: toggle({ id: "p2" }) });
    rerender({ prompt: toggle({ id: "p2", finishable: true }) });
    expect(result.current.continuing).toBe(true);
  });

  it("after a continuation the next prompt needs its own answer", () => {
    const { result, rerender } = setup(toggle({ id: "p1" }));
    act(() => result.current.noteAnswer(toggle({ id: "p1" }), click));
    rerender({ prompt: toggle({ id: "p2" }) });
    rerender({ prompt: toggle({ id: "p3" }) });
    expect(result.current.continuing).toBe(false);
  });

  it("keeps the answered pick as `waiting` while no prompt is there, then lets go", () => {
    const first = toggle({ id: "p1" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, click));
    expect(result.current.waiting).toBeNull();
    rerender({ prompt: null });
    expect(result.current.waiting?.id).toBe("p1");
    act(() => void vi.advanceTimersByTime(PICK_CONTINUATION.holdMs + 1));
    expect(result.current.waiting).toBeNull();
  });

  it("drops `waiting` when the next prompt arrives", () => {
    const first = toggle({ id: "p1" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, click));
    rerender({ prompt: null });
    rerender({ prompt: toggle({ id: "p2" }) });
    expect(result.current.waiting).toBeNull();
    rerender({ prompt: null });
    expect(result.current.waiting).toBeNull();
  });

  it("holds nothing after Finish", () => {
    const first = toggle({ id: "p1" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { finish: true }));
    rerender({ prompt: null });
    expect(result.current.waiting).toBeNull();
  });
});

describe("reveal gates for a continuing pick", () => {
  afterEach(cleanup);

  it("usePromptReveal shows a skipped prompt on the first render", () => {
    const board = { current: null };
    const { result, rerender } = renderHook(
      ({ id, skip }: { id: string; skip: boolean }) => usePromptReveal({ promptId: id, board, reducedMotion: false, skip }),
      { initialProps: { id: "p1", skip: true } },
    );
    expect(result.current).toBe(true);
    rerender({ id: "p2", skip: true });
    expect(result.current).toBe(true);
  });

  it("usePromptReveal still waits for a prompt that is not skipped", () => {
    const board = { current: null };
    const { result } = renderHook(() => usePromptReveal({ promptId: "p1", board, reducedMotion: false }));
    expect(result.current).toBe(false);
  });

  it("usePromptAnswerable shows a skipped prompt even while the room is busy", () => {
    const { result } = renderHook(() => usePromptAnswerable("p1", false, true));
    expect(result.current).toBe(true);
  });

  it("usePromptAnswerable still holds a normal prompt back while busy", () => {
    const { result } = renderHook(() => usePromptAnswerable("p1", false));
    expect(result.current).toBe(false);
  });
});
