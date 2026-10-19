// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const getDuelCards = vi.hoisted(() => vi.fn());
vi.mock("@/components/duel/api", () => ({ getDuelCards }));

import { LOCATION_GRAVE, TYPE_EFFECT, TYPE_MONSTER, TYPE_SPSUMMON } from "@/components/duel/constants";
import { PileViewer } from "@/components/duel/pile-viewer";

afterEach(() => {
  cleanup();
  getDuelCards.mockReset();
});

function card(sequence: number, over: Partial<DuelCard> = {}): DuelCard {
  return {
    controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code: 1000 + sequence, name: `Card ${sequence} name`,
    description: `Effect text of card ${sequence}.`, type: TYPE_MONSTER | TYPE_EFFECT, attack: 2400, defense: 2000, level: 7,
    attribute: 32, race: "Dragon", ...over,
  };
}

const view = (cards: DuelCard[], onHoverCard = vi.fn(), onInspectCard = vi.fn()) =>
  render(<PileViewer title="Your Graveyard" cards={cards} owner="you" open onClose={vi.fn()} onInspectCard={onInspectCard} onHoverCard={onHoverCard} reducedMotion />);

// The window shows no card text: the left drawer of the room shows the hovered card (the window only reports it).
describe("pile viewer card details go to the drawer", () => {
  it("has no detail block with the effect text", () => {
    view([card(0), card(1)]);
    expect(screen.queryByTestId("pile-card-text")).toBeNull();
    expect(screen.queryByText(/Effect text of card/)).toBeNull();
  });

  it("reports the hovered card, and goes back to the focused card when the pointer leaves the grid", () => {
    const onHoverCard = vi.fn();
    view([card(0), card(1), card(2)], onHoverCard);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Card 1 name, 2 of 3/ }));
    expect(onHoverCard).toHaveBeenLastCalledWith(expect.objectContaining({ sequence: 1 }));
    fireEvent.mouseLeave(screen.getByRole("list", { name: /newest first/ }));
    // The top card has focus from the start: the drawer goes back to it.
    expect(onHoverCard).toHaveBeenLastCalledWith(expect.objectContaining({ sequence: 2 }));
  });

  it("reports the focused card, and null on blur", () => {
    const onHoverCard = vi.fn();
    view([card(0), card(1)], onHoverCard);
    const tile = screen.getByRole("button", { name: /^Card 0 name, 2 of 2/ });
    fireEvent.focus(tile);
    expect(onHoverCard).toHaveBeenLastCalledWith(expect.objectContaining({ sequence: 0 }));
    fireEvent.blur(tile);
    expect(onHoverCard).toHaveBeenLastCalledWith(null);
  });

  it("keeps opening the card inspector on a click", () => {
    const onInspectCard = vi.fn();
    view([card(0), card(1)], vi.fn(), onInspectCard);
    fireEvent.click(screen.getByRole("button", { name: /^Card 0 name, 2 of 2/ }));
    expect(onInspectCard).toHaveBeenCalledWith(expect.objectContaining({ sequence: 0 }));
  });

  it("names a pile card by the looked-up name in its label when the engine sends none", async () => {
    getDuelCards.mockResolvedValue({
      cards: [{ code: 2001, name: "Red-Eyes Alternative Black Dragon", description: "Text.", type: TYPE_MONSTER | TYPE_EFFECT, attack: 2400, defense: 2000, level: 7, attribute: 32, race: "Dragon" }],
    });
    view([card(0, { code: 2001, name: undefined, description: undefined })]);
    expect(await screen.findByRole("button", { name: /^Red-Eyes Alternative Black Dragon, 1 of 1/ })).toBeTruthy();
  });
});
