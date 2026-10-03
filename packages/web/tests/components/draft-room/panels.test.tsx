// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

import { DraftRoom } from "../../../src/components/draft/room/draft-room";

const card = (id: number) => ({
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
});

function roomLayout(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      (width <= 900 && query === "(max-width: 900px)") ||
      (width >= 901 && width <= 1359 && query === "(max-width: 1359px) and (min-width: 901px)"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

async function renderRoom() {
  render(
    <DraftRoom
      slug="d"
      name="Friday"
      config={{ packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 }}
      isParticipant
    />,
  );
  await screen.findByRole("button", { name: "Card 1" });
}

const reader = () => document.body.querySelector<HTMLElement>(".dr .insp")!;
const binder = () => document.body.querySelector<HTMLElement>(".dr .binder")!;
const readerPanel = () => reader().parentElement!;
const binderPanel = () => binder().parentElement!;
const dial = () => screen.getByRole("button", { name: /open your picks/i });

describe("Draft room panels", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("yugidraft-room-motion", "off");
    roomLayout(390);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    useDraftStore.setState({
      slug: "d",
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
  });

  it("keeps closed phone sheets mounted and inert", async () => {
    await renderRoom();

    expect(readerPanel()).toHaveAttribute("inert");
    expect(binderPanel()).toHaveAttribute("inert");
    expect(reader().closest("[hidden]")).toBeNull();
    expect(binder().closest("[hidden]")).toBeNull();
  });

  it("keeps focus on the card while its phone reader is open and on close", async () => {
    const user = userEvent.setup();
    await renderRoom();
    const opener = screen.getByRole("button", { name: "Card 1" });
    act(() => opener.focus());

    expect(readerPanel()).not.toHaveAttribute("inert");
    expect(binderPanel()).toHaveAttribute("inert");
    expect(opener).toHaveFocus();
    const close = within(reader()).getByRole("button", { name: "Close" });

    await user.click(close);

    await waitFor(() => expect(opener).toHaveFocus());
    expect(readerPanel()).toHaveAttribute("inert");
    expect(opener).not.toHaveAttribute("data-sel");
    expect(screen.getByRole("dialog", { name: "Draft room" })).not.toHaveAttribute("data-sheet");
  });

  it("opens the phone reader when Tabbing onto a card without moving focus off the card", async () => {
    const user = userEvent.setup();
    await renderRoom();
    // jsdom and user-event do not honor inert. Let Tab traversal skip inert ancestors as browsers do.
    const inertStyle = document.createElement("style");
    inertStyle.textContent = "[inert] { visibility: hidden; }";
    document.head.appendChild(inertStyle);
    try {
      await user.tab();
      expect(screen.getByRole("link", { name: "Back to drafts" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: /animations:/i })).toHaveFocus();
      await user.tab();

      expect(screen.getByRole("button", { name: "Card 1" })).toHaveFocus();
      expect(readerPanel()).not.toHaveAttribute("inert");
      expect(screen.getByRole("dialog", { name: "Draft room" })).toHaveAttribute("data-sheet", "card");

      await user.tab();
      const second = screen.getByRole("button", { name: "Card 2" });
      expect(second).toHaveFocus();
      await user.keyboard("{Escape}");

      expect(second).toHaveFocus();
      expect(readerPanel()).toHaveAttribute("inert");
    } finally {
      inertStyle.remove();
    }
  });

  it("keeps focus on the phone card selected with a number key", async () => {
    await renderRoom();
    fireEvent.keyDown(document.body, { key: "2" });

    const selected = screen.getByRole("button", { name: "Card 2" });
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute("data-sel");
    expect(readerPanel()).not.toHaveAttribute("inert");

    fireEvent.keyDown(selected, { key: "Escape" });

    expect(selected).toHaveFocus();
    expect(readerPanel()).toHaveAttribute("inert");
  });

  it("keeps focus on a phone card clicked to open its reader", async () => {
    const user = userEvent.setup();
    await renderRoom();
    const selected = screen.getByRole("button", { name: "Card 1" });
    await user.click(selected);

    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute("data-sel");
    expect(readerPanel()).not.toHaveAttribute("inert");
  });

  it("opens the binder with focus inside and returns focus to the dial on close", async () => {
    await renderRoom();
    const opener = dial();
    act(() => opener.focus());
    fireEvent.click(opener);

    expect(binderPanel()).not.toHaveAttribute("inert");
    expect(readerPanel()).toHaveAttribute("inert");
    await waitFor(() => expect(within(binder()).getByRole("button", { name: "Close" })).toHaveFocus());

    fireEvent.click(within(binder()).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(opener).toHaveFocus());
    expect(binderPanel()).toHaveAttribute("inert");
  });

  it("returns focus to a non-card reader opener when Escape closes it", async () => {
    await renderRoom();
    const opener = screen.getByRole("button", { name: /animations:/i });
    act(() => opener.focus());
    // A programmatic click opens the reader without focusing the table card.
    fireEvent.click(screen.getByRole("button", { name: "Card 1" }));
    const close = within(reader()).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.keyDown(close, { key: "Escape" });

    await waitFor(() => expect(opener).toHaveFocus());
    expect(readerPanel()).toHaveAttribute("inert");
  });

  it("returns focus to the binder opener when the scrim closes it", async () => {
    await renderRoom();
    const opener = dial();
    act(() => opener.focus());
    fireEvent.click(opener);
    await waitFor(() => expect(binderPanel().contains(document.activeElement)).toBe(true));

    fireEvent.click(document.body.querySelector(".dr .scrim")!);

    await waitFor(() => expect(opener).toHaveFocus());
    expect(binderPanel()).toHaveAttribute("inert");
  });

  it.each([901, 1100, 1359])("keeps the closed binder drawer inert at %ipx", async (width) => {
    roomLayout(width);
    await renderRoom();

    expect(binderPanel()).toHaveAttribute("inert");
    expect(readerPanel()).not.toHaveAttribute("inert");
    expect(binder().closest("[hidden]")).toBeNull();

    const card = screen.getByRole("button", { name: "Card 1" });
    act(() => card.focus());

    expect(card).toHaveFocus();
    expect(readerPanel()).not.toHaveAttribute("inert");
    expect(binderPanel()).toHaveAttribute("inert");
  });

  it.each(["close button", "Escape", "scrim", "dial"])(
    "returns focus to the medium drawer opener when closed with %s",
    async (method) => {
      roomLayout(1100);
      await renderRoom();
      const opener = dial();
      act(() => opener.focus());
      fireEvent.click(opener);

      expect(binderPanel()).not.toHaveAttribute("inert");
      expect(readerPanel()).not.toHaveAttribute("inert");
      const close = within(binder()).getByRole("button", { name: "Close" });
      await waitFor(() => expect(close).toHaveFocus());

      if (method === "Escape") fireEvent.keyDown(close, { key: "Escape" });
      else if (method === "scrim") fireEvent.click(document.body.querySelector(".dr .scrim")!);
      else if (method === "dial") fireEvent.click(opener);
      else fireEvent.click(within(binder()).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(opener).toHaveFocus());
      expect(binderPanel()).toHaveAttribute("inert");
      expect(readerPanel()).not.toHaveAttribute("inert");
      expect(screen.getByRole("dialog", { name: "Draft room" })).not.toHaveAttribute("data-binder");
    },
  );

  it("moves focus into the medium drawer opened by a kind tile and returns it on close", async () => {
    roomLayout(1100);
    await renderRoom();
    const opener = screen.getByRole("button", { name: /monsters\. show them/i });
    act(() => opener.focus());
    fireEvent.click(opener);

    expect(binderPanel()).not.toHaveAttribute("inert");
    await waitFor(() => expect(binderPanel().contains(document.activeElement)).toBe(true));

    fireEvent.click(within(binder()).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(opener).toHaveFocus());
    expect(opener).toHaveAttribute("aria-pressed", "true");
    expect(binderPanel()).toHaveAttribute("inert");
  });

  it.each([1360, 1440])("keeps both wide desktop panels active at %ipx", async (width) => {
    roomLayout(width);
    await renderRoom();

    expect(readerPanel()).not.toHaveAttribute("inert");
    expect(binderPanel()).not.toHaveAttribute("inert");

    const opener = screen.getByRole("button", { name: "Card 1" });
    act(() => opener.focus());

    expect(readerPanel()).not.toHaveAttribute("inert");
    expect(binderPanel()).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });
});
