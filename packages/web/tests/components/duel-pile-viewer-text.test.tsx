// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const LONG_TEXT =
  "If this card is Special Summoned: You can target 1 monster in your GY; add it to your hand.\n" +
  "(2) Once per turn, during the End Phase: You can send 1 monster from your hand to the GY. " +
  "This is the last sentence of a long effect that must always be readable.";

function card(sequence: number, over: Partial<DuelCard> = {}): DuelCard {
  return {
    controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code: 1000 + sequence, name: `Card ${sequence} name`,
    description: `Effect text of card ${sequence}.`, type: TYPE_MONSTER | TYPE_EFFECT, attack: 2400, defense: 2000, level: 7,
    attribute: 32, race: "Dragon", ...over,
  };
}

const view = (cards: DuelCard[], onInspectCard = vi.fn()) =>
  render(<PileViewer title="Your Graveyard" cards={cards} owner="you" open onClose={vi.fn()} onInspectCard={onInspectCard} reducedMotion />);

describe("pile viewer detail", () => {
  it("shows the full effect text of the top card", () => {
    // Engine order: the last card is the top of the pile.
    view([card(0), card(1, { description: LONG_TEXT })]);
    const text = screen.getByTestId("pile-card-text");
    expect(text).toHaveTextContent("last sentence of a long effect that must always be readable.");
    expect(text.textContent).toContain("(2) Once per turn");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Card 1 name");
  });

  it("shows the text of a clicked card, and keeps it after the pointer leaves", () => {
    const onInspectCard = vi.fn();
    view([card(0), card(1), card(2)], onInspectCard);
    expect(screen.getByTestId("pile-card-text")).toHaveTextContent("Effect text of card 2.");
    const bottom = screen.getByRole("button", { name: /^Card 0 name, 3 of 3/ });
    fireEvent.click(bottom);
    expect(screen.getByTestId("pile-card-text")).toHaveTextContent("Effect text of card 0.");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Card 0 name");
    expect(onInspectCard).toHaveBeenCalledWith(expect.objectContaining({ sequence: 0 }));
  });

  it("looks up the effect text of a pile card that came without it", async () => {
    getDuelCards.mockResolvedValue({
      cards: [{ code: 2001, name: "Red-Eyes Alternative Black Dragon", description: "Looked up effect text.", type: TYPE_MONSTER | TYPE_EFFECT, attack: 2400, defense: 2000, level: 7, attribute: 32, race: "Dragon" }],
    });
    view([card(0, { code: 2001, name: undefined, description: undefined })]);
    await waitFor(() => expect(screen.getByTestId("pile-card-text")).toHaveTextContent("Looked up effect text."));
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Red-Eyes Alternative Black Dragon");
  });

  it("lists the materials of a card with the text", () => {
    const material = card(5, { location: 0x80, name: "Material One" });
    view([card(0, { materials: [material] })]);
    expect(screen.getByTestId("pile-card-text")).toHaveTextContent("Materials: Material One");
  });

  it("tells that a face-down card is hidden, with no text", () => {
    view([{ controller: 0, location: LOCATION_GRAVE, sequence: 0, position: 8 }]);
    expect(screen.getByTestId("pile-card-text")).toHaveTextContent("Face-down card. Its identity is not public.");
  });

  it("keeps the clicked card in the detail while the pointer crosses other cards, until it leaves the grid", () => {
    view([card(0), card(1), card(2)]);
    const text = () => screen.getByTestId("pile-card-text");
    fireEvent.click(screen.getByRole("button", { name: /^Card 0 name, 3 of 3/ }));
    expect(text()).toHaveTextContent("Effect text of card 0.");
    const other = screen.getByRole("button", { name: /^Card 1 name, 2 of 3/ });
    fireEvent.mouseEnter(other);
    expect(text()).toHaveTextContent("Effect text of card 1.");
    fireEvent.mouseLeave(screen.getByRole("list", { name: /newest first/ }));
    expect(text()).toHaveTextContent("Effect text of card 0.");
  });

  it("names a pile card by the looked-up name in its label when the engine sends none", async () => {
    getDuelCards.mockResolvedValue({
      cards: [{ code: 2001, name: "Red-Eyes Alternative Black Dragon", description: "Text.", type: TYPE_MONSTER | TYPE_EFFECT, attack: 2400, defense: 2000, level: 7, attribute: 32, race: "Dragon" }],
    });
    view([card(0, { code: 2001, name: undefined, description: undefined })]);
    expect(await screen.findByRole("button", { name: /^Red-Eyes Alternative Black Dragon, 1 of 1/ })).toBeTruthy();
  });
});
