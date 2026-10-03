// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyDeckPanel } from "../../src/components/tournament/my-deck-panel";
import type { TournamentDetail } from "../../src/components/tournament/types";

const tournament: TournamentDetail = {
  id: 1, name: "Cup", format: "single_elim", status: "active", createdByUserId: "host",
  participants: [{ playerId: 10, displayName: "Me" }],
  matches: [], isParticipant: true, currentUserPlayerId: 10,
  startedAt: null, createdAt: "2026-01-01T00:00:00Z",
};

const deck = { main: new Array(40).fill(1), extra: new Array(15).fill(2), side: [] as number[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function registeredDeck(lockedAt: string | null) {
  return { registration: { savedDeckId: 4, deck, lockedAt }, draft: null, savedDeckOptions: [{ id: 4, name: "Goat" }] };
}

function stub(state: unknown, put?: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT" && put) return put();
    return Response.json(state);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPanel(t: TournamentDetail = tournament, onChanged = () => {}) {
  return render(<MyDeckPanel tournament={t} tournamentSlug="cup" onChanged={onChanged} />);
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("MyDeckPanel", () => {
  it("renders nothing for a non-participant and does not fetch", () => {
    const fetchMock = stub({});
    const { container } = renderPanel({ ...tournament, isParticipant: false });
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers a saved deck with PUT", async () => {
    const fetchMock = stub(
      { registration: null, draft: null, savedDeckOptions: [{ id: 4, name: "Goat" }, { id: 5, name: "Burn" }] },
      () => Response.json({ registration: {} }),
    );
    const onChanged = vi.fn();
    renderPanel(tournament, onChanged);
    expect(await screen.findByText(/no deck yet/i)).toBeTruthy();
    const register = screen.getByRole("button", { name: /register/i });
    expect(register).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/saved deck/i), { target: { value: "5" } });
    fireEvent.click(register);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe("/api/tournaments/cup/deck");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ savedDeckId: 5 });
  });

  it("shows the registered deck and Change, and shows validation errors", async () => {
    stub(
      {
        registration: { savedDeckId: 4, deck, lockedAt: null },
        draft: null,
        savedDeckOptions: [{ id: 4, name: "Goat" }, { id: 5, name: "Burn" }],
      },
      () => Response.json({ error: "Deck is not legal.", report: { issues: [{ message: "Too few cards." }] } }, { status: 400 }),
    );
    renderPanel();
    expect(await screen.findByText(/Goat, 40 main, 15 extra, 0 side/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/saved deck/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Deck is not legal. Too few cards.");
  });

  it("is read-only when locked", async () => {
    stub({ registration: { savedDeckId: 4, deck, lockedAt: "2026-01-02T00:00:00Z" }, draft: null, savedDeckOptions: [{ id: 4, name: "Goat" }] });
    renderPanel();
    expect(await screen.findByText(/locked\. your first tournament game started/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(/saved deck/i)).toBeNull();
  });

  it("keeps the latest lock state when an older request finishes last", async () => {
    const old = deferred<Response>();
    const fetchMock = stub(registeredDeck("2026-01-02T00:00:00Z"));
    fetchMock.mockImplementationOnce(() => old.promise);
    const { rerender } = renderPanel();
    rerender(<MyDeckPanel tournament={{ ...tournament }} tournamentSlug="cup" onChanged={() => {}} />);
    expect(await screen.findByText(/locked\. your first tournament game started/i)).toBeInTheDocument();
    await act(async () => old.resolve(Response.json(registeredDeck(null))));
    expect(screen.getByText(/locked\. your first tournament game started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/saved deck/i)).toBeNull();
  });

  it("ignores a superseded response whose body was still loading", async () => {
    const oldBody = deferred<ReturnType<typeof registeredDeck>>();
    const oldResponse = Response.json(registeredDeck(null));
    const json = vi.spyOn(oldResponse, "json").mockImplementation(() => oldBody.promise);
    const fetchMock = stub(registeredDeck("2026-01-02T00:00:00Z"));
    fetchMock.mockResolvedValueOnce(oldResponse);
    const { rerender } = renderPanel();
    await waitFor(() => expect(json).toHaveBeenCalledOnce());
    rerender(<MyDeckPanel tournament={{ ...tournament }} tournamentSlug="cup" onChanged={() => {}} />);
    expect(await screen.findByText(/locked\. your first tournament game started/i)).toBeInTheDocument();
    await act(async () => oldBody.resolve(registeredDeck(null)));
    expect(screen.getByText(/locked\. your first tournament game started/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/saved deck/i)).toBeNull();
  });

  it("ignores a request that finishes after the panel unmounts", async () => {
    const pending = deferred<Response>();
    const response = Response.json(registeredDeck(null));
    const json = vi.spyOn(response, "json");
    const fetchMock = stub({});
    fetchMock.mockImplementationOnce(() => pending.promise);
    const { unmount } = renderPanel();
    unmount();
    await act(async () => pending.resolve(response));
    expect(json).not.toHaveBeenCalled();
  });

  it("offers a deck builder link when there are no saved decks", async () => {
    stub({ registration: null, draft: null, savedDeckOptions: [] });
    renderPanel();
    expect(await screen.findByRole("link", { name: /build a deck/i })).toHaveAttribute("href", "/decks/new");
  });

  it("draft tournament: uses the draft deck, links to edit it", async () => {
    stub({ registration: { savedDeckId: 8, deck, lockedAt: null }, draft: { id: 3, slug: "dr1" }, savedDeckOptions: [{ id: 8, name: "Draft deck" }] });
    renderPanel({ ...tournament, draftId: 3, draftSlug: "dr1" });
    expect(await screen.findByText(/your draft deck is used/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /edit draft deck/i })).toHaveAttribute("href", "/decks/draft/dr1");
    expect(screen.queryByLabelText(/saved deck/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /register/i })).toBeNull();
  });

  it("draft tournament: takes the draft slug from the deck response when the tournament has none", async () => {
    stub({ registration: { savedDeckId: 8, deck, lockedAt: null }, draft: { id: 3, slug: "dr2" }, savedDeckOptions: [{ id: 8, name: "Draft deck" }] });
    renderPanel({ ...tournament, draftId: 3 });
    expect(await screen.findByRole("link", { name: /edit draft deck/i })).toHaveAttribute("href", "/decks/draft/dr2");
  });

  it("draft tournament: falls back to the saved deck editor when no draft slug is known", async () => {
    stub({ registration: { savedDeckId: 8, deck, lockedAt: null }, draft: null, savedDeckOptions: [{ id: 8, name: "Draft deck" }] });
    renderPanel({ ...tournament, draftId: 3 });
    expect(await screen.findByRole("link", { name: /edit draft deck/i })).toHaveAttribute("href", "/decks/8");
  });

  it("draft tournament: registers a saved draft deck that is not registered yet", async () => {
    const fetchMock = stub(
      { registration: null, draft: { id: 3, slug: "dr1" }, savedDeckOptions: [{ id: 8, name: "Draft deck" }] },
      () => Response.json({ registration: {} }),
    );
    renderPanel({ ...tournament, draftId: 3, draftSlug: "dr1" });
    fireEvent.click(await screen.findByRole("button", { name: /register/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ savedDeckId: 8 });
  });

  it("draft tournament: links to the draft page when no deck is saved yet", async () => {
    stub({ registration: null, draft: { id: 3, slug: "dr1" }, savedDeckOptions: [] });
    renderPanel({ ...tournament, draftId: 3, draftSlug: "dr1" });
    expect(await screen.findByRole("link", { name: /build your deck/i })).toHaveAttribute("href", "/draft/dr1");
  });
});
