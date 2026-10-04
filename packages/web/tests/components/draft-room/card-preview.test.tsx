// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const cards = Array.from({ length: 8 }, (_, i) => makeCard(i + 1));
const config = { packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 40, pickSeconds: 60 };
const card = (id: number) => screen.getByRole("button", { name: `Card ${id}` });
const preview = () => document.querySelector<HTMLElement>(".dr .pv");

let phone = false;
let mouse = true;

beforeEach(() => {
  phone = false;
  mouse = true;
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      query === "(max-width: 900px)"
        ? phone
        : query === "(hover: hover)" || query === "(hover: hover) and (pointer: fine)"
          ? mouse
          : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("stage")) return new DOMRect(0, 0, 1232, 1022);
    if (this.classList.contains("face")) return new DOMRect(500, 600, 100, 146);
    return new DOMRect();
  });
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useDraftStore.setState({
    slug: "d", packRound: 1, pickStep: 1, currentPack: cards, myPool: [],
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

const renderRoom = () => render(<DraftRoom slug="d" name="Friday" config={config} isParticipant />);

describe("the large card preview in the draft room", () => {
  it("opens about 120ms after the pointer reaches a card, with the big image", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    expect(preview()).toBeNull();
    await waitFor(() => expect(preview()).not.toBeNull());
    const img = preview()!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/c/1.jpg");
    expect(preview()!.getAttribute("aria-hidden")).toBe("true");
    // it grows out of the card, inside the stage
    expect(preview()!.style.transform).toMatch(/^translate\(/);
    expect(parseFloat(preview()!.style.width)).toBeGreaterThanOrEqual(300);
  });

  it("closes at once when the pointer leaves", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.pointerLeave(card(1));
    expect(preview()).toBeNull();
  });

  it("swaps to the next card without a wait", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.pointerLeave(card(1));
    fireEvent.pointerEnter(card(2));
    expect(preview()?.querySelector("img")?.getAttribute("src")).toBe("/c/2.jpg");
  });

  it("still picks exactly as before: the preview takes no clicks", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.click(card(1));
    expect(card(1)).toHaveAttribute("data-sel");
    fireEvent.click(card(1));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/drafts/d/pick", expect.anything()));
  });

  it("takes over from the hologram while a card is hovered, and gives it back afterwards", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(3));
    const holo = () => document.querySelector(".dr .holo");
    await waitFor(() => expect(holo()).toHaveAttribute("data-on"));
    fireEvent.pointerEnter(card(1));
    // crossing a card does not blink the hologram: it waits for the preview
    expect(preview()).toBeNull();
    expect(holo()).toHaveAttribute("data-on");
    await waitFor(() => expect(preview()).not.toBeNull());
    await waitFor(() => expect(holo()).not.toHaveAttribute("data-on"));
    fireEvent.pointerLeave(card(1));
    await waitFor(() => expect(holo()).toHaveAttribute("data-on"));
  });

  it("is not used on a phone", async () => {
    phone = true;
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(preview()).toBeNull();
  });

  it("is not used without a mouse", async () => {
    mouse = false;
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.pointerEnter(card(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(preview()).toBeNull();
  });

  it("opens for a card the keyboard has focused, and closes when focus leaves", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    const original = HTMLElement.prototype.matches;
    vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, sel: string) {
      return sel === ":focus-visible" ? true : original.call(this, sel);
    });
    act(() => card(2).focus());
    await waitFor(() => expect(preview()).not.toBeNull());
    expect(preview()!.querySelector("img")!.getAttribute("src")).toBe("/c/2.jpg");
    act(() => card(2).blur());
    expect(preview()).toBeNull();
  });
});
