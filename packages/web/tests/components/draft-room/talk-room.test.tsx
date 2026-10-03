// @vitest-environment jsdom
import React from "react";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../../src/lib/stores/draft-store";
import { useTalkStore } from "../../../src/lib/stores/talk-store";

vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `--mock-${name}`, className: name });
  return {
    Newsreader: font("newsreader"),
    Oxanium: font("oxanium"),
    Sofia_Sans_Extra_Condensed: font("sofia-c"),
    Sofia_Sans_Semi_Condensed: font("sofia-sc"),
  };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

import { DraftRoom } from "../../../src/components/draft/room/draft-room";
// With animations Off the pack ribbon holds the table for 1.3 s before the cards show, as in the mock.
configure({ asyncUtilTimeout: 4000 });


const card = (id: number) => ({
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
});

const fetchMock = vi.fn();

async function renderRoom(isParticipant = true) {
  render(
    <DraftRoom slug="d y" name="Friday" config={{ packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 }} isParticipant={isParticipant} />,
  );
  await screen.findByRole("button", { name: "Card 1" });
}

const sayButton = () => screen.getAllByRole("button", { name: "Say something to the table" })[0];

describe("table talk in the draft room", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("yugidraft-room-motion", "off");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    useTalkStore.getState().clear();
    useDraftStore.setState({
      slug: "d y",
      packRound: 1,
      pickStep: 1,
      currentPack: [card(1), card(2), card(3)],
      myPool: [],
      seats: [
        { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
        { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
      ],
      timerSeconds: 40,
      isMyTurn: true,
      completed: false,
      pickSeconds: 60,
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useTalkStore.getState().clear();
  });

  it("sends the chosen line's id to the talk route, then closes the menu", async () => {
    await renderRoom();
    fireEvent.click(sayButton());
    const menu = screen.getByRole("dialog", { name: "Say something to the table" });
    fireEvent.click(within(menu).getByRole("button", { name: "hurry up" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/drafts/d%20y/talk", expect.objectContaining({ method: "POST", body: JSON.stringify({ line: "hurry" }) })));
    expect(screen.queryByRole("dialog", { name: "Say something to the table" })).toBeNull();
  });

  it("holds the lines back for a moment after you spoke", async () => {
    await renderRoom();
    fireEvent.click(sayButton());
    fireEvent.click(screen.getByRole("button", { name: "gg" }));
    fireEvent.click(sayButton());
    for (const b of within(screen.getByRole("dialog", { name: "Say something to the table" })).getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("shows a line heard from the live feed over that friend's seat, and over your dial for yours", async () => {
    await renderRoom();
    act(() => useTalkStore.getState().hear(2, "nice"));
    act(() => useTalkStore.getState().hear(1, "gl"));
    const seat = document.querySelector('.seat[data-seat="1"]')!;
    expect(seat).toHaveAttribute("data-talk");
    expect(seat.querySelector(".bubble")).toHaveTextContent("Bonice");
    expect(document.querySelector(".chip-seat[data-talk] .say")).toHaveTextContent("nice");
    expect(document.querySelector(".disk > .bubble")).toHaveTextContent("gl");
  });

  it("closes the animations menu when the Say menu opens, and the other way round", async () => {
    await renderRoom();
    fireEvent.click(screen.getByRole("button", { name: /animations:/i }));
    expect(screen.getByRole("dialog", { name: "Animations" })).toBeInTheDocument();
    fireEvent.click(sayButton());
    expect(screen.queryByRole("dialog", { name: "Animations" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Say something to the table" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /animations:/i }));
    expect(screen.queryByRole("dialog", { name: "Say something to the table" })).toBeNull();
  });

  it("closes the Say menu with Escape and leaves the pick alone", async () => {
    await renderRoom();
    fireEvent.click(sayButton());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Say something to the table" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Say something to the table" })).toBeNull();
  });

  it("has no Say button for someone who is not drafting, but still shows what the table says", async () => {
    useDraftStore.setState({
      seats: [
        { seatIndex: 0, playerId: 5, displayName: "Zed", hasPicked: false, isCurrentPlayer: false },
        { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
      ],
    });
    await renderRoom(false);
    expect(screen.queryByRole("button", { name: "Say something to the table" })).toBeNull();
    act(() => useTalkStore.getState().hear(2, "gg"));
    expect(document.querySelector(".bubble")).toHaveTextContent("gg");
  });

  it("starts with a quiet table and clears it when the room goes away", async () => {
    useTalkStore.getState().hear(2, "lol");
    await renderRoom();
    expect(document.querySelector(".bubble")).toBeNull();
    act(() => useTalkStore.getState().hear(2, "lol"));
    cleanup();
    expect(useTalkStore.getState().heard).toEqual({});
  });
});
