// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
import { newBoard } from "@/components/duel/fx-lab/board";
import { LOCATION_DMZONE } from "@/components/duel/constants";
import { getZoneSnapshot, resolveSource, clearZoneSnapshots } from "@/components/duel/move-plan";
import { BOARD_VIEW_KEY } from "@/components/duel/board-view";
import batches from "../fixtures/dm-summon-batches.json";

// The real 1v1 room, fed two consecutive views the way the poll feeds it: first the Deck Master in its zone, then the update
// of a click on "Normal Summon" on it. The events are a real batch (duel 67: the summon of Sage with Eyes of Blue, and its
// trigger chain in the same batch); the server sends no move out of the Deck Master Zone.
const { state, moveFx, summonFx } = vi.hoisted(() => ({
  state: { room: null as DuelRoom | null },
  moveFx: vi.fn(), summonFx: vi.fn(),
}));
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate: () => Promise.resolve() }), default: () => ({ data: state.room, error: null, isLoading: false, mutate: vi.fn(async () => {}) }) }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font, Barlow_Condensed: font, Barlow_Semi_Condensed: font };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({ useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/prompt-reveal", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/prompt-reveal")>(), usePromptReveal: () => true,
}));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: (props: unknown) => { moveFx(props); return null; } }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: (props: unknown) => { summonFx(props); return null; } }));
vi.mock("@/components/decks/api", () => ({ listSavedDecks: vi.fn(async () => []) }));
import { DuelRoomView } from "@/components/duel/room";

const batch = batches.sageChainBatch as unknown as { seat: number; deckMasterCode: number; events: DuelEvent[] };
const DM = { card: { code: batch.deckMasterCode, name: "Sage with Eyes of Blue" }, returns: 0, nextCost: 0 };

function roomOf(inZone: boolean, events: DuelEvent[], revision: number): DuelRoom {
  const room = makeSeriesRoom({ series: null, status: "active", mySeat: 0 });
  room.session.mode = "domain";
  const board = newBoard();
  board.seats[0].deckMaster = { ...DM, inZone } as never;
  board.seats[1].deckMaster = { card: { code: 48305365, name: "Axe Raider" }, inZone: true, returns: 0, nextCost: 0 } as never;
  room.engine = { revision, turn: 2, turnSeat: 0, phase: "main1", seats: board.seats, prioritySeat: 0, chain: [], events, log: [], result: null, prompt: null };
  return { ...room, serverTime: 1_000 + revision } as DuelRoom;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearZoneSnapshots();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  // Every element gets a box: jsdom has no layout, and a source must have a size to count.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ left: 20, top: 700, width: 90, height: 130, x: 20, y: 700, right: 110, bottom: 830, toJSON: () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

for (const mode of ["classic", "3d"] as const) {
  describe(`the 1v1 room, ${mode} board: a Deck Master summon from its zone`, () => {
    function open() {
      window.localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify({ v: 1, mode, tilt: "tilt" }));
      state.room = roomOf(true, [], 1);
      const view = render(<DuelRoomView slug="game-1" windowed />);
      return view;
    }
    const lastEvents = (fx: typeof moveFx): DuelEvent[] => fx.mock.calls.at(-1)?.[0].events;

    it("has a Deck Master plate to fly out of", async () => {
      open();
      await waitFor(() => expect(moveFx).toHaveBeenCalled());
      expect(Boolean(document.querySelector("[data-sv-plane]"))).toBe(mode === "3d");
      expect(document.querySelector('[data-master-source="0"]')).not.toBeNull();
    });

    it("shows the Deck Master panel as in use while it is out of the zone, with the next summon cost", async () => {
      const view = open();
      await waitFor(() => expect(moveFx).toHaveBeenCalled());
      expect(document.querySelector('[data-testid="master-dock-in-use"]')).toBeNull();
      await act(async () => { state.room = roomOf(false, batch.events, 2); view.rerender(<DuelRoomView slug="game-1" windowed />); });
      const inUse = [...document.querySelectorAll('[data-master-source="0"]')].filter((el) => el.getAttribute("data-in-use") === "true");
      expect(inUse.length).toBeGreaterThan(0);
      expect(document.body.textContent).toMatch(/Next summon/);
    });

    it("gives the move layer a move out of the Deck Master Zone, and a source for it", async () => {
      const view = open();
      await waitFor(() => expect(moveFx).toHaveBeenCalled());
      // The plate sits in the Deck Master drawer. A shut drawer is no place a card can leave from (the summon then
      // shows at its zone), so the card flies out of the plate only while the drawer is out.
      const tab = document.querySelector<HTMLElement>('[data-edge-drawer="Deck Master"] button[aria-expanded]');
      await act(async () => { tab?.click(); });
      await act(async () => { state.room = roomOf(false, batch.events, 2); view.rerender(<DuelRoomView slug="game-1" windowed />); });
      const flight = lastEvents(moveFx)?.find((event) => event.kind === "move" && event.from?.location === LOCATION_DMZONE);
      expect(flight).toBeTruthy();
      expect(flight!.zone).toEqual(batch.events.find((event) => event.kind === "summon")!.zone);
      // The departure snapshot is taken before the commit, so the source is the plate even though the view has changed.
      expect(resolveSource(flight!.from!, flight!.id)).not.toBeNull();
      expect(getZoneSnapshot(flight!.from!)).not.toBeNull();
    });
  });
}
