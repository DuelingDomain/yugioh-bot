// @vitest-environment jsdom
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";

let handlers: NonNullable<Parameters<typeof useTournamentWebsocket>[1]>;
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "friday-night-12" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-tournament-websocket", () => ({
  useTournamentWebsocket: (_slug: string, options: typeof handlers) => { handlers = options; },
}));

import TournamentDetailPage from "../../app/(app)/tournament/[slug]/page";
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";
import { deckResponse } from "../fixtures/matches";

const LEADERBOARD = "/api/leaderboard?scope=all";
const ratingsAt = (rating: number) => ({ rows: sheetRatings.map(row => row.playerId === 5 ? { ...row, rating } : row) });

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(ratings: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === LEADERBOARD) return ratings();
    if (String(url) === "/api/auth/session") return Response.json({ user: { id: "host" } });
    if (String(url) === "/api/tournaments/friday-night-12") return Response.json(sheetTournament);
    if (String(url) === "/api/tournaments/friday-night-12/deck") return Response.json(deckResponse());
    throw new Error(`Unexpected request: ${String(url)}`);
  }));
}

beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("tournament live ratings", () => {
  it("updates the displayed Elo on a match update while the event remains active", async () => {
    let rating = 1184;
    setup(() => Response.json(ratingsAt(rating)));
    render(<TournamentDetailPage />);
    const match = await screen.findByRole("region", { name: "Your match" });
    expect(await within(match).findByText("1184")).toBeInTheDocument();
    rating = 1201;
    act(() => handlers.onMatchUpdated?.());
    expect(await within(match).findByText("1201")).toBeInTheDocument();
    expect(within(match).queryByText("1184")).toBeNull();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it.each([200, 500])("keeps the latest Elo when an older ratings response returns status %s", async status => {
    const old = deferred(), latest = deferred();
    let requests = 0;
    setup(() => ++requests === 1 ? Response.json(ratingsAt(1184)) : requests === 2 ? old.promise : latest.promise);
    render(<TournamentDetailPage />);
    const match = await screen.findByRole("region", { name: "Your match" });
    await within(match).findByText("1184");
    act(() => { handlers.onMatchUpdated?.(); handlers.onMatchUpdated?.(); });
    await act(async () => latest.resolve(Response.json(ratingsAt(1201))));
    expect(within(match).getByText("1201")).toBeInTheDocument();
    await act(async () => old.resolve(Response.json(ratingsAt(1100), { status })));
    expect(within(match).getByText("1201")).toBeInTheDocument();
    expect(within(match).queryByText("1100")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
