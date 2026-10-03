// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// A card the player already holds three of is shown as unavailable, with the reason, and cannot be picked.

const mk = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  passcode: id + 100000,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  attribute: "DARK",
  level: 4,
  atk: 1000,
  def: 1000,
  effectText: "Does a thing.",
  imageUrl: `/c/${id}.jpg`,
  imageUrlSmall: `/c/${id}s.jpg`,
  ...over,
});

const seats = [
  { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
  { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
];

function load(over: Record<string, unknown> = {}) {
  useDraftStore.setState({
    slug: "d",
    packRound: 1,
    pickStep: 1,
    currentPack: [mk(1, { held: 3, blocked: true }), mk(2, { held: 1, blocked: false }), mk(3, { held: 0, blocked: false })],
    myPool: [],
    seats,
    timerSeconds: 40,
    isMyTurn: true,
    passed: false,
    completed: false,
    pickSeconds: 60,
    ...over,
  } as never);
}

const config = { packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 };
const renderRoom = () => render(<DraftRoom slug="d" name="Friday" config={config as never} isParticipant />);
const card = (id: number) => document.body.querySelector(`.tcard[data-id="${id}"]`) as HTMLElement;
const reader = () => within(screen.getByRole("complementary", { name: "Card reader" }));

describe("draft room blocked cards", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);
    load();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks a capped card unavailable with the reason and leaves the others alone", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());

    expect(card(1).hasAttribute("data-blocked")).toBe(true);
    expect(card(1).getAttribute("aria-disabled")).toBe("true");
    expect(card(1).querySelector(".cap")?.textContent).toBe("You have 3");
    expect(card(1).getAttribute("aria-label")).toBe("Card 1. You have 3, cannot be picked");
    for (const id of [2, 3]) {
      expect(card(id).hasAttribute("data-blocked")).toBe(false);
      expect(card(id).querySelector(".cap")).toBeNull();
    }
    // The room is still the player's turn: only the capped card is unavailable.
    expect(document.body.querySelector(".dr")?.getAttribute("data-turn")).toBe("picking");
  });

  it("does not pick a capped card on a second click, and the reader gives the reason", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());

    fireEvent.click(card(1));
    const button = reader().getByRole("button", { name: /You have 3/ });
    expect(button).toBeDisabled();
    fireEvent.click(card(1));
    fireEvent.click(button);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(useDraftStore.getState().myPool).toEqual([]);
  });

  it("does not pick a capped card with Enter, and still picks an allowed one", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());

    fireEvent.keyDown(document, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "3" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ cardId: 3 });
  });

  it("the store refuses to take a capped card", () => {
    useDraftStore.getState().pickCard(1);
    expect(useDraftStore.getState().myPool).toEqual([]);
    expect(useDraftStore.getState().currentPack).toHaveLength(3);
    useDraftStore.getState().pickCard(2);
    expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([2]);
  });

  it("tells a player who passed the pick that they pass and who is still picking", async () => {
    load({
      currentPack: [],
      isMyTurn: false,
      passed: true,
      seats: [{ ...seats[0], hasPicked: true }, seats[1]],
    });
    renderRoom();

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("You pass this pick"));
    expect(screen.getByRole("status").textContent).toContain("Bo");
  });
});
