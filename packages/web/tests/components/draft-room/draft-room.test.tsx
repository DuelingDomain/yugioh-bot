// @vitest-environment jsdom
import React from "react";
import { act, cleanup, configure, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// With animations Off the pack ribbon holds the table for 1.3 s before the cards show, as in the mock.
configure({ asyncUtilTimeout: 4000 });


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

function serverState(over: Record<string, unknown> = {}) {
  return {
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
  };
}

function load(over: Record<string, unknown> = {}) {
  useDraftStore.setState(serverState(over) as never);
}

const response = (over: Record<string, unknown> = {}) =>
  ({ ok: true, json: async () => serverState(over) }) as Response;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const resolvedStep = (id: number) => ({
  currentPack: [],
  myPool: [serverState().currentPack.find((c) => c.id === id)!],
  isMyTurn: false,
  seats: seats.map((s) => ({ ...s, hasPicked: s.isCurrentPlayer })),
});

const reader = () => within(screen.getByRole("complementary", { name: "Card reader" }));

const config = { packSize: 3, packsPerPlayer: 2, cardsPerPlayer: 6, pickSeconds: 60 };
const renderRoom = (cfg: Record<string, unknown> = config) =>
  render(<DraftRoom slug="d" name="Friday" config={cfg as never} isParticipant />);
const card = (id: number) => document.body.querySelector(`.tcard[data-id="${id}"]`) as HTMLElement;

describe("DraftRoom", () => {
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

  it("renders the pack on the table in a locked full-screen layer", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(card(2)).toBeTruthy();
    expect(card(3)).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.querySelector(".dr")?.getAttribute("data-turn")).toBe("picking");
  });

  it("holds the table empty while the pack ribbon plays, then deals the cards", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    renderRoom();
    await waitFor(() => expect(document.querySelector(".ribbon b")?.textContent).toBe("Pack 1"));
    expect((document.querySelector(".ribbon") as HTMLElement).style.visibility).toBe("visible");
    expect(document.querySelectorAll(".tcard")).toHaveLength(0);
    fireEvent.keyDown(document, { key: "1" });
    expect(document.querySelector("[data-sel]")).toBeNull();
    await waitFor(() => expect(card(1)).toBeTruthy(), { timeout: 3000 });
    expect((document.querySelector(".ribbon") as HTMLElement).style.visibility).toBe("hidden");
    expect(document.querySelectorAll(".tcard")).toHaveLength(3);
  });

  it("shows a pass inside a pack at once, with no ribbon", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    load({ pickStep: 3 });
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect((document.querySelector(".ribbon") as HTMLElement).style.visibility).toBe("hidden");
  });

  it("after a reload while waiting, the reader shows your last pick and who is left", async () => {
    load({
      currentPack: [],
      myPool: [mk(2, { name: "Spell Two", type: "Normal Spell Card", frameType: "spell" })],
      isMyTurn: false,
      seats: seats.map((s) => ({ ...s, hasPicked: s.isCurrentPlayer })),
    });
    renderRoom();
    await waitFor(() => expect(reader().getByText(/Waiting on/)).toBeTruthy());
    expect(reader().getByText("Bo")).toBeTruthy();
    expect(reader().getAllByRole("heading", { name: "Spell Two" }).length).toBeGreaterThan(0);
    expect(document.querySelector(".insp-head span")?.textContent).toBe("Your pick");
    expect(document.querySelectorAll(".tcard")).toHaveLength(0);
  });

  it("after a reload where you passed, the reader shows no pick and the pass line shows", async () => {
    load({
      currentPack: [],
      myPool: [mk(2, { name: "Spell Two", type: "Normal Spell Card", frameType: "spell" })],
      isMyTurn: false,
      passed: true,
      seats: seats.map((s) => ({ ...s, hasPicked: s.isCurrentPlayer })),
    });
    renderRoom();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("You pass this pick"));
    expect(screen.getByRole("status").textContent).toContain("Bo");
    expect(screen.queryByText("Your pick")).toBeNull();
    expect(document.querySelector(".insp-head span")?.textContent).not.toBe("Your pick");
    expect(reader().queryAllByRole("heading", { name: "Spell Two" })).toHaveLength(0);
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

  it("does not pick the selected card when Enter is pressed on the focused Back to drafts link", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    expect(card(1)).toHaveAttribute("data-sel");
    const link = screen.getByRole("link", { name: "Back to drafts" });
    act(() => link.focus());
    expect(link).toHaveFocus();

    const event = createEvent.keyDown(link, { key: "Enter" });
    fireEvent(link, event);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(card(1)).toHaveAttribute("data-sel");
  });

  it("chooses a card by digit while a filter button has focus", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    const filter = screen.getByRole("button", { name: "0 Monsters. Show them." });
    act(() => filter.focus());
    fireEvent.click(filter);
    expect(filter).toHaveFocus();

    const event = createEvent.keyDown(filter, { key: "3" });
    fireEvent(filter, event);
    expect(card(3)).toHaveAttribute("data-sel");
    expect(card(3)).toHaveFocus();
    expect(event.defaultPrevented).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "2"])(
    "leaves focus and selection alone for %s in the Animations dialog",
    async (key) => {
      renderRoom();
      await waitFor(() => expect(card(1)).toBeTruthy());
      act(() => card(1).focus());
      fireEvent.click(screen.getByRole("button", { name: /animations/i }));
      const menu = screen.getByRole("dialog", { name: "Animations" });
      const chosen = within(menu).getByRole("button", { pressed: true });
      expect(chosen).toHaveFocus();

      const event = createEvent.keyDown(chosen, { key });
      fireEvent(chosen, event);
      expect(chosen).toHaveFocus();
      expect(card(1)).toHaveAttribute("data-sel");
      expect(card(2)).not.toHaveAttribute("data-sel");
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it.each([
    { control: "binder breakdown toggle", role: "button", name: /Breakdown/ },
    { control: "tray counter", role: "button", name: "0 Monsters. Show them." },
    { control: "room link", role: "link", name: "Back to drafts" },
  ])("leaves arrow navigation alone when the $control has focus", async ({ role, name }) => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    act(() => card(1).focus());
    const control = screen.getByRole(role, { name });
    act(() => control.focus());

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      const event = createEvent.keyDown(control, { key });
      fireEvent(control, event);
      expect(control).toHaveFocus();
      expect(card(1)).toHaveAttribute("data-sel");
      expect(card(2)).not.toHaveAttribute("data-sel");
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it.each(["phone", "drawer"])("ignores card navigation while the %s binder overlay is open", async (viewport) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === (viewport === "phone" ? "(max-width: 900px)" : "(max-width: 1359px) and (min-width: 901px)"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      renderRoom();
      await waitFor(() => expect(card(1)).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Your picks: 0 of 6. Open your picks." }));
      const room = screen.getByRole("dialog", { name: "Draft room" });
      expect(room).toHaveAttribute(viewport === "phone" ? "data-sheet" : "data-binder", viewport === "phone" ? "binder" : "");

      for (const key of ["ArrowRight", "2"]) {
        const event = createEvent.keyDown(document.body, { key });
        fireEvent(document.body, event);
        expect(card(1)).not.toHaveAttribute("data-sel");
        expect(card(2)).not.toHaveAttribute("data-sel");
        expect(event.defaultPrevented).toBe(false);
      }

      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(room).not.toHaveAttribute(viewport === "phone" ? "data-sheet" : "data-binder");
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(card(1)).toHaveFocus();
      expect(card(1)).toHaveAttribute("data-sel");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves between focused table cards with arrow keys", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    act(() => card(1).focus());
    const event = createEvent.keyDown(card(1), { key: "ArrowRight" });
    fireEvent(card(1), event);
    expect(card(2)).toHaveFocus();
    expect(card(2)).toHaveAttribute("data-sel");
    expect(event.defaultPrevented).toBe(true);
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

  it("retries the selected deadline pick after an earlier request clears", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const firstPick = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstPick.promise)
      .mockResolvedValueOnce(response({ timerSeconds: 2 }))
      .mockResolvedValueOnce(response(resolvedStep(2)));
    global.fetch = fetchMock;
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    fireEvent.click(card(1));

    // A poll from before the first request restores the open step.
    act(() => load({ timerSeconds: 2 }));
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(2));
    expect(card(2).getAttribute("data-sel")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => firstPick.resolve({ ok: false, status: 400 } as Response));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/drafts/d/pick", "/api/drafts/d", "/api/drafts/d/pick",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ cardId: 2 });
    expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([2]);
  });

  it("submits a selection made inside the last 2s immediately", async () => {
    load({ timerSeconds: 1 });
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(card(2));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({ cardId: 2 });
  });

  it("shows the real pick when a successful response replaces the sent card", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    global.fetch = vi.fn().mockResolvedValue(response(resolvedStep(1)));
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    fireEvent.click(card(2));
    fireEvent.click(card(2));

    await waitFor(() => expect(reader().getByText("Time ran out. You got Card 1.")).toBeTruthy());
    expect(reader().getByText("Your pick")).toBeTruthy();
    expect(reader().queryAllByRole("heading", { name: "Spell Two" })).toHaveLength(0);
    expect(reader().getAllByRole("heading", { name: "Card 1" }).length).toBeGreaterThan(0);
    expect(card(1)).toBeNull();
    expect(card(2)).toBeTruthy();

    act(() => load({ pickStep: 2, currentPack: [mk(4), mk(5)], myPool: [mk(1)] }));
    await waitFor(() => expect(card(4)).toBeTruthy());
    expect(reader().queryByText(/Time ran out/)).toBeNull();
  });

  it("reconciles a rejected pick with the card in the refetched pool", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response)
      .mockResolvedValueOnce(response(resolvedStep(1)));
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    fireEvent.click(card(2));
    fireEvent.click(card(2));

    await waitFor(() => expect(reader().getByText("Time ran out. You got Card 1.")).toBeTruthy());
    expect(reader().queryAllByRole("heading", { name: "Spell Two" })).toHaveLength(0);
    expect(card(1)).toBeNull();
    expect(card(2)).toBeTruthy();
    expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([1]);
  });

  it("clears the last pick when a rejection refetch leaves the step open", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response)
      .mockResolvedValueOnce(response());
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    fireEvent.click(card(2));
    fireEvent.click(card(2));
    await waitFor(() => expect(useDraftStore.getState().isMyTurn).toBe(true));
    await waitFor(() => expect(card(2)).toBeTruthy());

    act(() => useDraftStore.setState({ isMyTurn: false, currentPack: [] }));
    expect(reader().queryByText("Your pick")).toBeNull();
    expect(reader().queryByText(/Time ran out/)).toBeNull();
    expect(reader().queryAllByRole("heading", { name: "Spell Two" })).toHaveLength(0);
  });

  it("shows a pick made in another tab without submitting locally", async () => {
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    act(() => useDraftStore.getState().setFromServer(serverState(resolvedStep(1)) as never));

    await waitFor(() => expect(reader().getByText("Time ran out. You got Card 1.")).toBeTruthy());
    expect(card(1)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows no timeout note for a card this client sent", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    global.fetch = vi.fn().mockResolvedValue(response(resolvedStep(2)));
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    fireEvent.click(card(2));
    fireEvent.click(card(2));

    await waitFor(() => expect(useDraftStore.getState().currentPack).toEqual([]));
    expect(reader().getByText("Your pick")).toBeTruthy();
    expect(reader().getAllByRole("heading", { name: "Spell Two" }).length).toBeGreaterThan(0);
    expect(reader().queryByText(/Time ran out/)).toBeNull();
  });

  it("remembers every card sent in this step when reconciling the real pick", async () => {
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response)
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(resolvedStep(2)));
    renderRoom();
    await waitFor(() => expect(card(2)).toBeTruthy());
    fireEvent.click(card(2));
    fireEvent.click(card(2));
    await waitFor(() => expect(useDraftStore.getState().isMyTurn).toBe(true));
    await waitFor(() => expect(card(1)).toBeTruthy());
    fireEvent.click(card(1));
    fireEvent.click(card(1));

    await waitFor(() => expect(useDraftStore.getState().myPool.map((c) => c.id)).toEqual([2]));
    expect(reader().getByText("Your pick")).toBeTruthy();
    expect(reader().getAllByRole("heading", { name: "Spell Two" }).length).toBeGreaterThan(0);
    expect(reader().queryByText(/Time ran out/)).toBeNull();
    expect(card(2)).toBeNull();
    expect(card(1)).toBeTruthy();
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

  it.each([390, 1440])("never shows what other players took when a pack returns at %ipx", async (width) => {
    localStorage.setItem("yugidraft-room-motion", "off");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: width <= 900 && query === "(max-width: 900px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    load({ currentPack: [mk(1), mk(2), mk(3)] });
    renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.queryByText(/back around/i)).not.toBeInTheDocument();

    act(() => useDraftStore.setState({
      currentPack: [], myPool: [mk(1)], isMyTurn: false,
      seats: seats.map((s) => ({ ...s, hasPicked: s.isCurrentPlayer })),
    }));
    await waitFor(() => expect(card(1)).toBeNull());

    act(() => useDraftStore.setState({ pickStep: 2, currentPack: [mk(4), mk(5)], isMyTurn: true, seats }));
    await waitFor(() => expect(card(4)).toBeTruthy());
    expect(screen.queryByText(/back around/i)).not.toBeInTheDocument();

    act(() => useDraftStore.setState({
      currentPack: [], myPool: [mk(1), mk(4)], isMyTurn: false,
      seats: seats.map((s) => ({ ...s, hasPicked: s.isCurrentPlayer })),
    }));
    await waitFor(() => expect(card(4)).toBeNull());

    // Card 3 returns from the first pack after another player took card 2.
    act(() => useDraftStore.setState({ pickStep: 3, currentPack: [mk(3)], isMyTurn: true, seats }));
    await waitFor(() => expect(card(3)).toBeTruthy());
    expect(screen.queryByText(/back around/i)).not.toBeInTheDocument();
    expect(document.body.querySelector(".dr .wheel")).toBeNull();
    expect(screen.queryByRole("button", { name: "See what went" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open your picks/i }));
    const binder = screen.getByRole("complementary", { name: "Your picks" });
    expect(Array.from(binder.querySelectorAll(".rn"), (el) => el.textContent)).toEqual(["Card 1", "Card 4"]);
    expect(screen.queryByText(/taken by others/i)).not.toBeInTheDocument();
  });

  it("shows only your picks in a theme draft", async () => {
    load({ currentPack: [mk(1), mk(2)] });
    renderRoom({ ...config, mode: "theme", themePackSize: 2 });
    await waitFor(() => expect(card(1)).toBeTruthy());
    expect(screen.queryByText(/taken by others/i)).toBeNull();
    expect(document.body.querySelector(".dr")?.getAttribute("data-mode")).toBe("theme");
  });

  it.each([
    { name: "booster", mode: "booster" as const },
    { name: "cube", mode: undefined },
  ])("preserves the whole-pool ring and counters in $name mode", async ({ mode }) => {
    localStorage.setItem("yugidraft-room-motion", "off");
    load({
      myPool: [
        mk(100),
        mk(101, { type: "Spell Card", frameType: "spell" }),
        mk(102, { type: "Trap Card", frameType: "trap" }),
        mk(103, { type: "Fusion Monster", frameType: "fusion" }),
      ],
    });
    renderRoom({ ...config, mode, cardsPerPlayer: 40 });

    const dial = await screen.findByRole("button", { name: "Your picks: 4 of 40. Open your picks." });
    const face = dial.querySelector<HTMLElement>(".face")!;
    expect(face.textContent).toBe("4");
    expect(within(dial).getByText("of 40")).toBeTruthy();
    expect(face.style.getPropertyValue("--mix")).toBe(
      "conic-gradient(var(--k-monster) 0% 2.5%, var(--k-spell) 2.5% 5%, var(--k-trap) 5% 7.5%, var(--k-extra) 7.5% 10%, rgb(255 255 255 / 0.07) 10% 100%)",
    );
    for (const label of ["Monsters", "Spells", "Traps", "Extra deck"]) {
      expect(screen.getByRole("button", { name: `1 ${label}. Show them.` })).toBeTruthy();
    }
  });

  it("resets the theme tray counts and dial mix for the Extra Deck phase", async () => {
    const main = [
      mk(10), mk(11),
      mk(12, { type: "Normal Spell Card", frameType: "spell" }),
      mk(13, { type: "Normal Trap Card", frameType: "trap" }),
    ];
    load({ myPool: main.slice(0, 3) });
    renderRoom({ ...config, mode: "theme", cardsPerPlayer: 4, extraDeckSize: 2 });
    await waitFor(() => expect(card(1)).toBeTruthy());
    const tray = within(screen.getByRole("region", { name: "Draft table" }));
    expect(tray.getByRole("button", { name: "2 Monsters. Show them." })).toBeTruthy();
    expect(tray.getByRole("button", { name: "1 Spells. Show them." })).toBeTruthy();

    act(() => useDraftStore.setState({ myPool: main } as never));
    expect(tray.getByRole("button", { name: "Your picks: 0 of 2. Open your picks." })).toBeTruthy();
    for (const kind of ["Monsters", "Spells", "Traps", "Extra deck"]) {
      expect(tray.getByRole("button", { name: `0 ${kind}. Show them.` })).toBeTruthy();
    }

    act(() => useDraftStore.setState({
      myPool: [...main, mk(14, { type: "Fusion Monster", frameType: "fusion" })],
    } as never));
    const dial = tray.getByRole("button", { name: "Your picks: 1 of 2. Open your picks." });
    expect(tray.getByRole("button", { name: "1 Extra deck. Show them." })).toBeTruthy();
    for (const kind of ["Monsters", "Spells", "Traps"]) {
      expect(tray.getByRole("button", { name: `0 ${kind}. Show them.` })).toBeTruthy();
    }
    const mix = dial.querySelector<HTMLElement>(".face")!.style.getPropertyValue("--mix");
    expect(mix.match(/\d+(?:\.\d+)?%/g)).toEqual(["0%", "50%", "50%", "100%"]);
  });

  it("restores the page behind it on unmount", async () => {
    const { unmount } = renderRoom();
    await waitFor(() => expect(card(1)).toBeTruthy());
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
