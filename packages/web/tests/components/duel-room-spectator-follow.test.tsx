// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const state = vi.hoisted(() => ({ data: null as unknown, replace: (() => undefined) as (path: string) => void }));
vi.mock("swr", () => ({
  default: () => ({ data: state.data, error: undefined, isLoading: false, mutate: () => undefined }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: state.replace, push: () => undefined }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: () => undefined }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: () => undefined }));
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

import { DuelRoomView } from "@/components/duel/room";

/** Game 1 seen by a spectator, with the series in the given state. */
function spectatorRoom(series: Parameters<typeof makeSeries>[0], options: { status?: DuelRoom["session"]["status"]; visibility?: string } = {}) {
  const room = makeSeriesRoom({ mySeat: null, status: options.status ?? "completed", series: makeSeries(series) });
  if (options.visibility) room.session.settings = { visibility: options.visibility } as DuelRoom["session"]["settings"];
  return room;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.data = null;
});

describe("DuelRoomView: a spectator between games of a series", () => {
  it("moves a spectator who watched game 1 to game 2 once it starts", () => {
    const replace = vi.fn();
    state.replace = replace;
    state.data = spectatorRoom({ status: "active", currentDuelSlug: "game-1" }, { status: "active" });
    const view = render(<DuelRoomView slug="game-1" />);

    state.data = spectatorRoom({ status: "between_games", wins: [1, 0], nextGameAt: new Date(Date.now() + 60_000).toISOString() });
    view.rerender(<DuelRoomView slug="game-1" />);
    expect(replace).not.toHaveBeenCalled();

    state.data = spectatorRoom({ status: "active", wins: [1, 0], gameNumber: 2, currentDuelSlug: "game-2" });
    view.rerender(<DuelRoomView slug="game-1" />);
    expect(replace).toHaveBeenCalledWith("/duels/game-2");
  });

  it("leaves a spectator who opened game 1 after game 2 had started", () => {
    const replace = vi.fn();
    state.replace = replace;
    state.data = spectatorRoom({ status: "active", wins: [1, 0], gameNumber: 2, currentDuelSlug: "game-2" });
    render(<DuelRoomView slug="game-1" />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not move a spectator of an invite-only table", () => {
    const replace = vi.fn();
    state.replace = replace;
    state.data = spectatorRoom({ status: "active", currentDuelSlug: "game-1" }, { status: "active", visibility: "private" });
    const view = render(<DuelRoomView slug="game-1" />);

    state.data = spectatorRoom({ status: "active", wins: [1, 0], gameNumber: 2, currentDuelSlug: "game-2" }, { visibility: "private" });
    view.rerender(<DuelRoomView slug="game-1" />);
    expect(replace).not.toHaveBeenCalled();
  });
});
