// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { PromptCenter } from "@/components/duel/prompt-center";
import { usePromptDraft } from "@/components/duel/prompts";
import { REVEAL_TIMING, usePromptReveal } from "@/components/duel/prompt-reveal";

const card = (code: number, name: string) => ({ code, name, description: "Text.", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior" });

const picks = (id: string): DuelPrompt => ({
  id, seat: 0, kind: "cards", title: "Select 2 cards", min: 1, max: 2,
  options: ["a", "b", "c"].map((key) => ({ id: key, label: `Card ${key}` })),
});

const chainPrompt = (id: string, activated: string, own: string): DuelPrompt => ({
  id, seat: 0, kind: "choice", title: `${activated} activated. Respond?`, cancelable: true,
  context: { type: "chain", forced: false },
  options: [{ id: "activate", label: `Activate ${own}`, card: card(own.length, own) }],
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the prompt draft follows the prompt id", () => {
  it("keeps picks when the same id arrives again as a new object", () => {
    const { result, rerender } = renderHook(({ prompt }) => usePromptDraft(prompt), { initialProps: { prompt: picks("p1") } });
    act(() => {
      result.current.setSelected(["a", "b"]);
      result.current.setHighlight(2);
    });
    rerender({ prompt: { ...picks("p1"), title: "Select 2 cards (again)" } });
    expect(result.current.selected).toEqual(["a", "b"]);
    expect(result.current.highlight).toBe(2);
  });

  it("discards picks, counts, number and highlight when a new id arrives", () => {
    const { result, rerender } = renderHook(({ prompt }) => usePromptDraft(prompt), { initialProps: { prompt: picks("p1") } });
    act(() => {
      result.current.setSelected(["a"]);
      result.current.setCounts({ a: 2 });
      result.current.setValue(5);
      result.current.setCardCode(99);
      result.current.setHighlight(2);
    });
    rerender({ prompt: picks("p2") });
    expect(result.current.selected).toEqual([]);
    expect(result.current.counts).toEqual({});
    expect(result.current.value).toBe(1); // the new prompt's min
    expect(result.current.cardCode).toBeNull();
    expect(result.current.highlight).toBe(0);
  });

  it("starts a new id with its mandatory picks", () => {
    const { result, rerender } = renderHook(({ prompt }) => usePromptDraft(prompt), { initialProps: { prompt: picks("p1") } });
    act(() => result.current.setSelected(["b"]));
    rerender({ prompt: { ...picks("p2"), mandatory: ["c"] } });
    expect(result.current.selected).toEqual(["c"]);
  });
});

describe("the open effect list follows the prompt id", () => {
  function Panel({ prompt }: { prompt: DuelPrompt }) {
    const draft = usePromptDraft(prompt);
    return <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={vi.fn()}
      menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} />;
  }
  const two = (id: string): DuelPrompt => ({
    ...chainPrompt(id, "Mika's Call of the Haunted", "Solemn Judgment"),
    options: [
      { id: "one", label: "Activate Solemn Judgment", card: card(1, "Solemn Judgment") },
      { id: "two", label: "Activate Mirror Force", card: card(2, "Mirror Force") },
    ],
  });

  it("keeps the list open for the same id and returns to the bar for a new id", () => {
    const { rerender } = render(<Panel prompt={two("chain-1")} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    rerender(<Panel prompt={{ ...two("chain-1") }} />);
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^\d\. / })).toHaveLength(2);
    rerender(<Panel prompt={two("chain-2")} />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeVisible();
  });
});

describe("a prompt replaced or cleared during the reveal beat", () => {
  beforeEach(() => vi.useFakeTimers());

  /** The room's wiring: the reveal beat gates what PromptCenter draws. */
  function Room({ prompt, reducedMotion = true }: { prompt: DuelPrompt | null; reducedMotion?: boolean }) {
    const board = React.useRef<HTMLDivElement>(null);
    const revealed = usePromptReveal({ promptId: prompt?.id ?? null, board, reducedMotion });
    const draft = usePromptDraft(prompt);
    return (
      <div ref={board}>
        <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={vi.fn()}
          menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} revealed={revealed} />
      </div>
    );
  }
  const first = chainPrompt("chain-1", "Ryo's Mirror Force", "Solemn Judgment");
  const second = chainPrompt("chain-2", "Mika's Call of the Haunted", "Bottomless Trap Hole");
  const panelText = () => document.body.textContent ?? "";

  async function settle(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("shows nothing before the beat, then the panel of the current prompt", async () => {
    render(<Room prompt={first} />);
    expect(panelText()).not.toContain("Respond?");
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    await settle(REVEAL_TIMING.reducedMs + 50);
    expect(screen.getByRole("button", { name: "Yes" })).toBeVisible();
  });

  it("never shows the old panel when a new prompt replaces it mid-beat", async () => {
    const { rerender } = render(<Room prompt={first} />);
    await settle(REVEAL_TIMING.reducedMs / 2);
    rerender(<Room prompt={second} />);
    // The old beat would have ended here.
    await settle(REVEAL_TIMING.reducedMs / 2 + 20);
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(panelText()).not.toMatch(/Solemn Judgment|Mirror Force/);
    // The new prompt shows after its own beat.
    await settle(REVEAL_TIMING.reducedMs);
    expect(screen.getByRole("button", { name: "Yes" })).toBeVisible();
    expect(panelText()).toContain("Bottomless Trap Hole");
    expect(panelText()).not.toContain("Solemn Judgment");
  });

  it("never shows the old panel when the prompt is cleared mid-beat", async () => {
    const { rerender } = render(<Room prompt={first} />);
    await settle(REVEAL_TIMING.reducedMs / 2);
    rerender(<Room prompt={null} />);
    await settle(REVEAL_TIMING.reducedMs * 3);
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(panelText()).not.toContain("Solemn Judgment");
  });

  it("hides a shown panel at once when its prompt is replaced, until the new beat ends", async () => {
    const { rerender } = render(<Room prompt={first} />);
    await settle(REVEAL_TIMING.reducedMs + 50);
    expect(screen.getByRole("button", { name: "Yes" })).toBeVisible();
    rerender(<Room prompt={second} />);
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(panelText()).not.toContain("Solemn Judgment");
    await settle(REVEAL_TIMING.reducedMs + 50);
    expect(panelText()).toContain("Bottomless Trap Hole");
  });
});
