// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/tournament/standings/crosstable", () => ({ Crosstable: () => <section id="standings" aria-label="Standings" /> }));
vi.mock("@/components/tournament/matches/your-match", () => ({ YourMatch: () => <section id="your-match" aria-label="Your match" /> }));
vi.mock("@/components/tournament/matches/match-queue", () => ({ MatchQueue: () => <section id="matches" aria-label="Matches" /> }));
import { TournamentSheet } from "@/components/tournament/sheet/tournament-sheet";
import { sheetTournament } from "../fixtures/tournament-sheet";

const props = { tournament: sheetTournament, tournamentSlug: "friday-night-12", isHost: true, ratings: new Map(), onChanged: vi.fn() };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("tournament sheet composition and rail", () => {
  it("places the three main sections in order alongside a separate rail", () => {
    render(<TournamentSheet {...props} />);
    const sections = ["Your match", "Standings", "Matches"].map((name) => screen.getByRole("region", { name }));
    expect(Array.from(sections[0].parentElement!.children)).toEqual(sections);
    const rail = screen.getByRole("complementary", { name: "Event details and organizer tools" });
    expect(rail.parentElement).toBe(sections[0].parentElement!.parentElement);
    expect(within(rail).getByRole("region", { name: "Organizer" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
  it("shows reference counts and rule rows in the event card", () => {
    render(<TournamentSheet {...props} />);
    const event = screen.getByRole("region", { name: "Event details" });
    expect(event).toHaveTextContent("Round robin · Best of 3");
    expect(event).toHaveTextContent("9/15Decided1Live1To confirm");
    expect(event).toHaveTextContent("Duel modeNormal");
    expect(event).toHaveTextContent("BanlistTCG September 2026");
    expect(event).toHaveTextContent("Turn time3 min");
    expect(event).toHaveTextContent("Started");
    const progress = screen.getByRole("group", { name: "9 of 15 matches done" });
    expect(progress).toHaveTextContent("1 live1 to confirm2 yours2 not started");
    expect(Array.from(progress.querySelectorAll('[data-segment]')).map((node) => [node.getAttribute("data-segment"), (node as HTMLElement).style.flexGrow])).toEqual([
      ["decided", "9"], ["live", "1"], ["to-confirm", "1"], ["yours", "2"], ["not-started", "2"],
    ]);
  });
  it("omits absent rule rows, dates and zero progress keys for older payloads", () => {
    render(<TournamentSheet {...props} tournament={{ ...sheetTournament, bestOf: undefined, duelRules: undefined, startedAt: null, deadlineAt: undefined, matches: [] }} />);
    const event = screen.getByRole("region", { name: "Event details" });
    expect(event).not.toHaveTextContent(/Duel mode|Banlist|Turn time/);
    expect(event).toHaveTextContent("Started—");
    expect(screen.getByRole("group", { name: "0 of 0 matches done" })).not.toHaveTextContent(/0 live|0 yours|deadline/);
  });
  it("shows the draft rules row and a real link to its draft", () => {
    render(<TournamentSheet {...props} tournament={{ ...sheetTournament, draftId: 9, draftSlug: "draft-nine" }} />);
    const event = screen.getByRole("region", { name: "Event details" });
    expect(event).toHaveTextContent("RulesDraft pool, no banlist");
    expect(within(event).getByRole("link", { name: "View draft" })).toHaveAttribute("href", "/draft/draft-nine");
  });
  it("shows Your deck only to an active participant whose entry is unlocked", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const unlocked = { ...sheetTournament, participants: sheetTournament.participants.map((player) => ({ ...player, deckLocked: false })) };
    const { rerender } = render(<TournamentSheet {...props} tournament={unlocked} />);
    expect(screen.getByRole("region", { name: "Your deck" })).toHaveAttribute("id", "my-deck");
    rerender(<TournamentSheet {...props} />);
    expect(screen.queryByRole("region", { name: "Your deck" })).toBeNull();
    rerender(<TournamentSheet {...props} tournament={{ ...unlocked, isParticipant: false }} />);
    expect(screen.queryByRole("region", { name: "Your deck" })).toBeNull();
    rerender(<TournamentSheet {...props} tournament={{ ...unlocked, status: "completed" }} />);
    expect(screen.queryByRole("region", { name: "Your deck" })).toBeNull();
  });
  it("omits deck state when an older participant entry has no deck fields", () => {
    render(<TournamentSheet {...props} tournament={{ ...sheetTournament, isParticipant: false, participants: [{ playerId: 5, displayName: "Imran" }] }} />);
    const players = screen.getByRole("region", { name: "Players" });
    expect(players).not.toHaveTextContent(/No deck|Registered|Locked/);
    expect(within(players).getByRole("link", { name: "Imran" }).previousElementSibling?.tagName).toBe("svg");
  });

  it("does not infer No deck from a false lock flag when registration data is missing", () => {
    render(<TournamentSheet {...props} tournament={{ ...sheetTournament, isParticipant: false, participants: [{ playerId: 5, displayName: "Imran", deckLocked: false }] }} />);
    expect(screen.getByRole("region", { name: "Players" })).not.toHaveTextContent(/No deck|Registered|Locked/);
  });
});
