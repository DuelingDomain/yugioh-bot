// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/** jsdom has no layout: say whether the small-screen query matches. */
function mockScreen(compact: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === COMPACT_TEXT_QUERY ? compact : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function mount(prompt: DuelPrompt) {
  render(
    <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={vi.fn()}
      menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />,
  );
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

  it("matches phone widths and short viewports", () => {
    expect(COMPACT_TEXT_QUERY).toBe("(max-width: 900px), (max-height: 640px)");
  });
});
