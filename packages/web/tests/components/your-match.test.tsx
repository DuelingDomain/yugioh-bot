// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectMatch } from "@yugidraft/shared/scoring";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet/sheet-root";
import { YourMatch } from "@/components/tournament/matches/your-match";
import { deriveMyMatches } from "@/components/tournament/use-my-matches";
import { deckResponse, liveMatch, matchProps, openMatch, pendingMatch, tournament } from "../fixtures/matches";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function show(props = matchProps) { return render(<SheetRoot><YourMatch {...props} /></SheetRoot>); }

describe("Your match", () => {
  it("matches the reference names, records, tiers, rules and projectMatch stakes", async () => {
    const fetchMock = vi.fn(async () => Response.json(deckResponse())); vi.stubGlobal("fetch", fetchMock);
    show();
    expect(screen.getByRole("region", { name: "Your match" })).toBeInTheDocument();
    expect(screen.getByText("Imran")).toBeInTheDocument(); expect(screen.getByText("Marik_Mains")).toBeInTheDocument();
    expect(screen.getByText("2–1 here")).toBeInTheDocument(); expect(screen.getByText("0–3 here")).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument(); expect(screen.getByText("Silver")).toBeInTheDocument();
    expect(screen.getByText("1184")).toBeInTheDocument(); expect(screen.getByText("1062")).toBeInTheDocument();
    const projection = projectMatch({ myElo: 1184, oppElo: 1062, seasonMultiplier: 1 });
    expect(projection).toMatchObject({ winRating: 11, loseRating: -21, winWinnings: 4 });
    expect(screen.getByText(`+${projection.winRating} if you win`)).toBeInTheDocument();
    expect(screen.getByText(`−${Math.abs(projection.loseRating)} if you lose`)).toBeInTheDocument();
    expect(screen.queryByText(/winnings/)).toBeNull(); // winnings appear in the phone layout only
    await screen.findByText("Branded Despia");
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/deck");
    expect(fetchMock).toHaveBeenCalledOnce(); // Stakes use the supplied ratings; no player fetches.
    expect(screen.queryByText(/Round \d/)).toBeNull();
  });

  it("takes exactly deriveMyMatches' first action and links all other actionable opponents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    const t = tournament(); expect(deriveMyMatches(t).actionMatch?.id).toBe(openMatch.id);
    show({ ...matchProps, tournament: t });
    expect(screen.getByRole("region", { name: "Your match" })).toHaveAttribute("id", "match-1");
    expect(screen.getByRole("link", { name: "vs BlueEyesBen" })).toHaveAttribute("href", "#match-2");
    expect(screen.getByText(/1 of your 2 left after this/)).toBeInTheDocument();
    expect(await screen.findByText("Branded Despia")).toBeInTheDocument();
  });

  it("omits the card and deck request for a nonparticipant", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { container } = show({ ...matchProps, tournament: tournament({ isParticipant: false }) });
    expect(screen.queryByRole("region", { name: "Your match" })).toBeNull();
    expect(container.querySelector("section")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the quiet caught-up state when no match needs the participant", () => {
    show({ ...matchProps, tournament: tournament({ matches: [] }) });
    expect(screen.getByRole("region", { name: "Your match" })).toHaveTextContent("You're all caught up. Nothing needs you right now.");
    expect(screen.queryByRole("button", { name: /Report/ })).toBeNull();
  });

  it("includes the round for single elimination", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    show({ ...matchProps, tournament: tournament({ format: "single_elim", matches: [{ ...openMatch, roundNumber: 2 }] }) });
    expect(screen.getByText("Your match · Round 2")).toBeInTheDocument(); await screen.findByText("Branded Despia");
  });

  it.each([true, false])("shows the deck counts and locked=%s state", async locked => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse(locked)))); show();
    const name = await screen.findByText("Branded Despia");
    expect(name.parentElement).toHaveTextContent(`40 main · 15 extra · 15 side · ${locked ? "locked for this event" : "registered"}`);
  });

  it("links an absent deck to the rail registration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ registration: null, savedDeckOptions: [], draft: null }))); show();
    expect(await screen.findByText(/No deck registered/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register a deck" })).toHaveAttribute("href", "#my-deck");
  });

  it("refetches a registration or lock change, without fetching on unrelated payload refreshes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ registration: null, savedDeckOptions: [] })).mockResolvedValueOnce(Response.json(deckResponse(false))).mockResolvedValueOnce(Response.json(deckResponse(true)));
    vi.stubGlobal("fetch", fetchMock);
    const base = tournament({ participants: matchProps.tournament.participants.map(p => p.playerId === 5 ? { ...p, deckRegistered: false, deckLocked: false } : p) });
    const { rerender } = show({ ...matchProps, tournament: base }); await screen.findByText(/No deck registered/);
    rerender(<SheetRoot><YourMatch {...matchProps} tournament={{ ...base, matches: [...base.matches] }} /></SheetRoot>);
    expect(fetchMock).toHaveBeenCalledOnce();
    const registered = { ...base, participants: base.participants.map(p => p.playerId === 5 ? { ...p, deckRegistered: true } : p) };
    rerender(<SheetRoot><YourMatch {...matchProps} tournament={registered} /></SheetRoot>);
    await screen.findByText("Branded Despia"); expect(fetchMock).toHaveBeenCalledTimes(2);
    const locked = { ...registered, participants: registered.participants.map(p => p.playerId === 5 ? { ...p, deckLocked: true } : p) };
    rerender(<SheetRoot><YourMatch {...matchProps} tournament={locked} /></SheetRoot>);
    await waitFor(() => expect(screen.getByText("Branded Despia").parentElement).toHaveTextContent("locked for this event"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shares report controls and keeps an open report across refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    const { rerender } = show(); await screen.findByText("Branded Despia");
    fireEvent.click(screen.getByRole("button", { name: "Report a result" }));
    expect(screen.getByText(/How did it go/)).toHaveTextContent("Marik_Mains confirms within 24 hours");
    rerender(<SheetRoot><YourMatch {...matchProps} tournament={tournament()} /></SheetRoot>);
    expect(screen.getByRole("button", { name: /I won/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Start duel" })).toBeInTheDocument();
  });

  it("keeps the same deck data when a refresh chooses the next actionable match", async () => {
    const fetchMock = vi.fn(async () => Response.json(deckResponse())); vi.stubGlobal("fetch", fetchMock);
    const { rerender } = show(); await screen.findByText("Branded Despia");
    const next = tournament({ matches: matchProps.tournament.matches.filter(m => m.id !== openMatch.id) });
    rerender(<SheetRoot><YourMatch {...matchProps} tournament={next} /></SheetRoot>);
    expect(screen.getByText("BlueEyesBen")).toBeInTheDocument();
    expect(screen.getByText("Branded Despia")).toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows Approve/Deny for the first match awaiting the viewer's confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    show({ ...matchProps, currentUserPlayerId: 3, tournament: tournament({ currentUserPlayerId: 3, matches: [pendingMatch] }) });
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.getByText("Marik_Mains says they won.")).toBeInTheDocument(); await screen.findByText("Branded Despia");
  });

  it("shows Open duel for the player's first open online slot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    show({ ...matchProps, currentUserPlayerId: 1, tournament: tournament({ currentUserPlayerId: 1, matches: [liveMatch] }) });
    expect(screen.getByRole("link", { name: "Open duel" })).toHaveAttribute("href", "/duels/duel-3"); await screen.findByText("Branded Despia");
  });

  it("uses grey gems and no Elo for players missing from ratings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(deckResponse())));
    show({ ...matchProps, ratings: new Map() });
    expect(screen.getAllByText("Unrated")).toHaveLength(2);
    expect(screen.queryByText("1184")).toBeNull(); expect(screen.queryByText("1062")).toBeNull(); await screen.findByText("Branded Despia");
  });
});
