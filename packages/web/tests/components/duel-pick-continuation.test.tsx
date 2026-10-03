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
  continuesPlacement,
  keepsPickOpen,
  placesBeforeChain,
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

function menu(overrides: Partial<DuelPrompt> = {}): DuelPrompt {
  return {
    id: "m1", seat: 0, kind: "choice", title: "Main Phase", context: { type: "action", phase: "main" },
    options: [{ id: "summon:0", label: "Normal Summon" }] as DuelPrompt["options"], ...overrides,
  };
}
function places(overrides: Partial<DuelPrompt> = {}): DuelPrompt {
  return {
    id: "z1", seat: 0, kind: "places", title: "Select a zone",
    options: [{ id: "place:0", label: "Zone 1" }] as DuelPrompt["options"], ...overrides,
  };
}
function tribute(overrides: Partial<DuelPrompt> = {}): DuelPrompt {
  return { id: "t1", seat: 0, kind: "tribute", title: "Select tributes", options: [{ id: "t:0", label: "A" }] as DuelPrompt["options"], ...overrides };
}

const HAND = 0x02;
const MZONE = 0x04;
function menuWith(...options: Array<{ id: string; location?: number; type?: number }>): DuelPrompt {
  return menu({
    options: options.map((o) => ({
      id: o.id, label: o.id, location: o.location,
      card: o.type == null ? undefined : { code: 1, name: "C", description: "", type: o.type, attack: 0, defense: 0, level: 0, attribute: 0, race: "" },
    })) as DuelPrompt["options"],
  });
}

describe("placesBeforeChain", () => {
  it("is true for a summon, a set and a special summon", () => {
    for (const id of ["summon:0", "mset:0", "sset:0", "spsummon:0"]) {
      expect(placesBeforeChain(menuWith({ id }), { choice: id }), id).toBe(true);
    }
  });

  it("is true for a Spell or Trap activated from the hand", () => {
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: HAND, type: 0x2 }), { choice: "activate:0" })).toBe(true);
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: HAND, type: 0x4 }), { choice: "activate:0" })).toBe(true);
  });

  it("is false for a monster effect, or a Spell/Trap already on the field", () => {
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: MZONE, type: 0x1 }), { choice: "activate:0" })).toBe(false);
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: HAND, type: 0x1 }), { choice: "activate:0" })).toBe(false);
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: MZONE, type: 0x2 }), { choice: "activate:0" })).toBe(false);
    expect(placesBeforeChain(menuWith({ id: "activate:0", location: HAND }), { choice: "activate:0" })).toBe(false);
  });

  it("is false for battle and phase actions, a position change and a cancel", () => {
    for (const id of ["attack:0", "to_bp", "to_ep", "pos:0", "shuffle"]) {
      expect(placesBeforeChain(menuWith({ id }), { choice: id }), id).toBe(false);
    }
    expect(placesBeforeChain(menu(), { cancel: true })).toBe(false);
  });

  it("is true for a tribute pick", () => {
    expect(placesBeforeChain(tribute(), { selected: ["t:0"] })).toBe(true);
  });
});

describe("continuesPlacement", () => {
  it("shows the zone prompt at once after the player's own action", () => {
    expect(continuesPlacement(menu(), places())).toBe(true);
  });

  it("shows the tribute prompt at once after the player's own action", () => {
    expect(continuesPlacement(menu(), tribute())).toBe(true);
  });

  it("shows the zone prompt at once after the player's tribute pick", () => {
    expect(continuesPlacement(tribute(), places())).toBe(true);
  });

  it("keeps the beat for a prompt that follows a chain response or another player", () => {
    const chain = menu({ context: { type: "chain", forced: false } });
    expect(continuesPlacement(chain, places())).toBe(false);
    expect(continuesPlacement(menu({ seat: 1 }), places())).toBe(false);
  });

  it("keeps the beat for a search or a response after an action", () => {
    expect(continuesPlacement(menu(), toggle({ id: "x" }))).toBe(false);
    expect(continuesPlacement(menu(), { ...places(), id: "x", kind: "cards" })).toBe(false);
    expect(continuesPlacement(menu(), { ...places(), id: "x", kind: "choice" })).toBe(false);
  });

  it("rejects missing prompts and the same prompt id", () => {
    expect(continuesPlacement(null, places())).toBe(false);
    expect(continuesPlacement(menu(), null)).toBe(false);
    expect(continuesPlacement(menu({ id: "z1" }), places())).toBe(false);
  });
});

