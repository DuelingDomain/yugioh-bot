// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useDraftStore } from "../../../src/lib/stores/draft-store";

vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `--mock-${name}`, className: name });
  return {
    Newsreader: font("newsreader"),
    Oxanium: font("oxanium"),
    Sofia_Sans_Extra_Condensed: font("sofia-c"),
    Sofia_Sans_Semi_Condensed: font("sofia-sc"),
  };
});
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

import { DraftRoom } from "../../../src/components/draft/room/draft-room";

const makeCard = (id: number) => ({
  id, passcode: id + 100000, name: `Card ${id}`, type: "Effect Monster", frameType: "effect", attribute: "DARK",
  level: 4, atk: 1000, def: 1000, effectText: "Does a thing.",
  imageUrl: `/c/${id}.jpg`, imageUrlSmall: `/c/${id}s.jpg`,
});
const cards = Array.from({ length: 60 }, (_, i) => makeCard(i + 1));
const config = { packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 40, pickSeconds: 60 };
const card = (id: number) => screen.getByRole("button", { name: `Card ${id}` });

let phone = false;
let reduced = false;
let stageWidth = 1440;
let stageHeight = 900;
let scrollIntoView: Mock<typeof Element.prototype.scrollIntoView>;

beforeEach(() => {
  phone = false;
  reduced = false;
  stageWidth = 1440;
  stageHeight = 900;
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 900px)" ? phone : query === "(prefers-reduced-motion: reduce)" && reduced,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("stage")
      ? new DOMRect(0, 0, phone ? 390 : stageWidth, phone ? 844 : stageHeight)
      : new DOMRect();
  });
  scrollIntoView = vi.fn<typeof Element.prototype.scrollIntoView>();
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useDraftStore.setState({
    slug: "d", packRound: 1, pickStep: 1, currentPack: cards.slice(0, 8), myPool: [],
    seats: [
      { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
      { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
    ],
    timerSeconds: 40, isMyTurn: true, completed: false, pickSeconds: 60,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderRoom = (overrides: React.ComponentProps<typeof DraftRoom>["config"] = {}) =>
  render(<DraftRoom slug="d" name="Friday" config={{ ...config, ...overrides }} isParticipant />);

describe("table card keyboard activation", () => {
  it("Space selects and a second Space picks through the click action", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(fireEvent.keyDown(card(1), { key: " " })).toBe(false);
    expect(card(1)).toHaveAttribute("data-sel");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.keyDown(card(1), { key: " " });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/drafts/d/pick", expect.objectContaining({ body: JSON.stringify({ cardId: 1 }) }));
  });

  it("ignores held Space before and after selection without scrolling", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(fireEvent.keyDown(card(1), { key: " ", repeat: true })).toBe(false);
    expect(card(1)).not.toHaveAttribute("data-sel");
    fireEvent.keyDown(card(1), { key: " " });
    expect(fireEvent.keyDown(card(1), { key: " ", repeat: true })).toBe(false);
    expect(card(1)).toHaveAttribute("data-sel");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Space on a focused phone card opens the reader without picking", async () => {
    phone = true;
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.keyDown(card(1), { key: " " });
    expect(card(1)).toHaveAttribute("data-sel");
    expect(document.querySelector(".dr")).toHaveAttribute("data-sheet", "card");
    act(() => card(1).focus());
    fireEvent.keyDown(card(1), { key: " " });
    expect(document.querySelector(".dr")).toHaveAttribute("data-sheet", "card");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([" ", "Enter"])("picks a focused selected card once with %s", async (key) => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    act(() => card(1).focus());
    expect(card(1)).toHaveFocus();
    fireEvent.keyDown(card(1), { key });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});

describe("tall table stages", () => {
  it.each([
    { phone: false, width: 790, height: 842, cols: 7, floor: 64, tableWidth: 568 },
    { phone: true, width: 390, height: 844, cols: 4, floor: 60, tableWidth: 292 },
  ])("uses the available columns and a flat table at $width x $height", async (size) => {
    phone = size.phone;
    stageWidth = size.width;
    stageHeight = size.height;
    useDraftStore.setState({ currentPack: cards });
    renderRoom({ packSize: 60 });
    await waitFor(() => expect(card(60)).toBeTruthy());
    const stage = screen.getByRole("region", { name: "Draft table" });
    const scene = stage.querySelector<HTMLElement>(".scene")!;
    expect(stage).toHaveAttribute("data-tall");
    expect(scene.style.getPropertyValue("--tilt")).toBe("0deg");
    expect(scene.style.getPropertyValue("--tw")).toBe(`${size.tableWidth}px`);
    expect(card(size.cols).style.getPropertyValue("--y")).toBe(card(1).style.getPropertyValue("--y"));
    expect(parseFloat(card(size.cols + 1).style.getPropertyValue("--y"))).toBeGreaterThan(parseFloat(card(1).style.getPropertyValue("--y")));
    for (const id of [1, size.cols, 60]) {
      expect(parseFloat(card(id).style.getPropertyValue("--w"))).toBeGreaterThanOrEqual(size.floor);
    }
  });

  it.each([false, true])("scrolls a focused card into view when reduced motion is %s", async (reduce) => {
    reduced = reduce;
    localStorage.setItem("yugidraft-room-motion", "full");
    useDraftStore.setState({ currentPack: cards });
    renderRoom({ packSize: 60 });
    await waitFor(() => expect(card(60)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Draft table" })).toHaveAttribute("data-tall");
    card(60).scrollIntoView = scrollIntoView;
    act(() => card(60).focus({ preventScroll: true }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: reduce ? "instant" : "smooth" });
  });

  it("does not scroll focused cards in a standard stage", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Draft table" })).not.toHaveAttribute("data-tall");
    card(1).scrollIntoView = scrollIntoView;
    act(() => card(1).focus());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("remeasures a dealt pack that is larger than the configured pack", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Draft table" })).not.toHaveAttribute("data-tall");
    act(() => useDraftStore.setState({ pickStep: 2, currentPack: cards }));
    await waitFor(() => expect(card(60)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Draft table" })).toHaveAttribute("data-tall");
  });

  it("keeps seats aligned when geometry is measured after scrolling", async () => {
    const { rerender } = renderRoom({ packSize: 60 });
    await waitFor(() => expect(card(1)).toBeTruthy());
    const stage = screen.getByRole("region", { name: "Draft table" });
    const anchor = stage.querySelector<HTMLElement>('.anchor[data-anchor="1"]')!;
    stage.scrollTop = 240;
    // An own method avoids reusing and changing the inherited prototype spy.
    anchor.getBoundingClientRect = vi.fn<typeof Element.prototype.getBoundingClientRect>(
      () => new DOMRect(160, 320 - stage.scrollTop, 2, 2),
    );
    rerender(<DraftRoom slug="d" name="Friday" config={{ ...config, packSize: 59 }} isParticipant />);
    expect(stage.querySelector('.seat[data-seat="1"]')).toHaveStyle({ left: "160px", top: "320px" });
  });

  it("uses the theme pack size and removes the tall attribute when it fits again", async () => {
    const { rerender } = renderRoom({ mode: "theme", themePackSize: 60 });
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.getByRole("region", { name: "Draft table" })).toHaveAttribute("data-tall");
    rerender(<DraftRoom slug="d" name="Friday" config={{ ...config, mode: "theme", themePackSize: 8 }} isParticipant />);
    expect(screen.getByRole("region", { name: "Draft table" })).not.toHaveAttribute("data-tall");
  });
});
