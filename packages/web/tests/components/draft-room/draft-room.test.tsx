// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const mk = (id: number, over: Record<string, unknown> = {}) => ({
  id,
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
    currentPack: [mk(1), mk(2, { name: "Spell Two", type: "Normal Spell Card", frameType: "spell" }), mk(3)],
    myPool: [],
    seats,
    timerSeconds: 40,
    isMyTurn: true,
    completed: false,
    pickSeconds: 60,
    ...over,
  } as never);
}

const config = { packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 };
const renderRoom = (cfg: Record<string, unknown> = config) =>
  render(<DraftRoom slug="d" name="Friday" config={cfg as never} isParticipant />);
const card = (id: number) => document.body.querySelector(`.tcard[data-id="${id}"]`) as HTMLElement;

describe("DraftRoom", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);
    load();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the pack on the table in a locked full-screen layer", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(card(2)).toBeTruthy();
    expect(card(3)).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.querySelector(".dr")?.getAttribute("data-turn")).toBe("picking");
  });

  it("a click selects and a second click picks", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    expect(card(1).getAttribute("data-sel")).not.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(card(1));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/drafts/d/pick");
    expect(JSON.parse(init.body)).toEqual({ cardId: 1 });
    expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([1]);
  });

  it("keys 1-9 choose, Enter picks", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.keyDown(document, { key: "2" });
    expect(card(2).getAttribute("data-sel")).not.toBeNull();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(card(3).getAttribute("data-sel")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Enter" });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ cardId: 3 });
  });

  it("does not pick when it is no longer your turn", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    act(() => useDraftStore.setState({ isMyTurn: false }));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("picks the selected card once when the clock reaches 2s", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(2));
    act(() => useDraftStore.setState({ timerSeconds: 3 }));
    expect(global.fetch).not.toHaveBeenCalled();
    act(() => useDraftStore.setState({ timerSeconds: 2 }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ cardId: 2 });
    act(() => useDraftStore.setState({ timerSeconds: 1 }));
    act(() => useDraftStore.setState({ timerSeconds: 0 }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends no pick at 2s with nothing selected, even when hovering", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.mouseEnter(card(1));
    fireEvent.mouseOver(card(1));
    act(() => useDraftStore.setState({ timerSeconds: 2 }));
    act(() => useDraftStore.setState({ timerSeconds: 0 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not auto-pick when it is not your turn", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    act(() => useDraftStore.setState({ isMyTurn: false, timerSeconds: 1 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("saves the animations setting", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /animations/i })[0]);
    const menu = await screen.findByRole("dialog", { name: "Animations" });
    fireEvent.click(within(menu).getByRole("button", { name: /off/i }));
    expect(localStorage.getItem("yugidraft-room-motion")).toBe("off");
    expect(document.body.querySelector(".dr")?.getAttribute("data-motion")).toBe("off");
  });

  it("hides the wheel tab in a theme draft", async () => {
    load({ currentPack: [mk(1), mk(2)] });
    renderRoom({ ...config, mode: "theme", themePackSize: 2 });
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.queryByText(/taken by others/i)).toBeNull();
    expect(document.body.querySelector(".dr")?.getAttribute("data-mode")).toBe("theme");
  });

  it("restores the page behind it on unmount", async () => {
    const { unmount } = renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
