// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetRoot } from "@/components/sheet/sheet-root";
import { MatchQueue } from "@/components/tournament/matches/match-queue";
import type { MatchQueueProps } from "@/components/tournament/sheet-contracts";
import { byeMatch, decidedMatch, matchProps, openMatch, pendingMatch, tournament } from "../fixtures/matches";

const resultRows = (scope: HTMLElement) => Array.from(scope.querySelectorAll("li.hr-row"));
function show(props: MatchQueueProps = matchProps) { return render(<SheetRoot><MatchQueue {...props} /></SheetRoot>); }
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Matches queue", () => {
  it("has the shared anchor and groups the board's matches in waiting order", () => {
    show();
    const section = screen.getByRole("region", { name: "Matches" }); expect(section).toHaveAttribute("id", "matches");
    expect(screen.getByText("Grouped by what each match is waiting on")).toBeInTheDocument();
    expect(within(section).getAllByRole("group").map(group => group.getAttribute("aria-label"))).toEqual(["Live", "Owes a reply", "Not started", "Decided"]);
    expect(within(screen.getByRole("group", { name: "Not started" })).getAllByText("Imran")).toHaveLength(1);
    const rows = screen.getByRole("group", { name: "Not started" }).querySelectorAll("[id^='match-']");
    expect(Array.from(rows).map(row => row.id)).toEqual(["match-2", "match-5", "match-6"]);
    expect(resultRows(screen.getByRole("group", { name: "Decided" }))).toHaveLength(3);
  });

  it("shows the three newest results as winner beat loser, with the score or reported", () => {
    show(); const items = resultRows(document.body);
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Imran\s+beat\s+duelist.josh/); expect(items[0]).toHaveTextContent("2–1");
    expect(items[1]).toHaveTextContent(/duelist.josh\s+beat\s+BlueEyesBen/);
    expect(items[2]).toHaveTextContent(/BlueEyesBen\s+beat\s+Marik_Mains/); expect(items[2]).toHaveTextContent("Reported, confirmed");
    expect(items.every(item => item.querySelector("time"))).toBe(true);
  });

  it("keeps the old Bob beat Alice assertion, ignoring unresolved and winner-less slots", () => {
    const bob = { ...decidedMatch, playerOneName: "Alice", playerTwoName: "Bob", winnerId: decidedMatch.playerTwoId, resolvedAt: "2026-09-30T22:00:00Z", series: null };
    show({ ...matchProps, tournament: tournament({ matches: [openMatch, { ...decidedMatch, id: 8, winnerId: null }, bob] }) });
    expect(resultRows(document.body)).toHaveLength(1);
    expect(resultRows(document.body)[0]).toHaveTextContent(/Bob\s+beat\s+Alice/);
  });

  it("expands into full decided rows and appends byes, preserving expansion on refresh", () => {
    const props = { ...matchProps, tournament: tournament({ matches: [...matchProps.tournament.matches, byeMatch] }) };
    const { rerender } = show(props); const toggle = screen.getByRole("button", { name: "Show all" });
    expect(toggle).toHaveAttribute("aria-expanded", "false"); fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show recent" })).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Decided" });
    expect(within(group).getAllByRole("button", { name: "Reopen" })).toHaveLength(9);
    expect(Array.from(group.querySelectorAll("[id^='match-']")).at(-1)).toHaveAttribute("id", "match-16");
    expect(within(group).getByText("bye this round")).toBeInTheDocument();
    rerender(<SheetRoot><MatchQueue {...props} tournament={{ ...props.tournament, matches: [...props.tournament.matches] }} /></SheetRoot>);
    expect(screen.getByRole("button", { name: "Show recent" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show recent" })); expect(resultRows(document.body)).toHaveLength(3);
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

  it.each(["approve", "deny"] as const)("lets the opponent %s a pending report after the event ends", async action => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    show({ ...matchProps, currentUserPlayerId: 3, isHost: false, onChanged, tournament: tournament({ status: "completed", currentUserPlayerId: 3, matches: [pendingMatch, openMatch] }) });
    const group = screen.getByRole("group", { name: "Owes a reply" });
    expect(within(group).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Not started" })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: action === "approve" ? "Approve" : "Deny" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(`/api/matches/104/${action}`, { method: "POST" });
  });

  it.each([6, 99, null])("keeps a closed report read-only for viewer %s who is not the opponent", currentUserPlayerId => {
    show({ ...matchProps, currentUserPlayerId, tournament: tournament({ status: "completed", matches: [pendingMatch] }) });
    const group = screen.getByRole("group", { name: "Owes a reply" });
    expect(within(group).queryAllByRole("button")).toHaveLength(0);
    expect(group).toHaveTextContent("Waiting on duelist.josh");
  });

  it("lets a round robin host expand closed results and reopen a match", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    show({ ...matchProps, onChanged, tournament: tournament({ status: "completed", matches: [decidedMatch] }) });
    expect(resultRows(document.body)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(resultRows(document.body)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reopen match" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/reopen", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentMatchId: 7 }),
    });
  });

  it.each([
    ["round_robin", false],
    ["single_elim", true],
  ] as const)("keeps closed %s results read-only when isHost is %s", (format, isHost) => {
    show({ ...matchProps, isHost, tournament: tournament({ status: "completed", format, matches: [decidedMatch] }) });
    expect(resultRows(document.body)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });
});
