// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet";
import { MatchError } from "@/components/tournament/matches/match-controls";
import { LiveView } from "@/components/tournament/floor/live-view";
import type { TournamentDetail } from "@/components/tournament/types";
import { sheetRatings, sheetTournament } from "../fixtures/tournament-sheet";

const ratings = new Map(sheetRatings.map((row) => [row.playerId, { rating: row.rating, rank: row.rank }]));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Your field with you (player 5) holding no deck yet. */
function withoutDeck(locked = false): TournamentDetail {
  return {
    ...sheetTournament,
    participants: sheetTournament.participants.map((p) =>
      p.playerId === 5 ? { ...p, deckRegistered: false, deckLocked: locked } : p),
  };
}

function live(tournament: TournamentDetail) {
  return render(
    <SheetRoot>
      <LiveView tournament={tournament} tournamentSlug="friday-night-12" ratings={ratings} isHost={false} onChanged={() => {}} narrow={false} />
    </SheetRoot>,
  );
}

const deckState = {
  registration: null,
  draft: null,
  savedDeckOptions: [{ id: 4, name: "Goat", mainCount: 40 }],
};

describe("Register a deck under your field", () => {
  it("is a button that opens the deck panel here, and registers the chosen deck", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({ registration: {} }) : Response.json(deckState));
    vi.stubGlobal("fetch", fetchMock);
    live(withoutDeck());

    const open = screen.getByRole("button", { name: "Register a deck" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Register a deck" })).toBeNull();
    fireEvent.click(open);

    expect(open).toHaveAttribute("aria-expanded", "true");
    const panel = await screen.findByTestId("floor-my-deck");
    expect(panel).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText(/saved deck/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe("/api/tournaments/friday-night-12/deck");
    expect(JSON.parse(String(put[1]!.body))).toEqual({ savedDeckId: 4 });
  });

  it("points aria-controls at the panel only while it is open, and moves focus into the panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckState)));
    live(withoutDeck());

    const open = screen.getByRole("button", { name: "Register a deck" });
    // Closed: no aria-controls, but the host container is already in the page with the id.
    expect(open).not.toHaveAttribute("aria-controls");
    const host = document.getElementById("floor-my-deck")!;
    expect(host).not.toBeNull();
    expect(host).toBeEmptyDOMElement();

    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-controls", "floor-my-deck");
    expect(document.getElementById("floor-my-deck")).toBe(host);
    expect(host).toHaveFocus();
    expect(await within(host).findByTestId("floor-my-deck")).toBeInTheDocument();
    expect(document.querySelectorAll("#floor-my-deck")).toHaveLength(1);

    fireEvent.click(open);
    expect(open).not.toHaveAttribute("aria-controls");
    expect(document.getElementById("floor-my-deck")).toBe(host);
    expect(host).toBeEmptyDOMElement();
  });

  it("says so when the decks cannot be loaded, and loads again on request", async () => {
    let ok = false;
    const fetchMock = vi.fn(async () => (ok ? Response.json(deckState) : Response.json({ error: "x" }, { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);
    live(withoutDeck());

    fireEvent.click(screen.getByRole("button", { name: "Register a deck" }));
    expect(await screen.findByText("Could not load your decks.")).toBeInTheDocument();
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText(/saved deck/i)).toBeInTheDocument();
  });

  it("offers Change deck when a deck is in, and nothing once it is locked", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckState)));
    const registered: TournamentDetail = {
      ...sheetTournament,
      participants: sheetTournament.participants.map((p) => (p.playerId === 5 ? { ...p, deckRegistered: true, deckLocked: false } : p)),
    };
    const { unmount } = live(registered);
    expect(screen.getByRole("button", { name: "Change deck" })).toBeInTheDocument();
    unmount();
    live(withoutDeck(true));
    expect(screen.queryByRole("button", { name: /register a deck|change deck/i })).toBeNull();
  });

  it("shows the draft deck size note under your field with a link to edit the deck", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckState)));
    live({
      ...withoutDeck(),
      draftId: 9,
      draftSlug: "friday-cube",
      deckNote: { level: "required", mainCount: 38, message: "Your draft deck has 38 main deck cards; edit it to 40." },
    });
    const note = screen.getByTestId("deck-note");
    expect(note).toHaveTextContent("Your draft deck has 38 main deck cards; edit it to 40.");
    expect(within(note).getByRole("link", { name: "Edit deck" })).toHaveAttribute("href", "/decks/draft/friday-cube");
  });

  it("shows no size note when the server sends none", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckState)));
    live({ ...withoutDeck(), draftId: 9, draftSlug: "friday-cube", deckNote: null });
    expect(screen.queryByTestId("deck-note")).toBeNull();
  });
});

describe("My deck inside a match error", () => {
  it("opens the deck panel when the page has one", () => {
    const onOpenDeck = vi.fn();
    render(<SheetRoot><MatchError error="Both players must register a deck in My deck first." onOpenDeck={onOpenDeck} /></SheetRoot>);
    expect(screen.queryByRole("link", { name: "My deck" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "My deck" }));
    expect(onOpenDeck).toHaveBeenCalledTimes(1);
  });

  it("keeps the section link when there is no panel to open", () => {
    render(<SheetRoot><MatchError error="Register a deck in My deck first." /></SheetRoot>);
    expect(screen.getByRole("link", { name: "My deck" })).toHaveAttribute("href", "#my-deck");
  });
});
