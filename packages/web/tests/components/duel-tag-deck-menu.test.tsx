// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TagShell } from "@/components/duel/tag/tag-shell";
import { DeckSurrenderContext, type DeckSurrenderValue } from "@/components/duel/deck-surrender";

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.getAnimations = () => [];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => cleanup());

const mySeat = TAG_FIXTURES.states.main.room.mySeat!;

/** The room's wiring in miniature: the surrender seam around the real Rooftop, the menu flag feeding inputSuspended. */
function Rooftop({ surrender = {} }: { surrender?: Partial<DeckSurrenderValue> }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const controller = useFixtureController(TAG_FIXTURES.states.main, { reducedMotion: true });
  const value: DeckSurrenderValue = { seat: mySeat, available: true, busy: false, onSurrender: vi.fn(), onMenuOpenChange: setMenuOpen, ...surrender };
  return (
    <DeckSurrenderContext.Provider value={value}>
      <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} inputSuspended={menuOpen} />
      <output data-testid="menu-flag">{String(menuOpen)}</output>
    </DeckSurrenderContext.Provider>
  );
}
const decks = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-kind="deck"] button'));
const openers = (container: HTMLElement) => decks(container).filter((button) => button.getAttribute("aria-haspopup") === "menu");

describe("Surrender menu on the Rooftop (Tag) table", () => {
  it("puts the menu on exactly one deck, the viewer's", () => {
    const { container } = render(<Rooftop />);
    expect(decks(container).length).toBeGreaterThan(1);
    expect(openers(container)).toHaveLength(1);
  });

  it("opens on a click, offers Surrender, and calls the room only for Surrender", () => {
    const onSurrender = vi.fn();
    const { container } = render(<Rooftop surrender={{ onSurrender }} />);
    fireEvent.click(openers(container)[0]);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByTestId("menu-flag").textContent).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Surrender" }));
    expect(onSurrender).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("menu-flag").textContent).toBe("false");
  });

  it("opens on a right click and closes on Escape with focus back on the deck", () => {
    const { container } = render(<Rooftop />);
    const deck = openers(container)[0];
    deck.focus();
    fireEvent.contextMenu(deck);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Surrender" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(deck);
    expect(screen.getByTestId("menu-flag").textContent).toBe("false");
  });

  it("opens no menu on a rival's or partner's deck", () => {
    const { container } = render(<Rooftop />);
    for (const deck of decks(container).filter((button) => button.getAttribute("aria-haspopup") !== "menu")) {
      fireEvent.click(deck);
      fireEvent.contextMenu(deck);
    }
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens no menu once the duel is over", () => {
    const { container } = render(<Rooftop surrender={{ available: false }} />);
    expect(openers(container)).toHaveLength(0);
  });
});
