// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const swr = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("swr", () => ({
  default: () => ({ data: swr.data, error: undefined, isLoading: false, mutate: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/field", () => ({
  DuelField: () => <div data-testid="field" />,
  DeckMasterRail: () => null,
}));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));
vi.mock("@/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/duel/api")>()),
  getDuelCards: vi.fn(async () => ({ cards: [], missing: [] })),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
}));

import { DuelRoomView } from "@/components/duel/room";
import { isStartingNextGame } from "@/components/duel/between-games";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const deck = makeDeck();
const betweenRoom = () =>
  makeSeriesRoom({
    series: makeSeries({ status: "between_games", wins: [1, 0], nextGameAt: new Date(Date.now() + 40_000).toISOString(), hasSide: [true, true] }),
    mySide: { baseDeck: deck, currentDeck: deck },
  });
const nextGameLobby = (): DuelRoom => {
  const room = makeSeriesRoom({ series: makeSeries({ gameNumber: 2, currentDuelSlug: "game-2", wins: [1, 0] }), slug: "game-2", status: "lobby" });
  room.session.gameNumber = 2;
  return room;
};

describe("the duel room between games", () => {
  it("shows the Between games screen, not the lobby or the result", () => {
    swr.data = betweenRoom();
    render(<DuelRoomView slug="game-1" />);
    expect(screen.getByTestId("between-games")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Game 2 of 3");
    expect(screen.queryByRole("region", { name: "Seats" })).toBeNull();
    expect(screen.queryByTestId("practice-bot-note")).toBeNull();
    expect(screen.queryByTestId("between-games-info")).toBeNull();
  });

  it("shows a short starting screen, not the lobby settings, while the next game is created", () => {
    swr.data = nextGameLobby();
    render(<DuelRoomView slug="game-2" />);
    expect(screen.getByTestId("next-game-starting").textContent).toContain("Game 2 of 3");
    expect(screen.queryByRole("region", { name: "Seats" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Table" })).toBeNull();
  });
});

describe("isStartingNextGame", () => {
  it("is true only for the lobby of a game after the first, in an open series", () => {
    expect(isStartingNextGame(nextGameLobby())).toBe(true);
    const first = nextGameLobby();
    first.session.gameNumber = 1;
    expect(isStartingNextGame(first)).toBe(false);
    const done = nextGameLobby();
    done.series = makeSeries({ status: "completed" });
    expect(isStartingNextGame(done)).toBe(false);
    const noSeries = nextGameLobby();
    noSeries.series = null;
    expect(isStartingNextGame(noSeries)).toBe(false);
    const live = nextGameLobby();
    live.session.status = "active";
    expect(isStartingNextGame(live)).toBe(false);
  });
});
