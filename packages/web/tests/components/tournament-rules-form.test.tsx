// @vitest-environment jsdom
import { fixtureUserId } from "../fixtures/identity";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TournamentRulesForm } from "../../src/components/tournament/tournament-rules-form";
import { CreateTournamentForm } from "../../src/components/tournament/create-tournament-form";
import { PlayersTab } from "../../src/components/tournament/players-tab";
import type { DuelSeriesSummary, TournamentDetail } from "../../src/components/tournament/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const base: TournamentDetail = {
  id: 1, name: "Cup", format: "round_robin", status: "pending", createdByUserId: fixtureUserId("host"),
  participants: [{ playerId: 1, displayName: "Ann", deckRegistered: true }, { playerId: 2, displayName: "Ben", deckRegistered: false }],
  matches: [], isParticipant: true, currentUserPlayerId: 1,
  startedAt: null, createdAt: "2026-01-01T00:00:00Z", bestOf: 3,
};

const series = { id: 1, status: "active" } as unknown as DuelSeriesSummary;

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("TournamentRulesForm", () => {
  it("PATCHes bestOf and duelRules", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<TournamentRulesForm tournament={base} tournamentSlug="cup" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("radio", { name: /best of 1/i }));
    fireEvent.change(screen.getByLabelText(/duel mode/i), { target: { value: "domain" } });
    expect((screen.getByLabelText(/banlist/i) as HTMLSelectElement).value).toBe("none");
    fireEvent.change(screen.getByLabelText(/turn time/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /save duel rules/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tournaments/cup");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      bestOf: 1,
      duelRules: { mode: "domain", masterRule: 5, settings: { banlist: "none", turnSeconds: 0 } },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("draft tournament: shows the fixed rules note and sends only bestOf", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<TournamentRulesForm tournament={{ ...base, draftId: 4, draftSlug: "d" }} tournamentSlug="cup" onSaved={() => {}} />);
    expect(screen.getByText(/draft rules: no banlist, pool decks only/i)).toBeTruthy();
    expect(screen.queryByLabelText(/banlist/i)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /best of 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /save duel rules/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ bestOf: 1 });
  });

  it("is read-only with a note once the server reports the rules locked", () => {
    render(
      <TournamentRulesForm
        tournament={{ ...base, status: "active", rulesLocked: true, matches: [{ id: 1, matchId: null, roundNumber: 1, playerOneId: 1, playerTwoId: 2, playerOneName: "Ann", playerTwoName: "Ben", status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {}, series }] }}
        tournamentSlug="cup"
        onSaved={() => {}}
      />,
    );
    expect(screen.getByText(/locked\. the first online game has started/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save duel rules/i })).toBeNull();
    expect(screen.getByLabelText(/banlist/i)).toBeDisabled();
    expect(screen.getByRole("radio", { name: /best of 1/i })).toBeDisabled();
  });
});

describe("CreateTournamentForm rules", () => {
  it("sends Best of 3 and the default rules, or the chosen ones", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
      String(url) === "/api/discord/channels" ? Response.json({ channels: [] }) : Response.json({ webSlug: "new-cup" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "New Cup" } });
    expect(screen.getByRole("radio", { name: /best of 3/i })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /best of 1/i }));
    fireEvent.change(screen.getByLabelText(/banlist/i), { target: { value: "ocg-2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournament/new-cup"));
    const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/tournaments")!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.bestOf).toBe(1);
    expect(body.duelRules).toEqual({ mode: "normal", masterRule: 5, settings: { banlist: "ocg-2026-07", turnSeconds: 240 } });
  });
});

describe("PlayersTab deck marker", () => {
  it("shows deck status per participant to the organizer only", () => {
    const props = { tournament: base, tournamentSlug: "cup", currentUserPlayerId: 1, onChanged: () => {} };
    const { unmount } = render(<PlayersTab {...props} isCreator />);
    expect(screen.getByTestId("player-deck-marker-1")).toHaveTextContent(/deck in/i);
    expect(screen.getByTestId("player-deck-marker-2")).toHaveTextContent(/no deck/i);
    unmount();
    render(<PlayersTab {...props} isCreator={false} />);
    expect(screen.queryByTestId("player-deck-marker-1")).toBeNull();
  });
});

const FIXTURE_KEYS = ["host"] as const;
