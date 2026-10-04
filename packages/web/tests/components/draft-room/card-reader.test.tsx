// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CardReader,
  TAG_CHOSEN,
  TAG_POINTING,
  type ReaderProps,
} from "../../../src/components/draft/room/card-reader";
import type { RoomCard } from "../../../src/components/draft/room/room-model";

const mk = (id: number, over: Partial<RoomCard> = {}): RoomCard => ({
  id,
  passcode: id + 100000,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "LIGHT",
  race: "Fairy",
  level: 4,
  atk: 1800,
  def: 1200,
  effectText: "Does a thing.",
  imageUrl: `/c/${id}.jpg`,
  imageUrlSmall: `/c/${id}s.jpg`,
  ...over,
});

const monster = mk(1, { name: "Maiden", atk: 3000, def: 2500 });
const spell = mk(2, { name: "Heavy Storm", type: "Quick-Play Spell Card", frameType: "spell", spellTrapType: "Quick-Play", atk: undefined, def: undefined, attribute: undefined, race: undefined, level: undefined });
const trap = mk(3, { name: "Judgment", type: "Counter Trap Card", frameType: "trap", spellTrapType: "Counter", atk: undefined, def: undefined, attribute: undefined, race: undefined, level: undefined });

const props = (over: Partial<ReaderProps> = {}): ReaderProps => ({
  card: monster,
  tag: TAG_POINTING,
  buttonHidden: false,
  pickable: false,
  chosen: null,
  myTurn: true,
  waitingOn: [],
  showWaiting: false,
  phone: false,
  onPick: vi.fn(),
  onClose: vi.fn(),
  ...over,
});

const dock = () => within(screen.getByRole("complementary", { name: "Card reader" }));
const main = () => document.querySelector(".insp-info .insp-main") as HTMLElement;

describe("the card dock", () => {
  afterEach(cleanup);

  it("shows a monster's name, type line and ATK and DEF numerals", () => {
    render(<CardReader {...props()} />);
    expect(main().querySelector(".insp-name")?.textContent).toBe("Maiden");
    expect(main().querySelector(".insp-type")?.textContent).toBe("Effect Monster, Level 4, LIGHT, Fairy");
    const stats = main().querySelector(".insp-stats") as HTMLElement;
    expect(stats.hasAttribute("data-empty")).toBe(false);
    expect(Array.from(stats.querySelectorAll("span"), (s) => s.textContent)).toEqual(["ATK3000", "DEF2500"]);
    expect(Array.from(stats.querySelectorAll("b"), (b) => b.textContent)).toEqual(["3000", "2500"]);
    expect(document.querySelector(".insp-text")?.textContent).toBe("Does a thing.");
  });

  it.each([
    [spell, "Spell, Quick-Play"],
    [trap, "Trap, Counter"],
  ])("keeps the stats row for %#, empty, so the dock does not jump", (card, line) => {
    render(<CardReader {...props({ card })} />);
    expect(main().querySelector(".insp-type")?.textContent).toBe(line);
    const stats = main().querySelector(".insp-stats") as HTMLElement;
    expect(stats).toBeTruthy();
    expect(stats.hasAttribute("data-empty")).toBe(true);
    expect(stats.children).toHaveLength(0);
  });

  it("keeps every slot when no card is shown, and explains how to choose", () => {
    render(<CardReader {...props({ card: null, tag: "" })} />);
    expect(main().getAttribute("aria-hidden")).toBe("true");
    expect(main().querySelector(".insp-stats")).toBeTruthy();
    expect(document.querySelector(".insp-art")?.getAttribute("data-empty")).toBe("true");
    expect(document.querySelector(".insp-text")?.textContent).toMatch(/Point at a card to read it/);
  });

  it("labels the card as pointed at or chosen", () => {
    const { rerender } = render(<CardReader {...props()} />);
    const head = () => document.querySelector(".insp-head") as HTMLElement;
    expect(head().textContent).toBe("Pointing at");
    expect(head().getAttribute("data-tag")).toBeNull();
    rerender(<CardReader {...props({ tag: TAG_CHOSEN })} />);
    expect(head().textContent).toBe("Chosen");
    expect(head().getAttribute("data-tag")).toBe("chosen");
  });

  it("makes the Pick button follow the chosen card, not the card on show", () => {
    const onPick = vi.fn();
    render(<CardReader {...props({ card: spell, pickable: true, chosen: monster, onPick })} />);
    const button = dock().getByRole("button", { name: /Pick Maiden/ });
    expect(button).toBeEnabled();
    expect(dock().queryByRole("button", { name: /Heavy Storm/ })).toBeNull();
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("disables Pick and says Choose a card while nothing is chosen, even when pointing at a card", () => {
    render(<CardReader {...props()} />);
    const button = dock().getByRole("button", { name: /Choose a card/ });
    expect(button).toBeDisabled();
  });

  it("gives the reason on a disabled Pick when the chosen card is capped", () => {
    render(<CardReader {...props({ chosen: monster, blockedNote: "You have 3" })} />);
    expect(dock().getByRole("button", { name: /You have 3/ })).toBeDisabled();
  });

  it("reads Picked once the pick is in, and hides the button when the draft is done", () => {
    const { rerender } = render(<CardReader {...props({ myTurn: false })} />);
    expect(dock().getByRole("button", { name: /Picked/ })).toBeDisabled();
    rerender(<CardReader {...props({ buttonHidden: true })} />);
    expect(document.querySelector<HTMLElement>(".pick-btn")?.hidden).toBe(true);
  });

  it("puts the key hints under the button", () => {
    render(<CardReader {...props()} />);
    const act = document.querySelector(".insp-act") as HTMLElement;
    expect(act.firstElementChild?.classList.contains("pick-btn")).toBe(true);
    expect(act.querySelector(".keys")?.textContent).toMatch(/1 to 9 or arrows choose/);
    expect(act.querySelector(".keys")?.textContent).toMatch(/\/ search/);
  });

  it("shows the notes under the last pick", () => {
    render(<CardReader {...props({ tag: "Your pick", myTurn: false, pickNote: "Time ran out. You got Maiden.", showWaiting: true, waitingOn: ["Bo", "Cy"] })} />);
    expect(dock().getByText("Time ran out. You got Maiden.")).toBeTruthy();
    expect(dock().getByText("Bo and Cy")).toBeTruthy();
  });
});
