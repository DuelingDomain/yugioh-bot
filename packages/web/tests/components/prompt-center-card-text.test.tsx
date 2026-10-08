// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { COMPACT_TEXT_QUERY, PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

const LONG = `Activate 1 of these effects. ${"You can only activate 1 of this card per turn. ".repeat(6)}\n● Add 1 monster.\n● Take 800 damage.`;

function optionPrompt(text: string): DuelPrompt {
  return {
    id: "p1", seat: 0, kind: "choice", title: "Select an option",
    options: [{ id: "o1", label: "Add 1 monster" }, { id: "o2", label: "Take 800 damage" }],
    source: { code: 98502113, name: "Mitsurugi Prayers", seat: 0, text },
  };
}

type Listener = () => void;
let listeners: Listener[] = [];
let compactNow = false;

/** jsdom has no layout: say whether the small-window query matches, and let a test change it. */
function mockScreen(compact: boolean) {
  compactNow = compact;
  listeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() { return query === COMPACT_TEXT_QUERY ? compactNow : false; },
    media: query,
    addEventListener: (_type: string, listener: Listener) => { listeners.push(listener); },
    removeEventListener: (_type: string, listener: Listener) => { listeners = listeners.filter((entry) => entry !== listener); },
  })) as unknown as typeof window.matchMedia;
}

/** The window is resized across the small-window line while the prompt is open. */
function resizeTo(compact: boolean) {
  compactNow = compact;
  act(() => { for (const listener of [...listeners]) listener(); });
}

function mount(prompt: DuelPrompt, dense = false) {
  const panel = (
    <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={vi.fn()}
      menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
  );
  render(dense ? <div data-prompt-dense="true">{panel}</div> : panel);
}

afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; restore that
  delete window.matchMedia;
});

describe("PromptCenter card text", () => {
  it("shows the full text with no toggle on a large screen", () => {
    mockScreen(false);
    mount(optionPrompt(LONG));
    const body = screen.getByText(/Activate 1 of these effects/);
    expect(body.getAttribute("data-clamped")).toBe("false");
    expect(screen.queryByRole("button", { name: /full text|show less/i })).toBeNull();
  });

  it("cuts long text and offers a toggle on a small screen", () => {
    mockScreen(true);
    mount(optionPrompt(LONG));
    const body = screen.getByText(/Activate 1 of these effects/);
    expect(body.getAttribute("data-clamped")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show full text" }));
    expect(body.getAttribute("data-clamped")).toBe("false");
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("never adds a toggle to short text", () => {
    mockScreen(true);
    mount(optionPrompt("Draw 1 card."));
    expect(screen.queryByRole("button", { name: /full text/i })).toBeNull();
  });

  it("follows a window change while the prompt is open", () => {
    mockScreen(false);
    mount(optionPrompt(LONG));
    const body = screen.getByText(/Activate 1 of these effects/);
    expect(body.getAttribute("data-clamped")).toBe("false");
    resizeTo(true);
    expect(body.getAttribute("data-clamped")).toBe("true");
    expect(screen.getByRole("button", { name: "Show full text" })).toBeTruthy();
    resizeTo(false);
    expect(body.getAttribute("data-clamped")).toBe("false");
    expect(screen.queryByRole("button", { name: /full text/i })).toBeNull();
  });

  it("cuts long text in a dense host (3-way and 4-way pair panel) on a large screen", () => {
    mockScreen(false);
    mount(optionPrompt(LONG), true);
    expect(screen.getByText(/Activate 1 of these effects/).getAttribute("data-clamped")).toBe("true");
    expect(screen.getByRole("button", { name: "Show full text" })).toBeTruthy();
  });

  it("names the box the toggle opens", () => {
    mockScreen(true);
    mount(optionPrompt(LONG));
    const body = screen.getByText(/Activate 1 of these effects/);
    expect(screen.getByRole("button", { name: "Show full text" }).getAttribute("aria-controls")).toBe(body.id);
  });

  it("applies to a yes/no prompt that shows the card text", () => {
    // With no context a sourced yes/no opens the compact pre-check bar; a context puts the full panel up.
    const yesNo: DuelPrompt = {
      id: "p2", seat: 0, kind: "choice", title: "Activate Mitsurugi Prayers?", context: { type: "opponent" },
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
      source: { code: 98502113, name: "Mitsurugi Prayers", seat: 0, text: LONG },
    };
    mockScreen(false);
    mount(yesNo);
    expect(screen.getByText(/Activate 1 of these effects/).getAttribute("data-clamped")).toBe("false");
    expect(screen.queryByRole("button", { name: /full text/i })).toBeNull();
    cleanup();
    mockScreen(true);
    mount(yesNo);
    expect(screen.getByText(/Activate 1 of these effects/).getAttribute("data-clamped")).toBe("true");
    expect(screen.getByRole("button", { name: "Show full text" })).toBeTruthy();
  });

  it("keeps the text of an opened chain row full, with no toggle, on a small window", () => {
    mockScreen(true);
    const card = { code: 1, name: "True Light", description: "x", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior" };
    const chain: DuelPrompt = {
      id: "p3", seat: 0, kind: "choice", title: "Select a chain link or pass", cancelable: true,
      context: { type: "chain", forced: false },
      options: [
        { id: "card:0", label: "True Light: Special Summon", card, effectText: "Special Summon", cardText: LONG },
        { id: "other", label: "Something else" },
      ],
    };
    mount(chain);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: /Show full text of True Light/ }));
    // The row also prints the text as a detail line; the block is the one that carries data-clamped.
    expect(document.querySelector("p[data-clamped]")?.getAttribute("data-clamped")).toBe("false");
    expect(screen.queryByRole("button", { name: "Show full text" })).toBeNull();
  });

  it("uses the small-window rule for phone widths and short windows", () => {
    expect(COMPACT_TEXT_QUERY).toContain("max-width: 900px");
    expect(COMPACT_TEXT_QUERY).toContain("max-height: 640px");
  });
});
