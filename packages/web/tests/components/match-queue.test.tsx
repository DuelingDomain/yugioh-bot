// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet/sheet-root";
import { MatchQueue } from "@/components/tournament/matches/match-queue";
import { byeMatch, decidedMatch, matchProps, openMatch, tournament } from "../fixtures/matches";

function show(props = matchProps) { return render(<SheetRoot><MatchQueue {...props} /></SheetRoot>); }

describe("Matches queue", () => {
  it("has the shared anchor and groups the board's matches in waiting order", () => {
    show();
    const section = screen.getByRole("region", { name: "Matches" }); expect(section).toHaveAttribute("id", "matches");
    expect(screen.getByText("Grouped by what each match is waiting on")).toBeInTheDocument();
    expect(within(section).getAllByRole("group").map(group => group.getAttribute("aria-label"))).toEqual(["Live", "Awaiting confirmation", "Not started", "Decided"]);
    expect(within(screen.getByRole("group", { name: "Not started" })).getAllByText("Imran")).toHaveLength(1);
    const rows = screen.getByRole("group", { name: "Not started" }).querySelectorAll("[id^='match-']");
    expect(Array.from(rows).map(row => row.id)).toEqual(["match-2", "match-5", "match-6"]);
    expect(within(screen.getByRole("group", { name: "Decided" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the three newest results with def., scores or reported", () => {
    show(); const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/Imran\s+def\.\s+duelist.josh/); expect(items[0]).toHaveTextContent("2–1");
    expect(items[1]).toHaveTextContent(/duelist.josh\s+def\.\s+BlueEyesBen/);
    expect(items[2]).toHaveTextContent(/BlueEyesBen\s+def\.\s+Marik_Mains/); expect(items[2]).toHaveTextContent("reported");
    expect(items.every(item => item.querySelector("time"))).toBe(true);
  });

  it("preserves the old Bob def. Alice assertion, ignores unresolved and winner-less slots", () => {
    const bob = { ...decidedMatch, playerOneName: "Alice", playerTwoName: "Bob", winnerId: decidedMatch.playerTwoId, resolvedAt: "2026-09-30T22:00:00Z", series: null };
    show({ ...matchProps, tournament: tournament({ matches: [openMatch, { ...decidedMatch, id: 8, winnerId: null }, bob] }) });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent(/Bob\s+def\.\s+Alice/);
  });

  it("expands into full decided rows and appends byes, preserving expansion on refresh", () => {
    const props = { ...matchProps, tournament: tournament({ matches: [...matchProps.tournament.matches, byeMatch] }) };
    const { rerender } = show(props); const toggle = screen.getByRole("button", { name: "Show all 9" });
    expect(toggle).toHaveAttribute("aria-expanded", "false"); fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show recent" })).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Decided" });
    expect(within(group).getAllByRole("button", { name: "Reopen" })).toHaveLength(9);
    expect(Array.from(group.querySelectorAll("[id^='match-']")).at(-1)).toHaveAttribute("id", "match-16");
    expect(within(group).getByText("bye this round")).toBeInTheDocument();
    rerender(<SheetRoot><MatchQueue {...props} tournament={{ ...props.tournament, matches: [...props.tournament.matches] }} /></SheetRoot>);
    expect(screen.getByRole("button", { name: "Show recent" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show recent" })); expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("leaves out the match the Your match card shows, and only for a participant", () => {
    show(); expect(document.getElementById("match-1")).toBeNull();
    show({ ...matchProps, tournament: tournament({ isParticipant: false }) });
    expect(document.getElementById("match-1")).toBeInTheDocument();
  });

  it("keeps a queued report open during a tournament payload refresh", () => {
    const { rerender } = show(); const row = document.getElementById("match-2")!;
    fireEvent.click(within(row).getByRole("button", { name: "Report" }));
    rerender(<SheetRoot><MatchQueue {...matchProps} tournament={tournament()} /></SheetRoot>);
    expect(within(document.getElementById("match-2")!).getByText(/How did it go/)).toBeInTheDocument();
  });

  it("adds single elimination rounds to row state lines", () => {
    show({ ...matchProps, tournament: tournament({ format: "single_elim", isParticipant: false, matches: [{ ...openMatch, roundNumber: 2 }] }) });
    expect(screen.getByText("· Round 2")).toBeInTheDocument();
  });

  it("hides empty groups and preserves the no-matches empty state", () => {
    show({ ...matchProps, tournament: tournament({ matches: [] }) });
    expect(screen.getByText("No matches yet.")).toBeInTheDocument(); expect(screen.queryAllByRole("group")).toHaveLength(0);
  });
});