describe("usePickContinuation after an action", () => {
  beforeEach(() => { vi.useFakeTimers(); setAnimationSpeed(1); duelFxClock.resetReviewTimeline(); });
  afterEach(() => { cleanup(); setAnimationSpeed(1); duelFxClock.resetReviewTimeline(); vi.useRealTimers(); });

  function setup(initial: DuelPrompt | null) {
    return renderHook(({ prompt }: { prompt: DuelPrompt | null }) => usePickContinuation(prompt), { initialProps: { prompt: initial } });
  }

  it("the zone prompt after Normal Summon continues, and holds no bar while it is on its way", () => {
    const { result, rerender } = setup(menu());
    act(() => result.current.noteAnswer(menu(), { choice: "summon:0" }));
    expect(result.current.waiting).toBeNull();
    rerender({ prompt: places() });
    expect(result.current.continuing).toBe(true);
  });

  it("the zone prompt after a tribute pick continues", () => {
    const { result, rerender } = setup(tribute());
    act(() => result.current.noteAnswer(tribute(), { selected: ["t:0"] }));
    rerender({ prompt: places() });
    expect(result.current.continuing).toBe(true);
  });

  it("backing out of the action menu does not skip the next zone prompt's beat", () => {
    const { result, rerender } = setup(menu());
    act(() => result.current.noteAnswer(menu(), { cancel: true }));
    rerender({ prompt: places() });
    expect(result.current.continuing).toBe(false);
  });

  it("an unanswered zone prompt keeps its beat", () => {
    const { result, rerender } = setup(menu());
    rerender({ prompt: places() });
    expect(result.current.continuing).toBe(false);
  });

  it("an answer too long ago does not count", () => {
    const { result, rerender } = setup(menu());
    act(() => result.current.noteAnswer(menu(), { choice: "summon:0" }));
    act(() => void vi.advanceTimersByTime(PICK_CONTINUATION.windowMs + 1));
    rerender({ prompt: places() });
    expect(result.current.continuing).toBe(false);
  });

  it("a search prompt after the action keeps its beat, and uses up the chance", () => {
    const { result, rerender } = setup(menu());
    act(() => result.current.noteAnswer(menu(), { choice: "summon:0" }));
    rerender({ prompt: { ...places(), id: "s1", kind: "cards" } });
    expect(result.current.continuing).toBe(false);
    rerender({ prompt: places({ id: "z2" }) });
    expect(result.current.continuing).toBe(false);
  });
});

describe("usePickContinuation: only a zone that follows a placing action skips the beat", () => {
  beforeEach(() => { vi.useFakeTimers(); setAnimationSpeed(1); duelFxClock.resetReviewTimeline(); });
  afterEach(() => { cleanup(); setAnimationSpeed(1); duelFxClock.resetReviewTimeline(); vi.useRealTimers(); });

  function setup(initial: DuelPrompt | null, revision = 1) {
    return renderHook(
      ({ prompt, rev }: { prompt: DuelPrompt | null; rev: number }) => usePickContinuation(prompt, rev),
      { initialProps: { prompt: initial, rev: revision } },
    );
  }

  it("a Normal Summon and a Set go straight to the zones", () => {
    for (const id of ["summon:0", "mset:0"]) {
      const first = menuWith({ id });
      const { result, rerender } = setup(first);
      act(() => result.current.noteAnswer(first, { choice: id }));
      rerender({ prompt: places({ id: `z-${id}` }), rev: 2 });
      expect(result.current.continuing, id).toBe(true);
    }
  });

  it("a Spell from the hand goes straight to its zone", () => {
    const first = menuWith({ id: "activate:0", location: HAND, type: 0x2 });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { choice: "activate:0" }));
    rerender({ prompt: places(), rev: 2 });
    expect(result.current.continuing).toBe(true);
  });

  it("a monster effect that later asks for a zone keeps its beat", () => {
    const first = menuWith({ id: "activate:0", location: MZONE, type: 0x1 });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { choice: "activate:0" }));
    rerender({ prompt: places(), rev: 2 });
    expect(result.current.continuing).toBe(false);
  });

  it("a battle or phase action never skips the beat of a later zone prompt", () => {
    const first = menuWith({ id: "to_ep" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { choice: "to_ep" }));
    rerender({ prompt: places(), rev: 2 });
    expect(result.current.continuing).toBe(false);
  });

  it("a Summon answer, then a revision with no prompt for this player, then a zone prompt keeps its beat", () => {
    const first = menuWith({ id: "summon:0" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { choice: "summon:0" }));
    rerender({ prompt: null, rev: 2 });
    rerender({ prompt: places(), rev: 3 });
    expect(result.current.continuing).toBe(false);
  });

  it("a null prompt on the same revision does not end the chance", () => {
    const first = menuWith({ id: "summon:0" });
    const { result, rerender } = setup(first);
    act(() => result.current.noteAnswer(first, { choice: "summon:0" }));
    rerender({ prompt: null, rev: 1 });
    rerender({ prompt: places(), rev: 2 });
    expect(result.current.continuing).toBe(true);
  });
});
