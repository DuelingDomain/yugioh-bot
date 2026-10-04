// @vitest-environment jsdom
import React from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../../src/lib/stores/draft-store";

vi.mock("next/font/google", () => {
  const f = (name: string) => () => ({ variable: `--mock-${name}`, className: name });
  return {
    Newsreader: f("newsreader"),
    Oxanium: f("oxanium"),
    Sofia_Sans_Extra_Condensed: f("sofia-c"),
    Sofia_Sans_Semi_Condensed: f("sofia-sc"),
  };
});
vi.mock("next/link", () => ({ default: ({ children, ...p }: any) => <a {...p}>{children}</a> }));

import { DraftRoom } from "../../../src/components/draft/room/draft-room";
configure({ asyncUtilTimeout: 4000 });

const mk = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  passcode: id + 100000,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "LIGHT",
  race: "Fairy",
  level: 4,
  atk: 2500,
  def: 2100,
  effectText: "Does a thing.",
  imageUrl: `/c/${id}.jpg`,
  imageUrlSmall: `/c/${id}s.jpg`,
  ...over,
});
const spell = { name: "Heavy Storm", type: "Quick-Play Spell Card", frameType: "spell", spellTrapType: "Quick-Play", atk: undefined, def: undefined, attribute: undefined, race: undefined, level: undefined };

const seats = [
  { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
  { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
];
const config = { packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 };

const card = (id: number) => document.body.querySelector(`.tcard[data-id="${id}"]`) as HTMLElement;
const reader = () => within(screen.getByRole("complementary", { name: "Card reader" }));
const tag = () => document.querySelector(".insp-head span")?.textContent;

describe("the reader dock in the draft room", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // a desktop with a mouse
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);
    useDraftStore.setState({
      slug: "d",
      packRound: 1,
      pickStep: 1,
      currentPack: [mk(1), mk(2, spell), mk(3)],
      myPool: [],
      seats,
      timerSeconds: 40,
      isMyTurn: true,
      completed: false,
      pickSeconds: 60,
    } as never);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderRoom = async () => {
    render(<DraftRoom slug="d" name="Friday" config={config as never} isParticipant />);
    await waitFor(() => expect(card(1)).toBeTruthy());
  };

  it("puts the table first, then the dock with Pick in it, then the binder", async () => {
    await renderRoom();
    const stage = document.querySelector(".stage") as HTMLElement;
    const dock = document.querySelector(".dock") as HTMLElement;
    const pick = document.querySelector(".pick-btn") as HTMLElement;
    const binder = document.querySelector(".binder-panel") as HTMLElement;
    const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(stage, pick)).toBe(true);
    expect(dock.contains(pick)).toBe(true);
    expect(stage.contains(pick)).toBe(false);
    expect(after(dock, binder)).toBe(true);
    // Pick is the last control in the dock, under the card, with the key hints below it
    expect(dock.querySelector(".insp-act")?.firstElementChild).toBe(pick);
  });

  it("shows a monster's stats and a spell's empty stats row as the pointer moves over the cards", async () => {
    await renderRoom();
    fireEvent.pointerEnter(card(1));
    expect(tag()).toBe("Pointing at");
    expect(reader().getAllByRole("heading", { name: "Card 1" }).length).toBeGreaterThan(0);
    const stats = document.querySelector(".insp-info .insp-stats") as HTMLElement;
    expect(stats.querySelectorAll("b")).toHaveLength(2);
    expect(stats.textContent).toBe("ATK2500DEF2100");
    expect(document.querySelector(".insp-info .insp-type")?.textContent).toBe("Effect Monster, Level 4, LIGHT, Fairy");

    fireEvent.pointerLeave(card(1));
    fireEvent.pointerEnter(card(2));
    expect(reader().getAllByRole("heading", { name: "Heavy Storm" }).length).toBeGreaterThan(0);
    const spellStats = document.querySelector(".insp-info .insp-stats") as HTMLElement;
    expect(spellStats).toBeTruthy();
    expect(spellStats.hasAttribute("data-empty")).toBe(true);
    expect(document.querySelector(".insp-info .insp-type")?.textContent).toBe("Spell, Quick-Play");
  });

  it("keeps Pick on the chosen card while the pointer reads another, and returns to the chosen card when it leaves", async () => {
    await renderRoom();
    // nothing chosen yet: pointing at a card does not enable Pick
    fireEvent.pointerEnter(card(1));
    expect(reader().getByRole("button", { name: /Choose a card/ })).toBeDisabled();
    fireEvent.pointerLeave(card(1));

    fireEvent.click(card(3));
    expect(tag()).toBe("Chosen");
    expect(reader().getByRole("button", { name: /Pick Card 3/ })).toBeEnabled();

    fireEvent.pointerEnter(card(2));
    expect(tag()).toBe("Pointing at");
    expect(reader().getAllByRole("heading", { name: "Heavy Storm" }).length).toBeGreaterThan(0);
    expect(reader().getByRole("button", { name: /Pick Card 3/ })).toBeEnabled();

    fireEvent.pointerLeave(card(2));
    expect(tag()).toBe("Chosen");
    expect(reader().getAllByRole("heading", { name: "Card 3" }).length).toBeGreaterThan(0);
  });

  it("picks the chosen card from the dock button", async () => {
    await renderRoom();
    fireEvent.click(card(3));
    fireEvent.pointerEnter(card(2));
    fireEvent.click(reader().getByRole("button", { name: /Pick Card 3/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ cardId: 3 });
  });

  it("starts empty with a disabled Choose a card button and a hint", async () => {
    await renderRoom();
    expect(tag()).toBe("");
    expect(reader().getByRole("button", { name: /Choose a card/ })).toBeDisabled();
    expect(document.querySelector(".insp-text")?.textContent).toMatch(/Point at a card to read it/);
  });

  it("floats no hologram over the table on desktop, for hover or for the chosen card", async () => {
    await renderRoom();
    expect(document.querySelector(".holo")).toBeNull();
    fireEvent.pointerEnter(card(1));
    expect(document.querySelector(".holo")).toBeNull();
    fireEvent.pointerLeave(card(1));
    fireEvent.click(card(3));
    expect(document.querySelector(".holo")).toBeNull();
    expect(document.querySelector(".stage .portrait")).toBeNull();
    // the dock carries the card instead
    expect(reader().getAllByRole("heading", { name: "Card 3" }).length).toBeGreaterThan(0);
  });

  it("keeps the phone's small hologram in the card sheet, and none over the table", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 900px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await renderRoom();
    fireEvent.click(card(3));
    expect(document.querySelector(".holo")).toBeNull();
    expect(document.querySelector(".stage .portrait")).toBeNull();
    expect(document.querySelector(".dock .insp-mini .portrait")).toBeTruthy();
  });
});
