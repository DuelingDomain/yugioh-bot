// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SheetRoot } from "@/components/sheet/sheet-root";
import { MatchRow, type MatchRowProps } from "@/components/tournament/matches/match-row";
import type { Match } from "@/components/tournament/types";
import { byeMatch, decidedMatch, liveMatch, matchProps, openMatch, pendingMatch, seriesFor, tournament } from "../fixtures/matches";

function renderRow(match: Match = openMatch, overrides: Partial<MatchRowProps> = {}) {
  const props = { ...matchProps, isHost: false, match, ...overrides };
  return { ...render(<SheetRoot><MatchRow {...props} /></SheetRoot>), props };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); push.mockReset(); });

describe("match row presentation and permissions", () => {
  it("has the row anchor, player gems and the open player state", () => {
    const { container } = renderRow();
    const row = container.querySelector("#match-1")!;
    expect(row).toHaveAttribute("data-s", "you");
    expect(row).toHaveTextContent(/Your match · not started/);
    expect(row.querySelectorAll("svg[viewBox='0 0 24 24']").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it("spectators see neither Report nor Start duel", () => {
    renderRow(openMatch, { currentUserPlayerId: 99 });
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start duel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set result" })).toBeNull();
  });

  it("an organizer outside the match sees quiet Start duel and Set result", () => {
    renderRow(openMatch, { currentUserPlayerId: 99, isHost: true });
    expect(screen.getByRole("button", { name: "Start duel" })).toHaveClass("btn-quiet");
    expect(screen.getByRole("button", { name: "Set result" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    expect(screen.queryByText("Organizer")).toBeNull();
  });

  it.each([6, 5, 99, null])("hides Approve and Deny from player %s who is not the reporter's opponent", playerId => {
    renderRow(pendingMatch, { currentUserPlayerId: playerId, isHost: true });
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    expect(screen.getByText("Waiting on duelist.josh")).toBeInTheDocument();
    if (playerId === 6) expect(screen.getByText("You reported a win.")).toBeInTheDocument();
    else expect(screen.getByText("Marik_Mains reported a win.")).toBeInTheDocument();
  });

  it("shows the opponent's confirmation wording, including a reported loss", () => {
    renderRow({ ...pendingMatch, winnerId: 3 }, { currentUserPlayerId: 3 });
    expect(screen.getByText("Marik_Mains says they lost.")).toBeInTheDocument();
    expect(screen.getByText(/If you do nothing, it approves itself after 24 hours\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
  });

  it("Reopen is absent in single elimination; round labels only appear there", () => {
    renderRow({ ...decidedMatch, roundNumber: 2 }, { isHost: true, tournament: tournament({ format: "single_elim" }) });
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
    expect(screen.getByText("· Round 2")).toBeInTheDocument();
    expect(screen.getByText("2–1")).toHaveClass("m-sc");
    expect(screen.getByText(/Imran won.*online, best of 3/)).toBeInTheDocument();
  });

  it("reported decisions use def. and byes do not offer actions", () => {
    const { unmount } = renderRow({ ...decidedMatch, series: null });
    expect(screen.getByText("def.")).toHaveClass("m-vs");
    expect(screen.queryByText(/online, best of/)).toBeNull();
    unmount(); renderRow(byeMatch, { isHost: true });
    expect(screen.getByText("bye this round")).toBeInTheDocument();
    expect(screen.getByText("No match to play · not counted as a win in standings")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("retained terminal slots hide start/Set result while completed round robin keeps Reopen", () => {
    const { unmount } = renderRow(openMatch, { isHost: true, tournament: tournament({ status: "cancelled" }) });
    expect(screen.queryByRole("button", { name: "Start duel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set result" })).toBeNull();
    unmount(); renderRow(decidedMatch, { isHost: true, tournament: tournament({ status: "completed" }) });
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });
});

describe("match actions and inline failures", () => {
  it.each(["win", "loss"] as const)("reports a %s with the existing body and two equal choices", async result => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn(); renderRow(openMatch, { onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const won = screen.getByRole("button", { name: /I won/ });
    const lost = screen.getByRole("button", { name: /I lost/ });
    expect(won).toHaveClass("btn"); expect(lost).not.toHaveClass("btn-danger");
    expect(screen.queryByRole("button", { name: "Start duel" })).toBeNull();
    fireEvent.click(result === "win" ? won : lost);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/report", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentMatchId: 1, result }),
    });
    expect(screen.queryByText(/How did it go/)).toBeNull();
  });

  it("cancels reporting and keeps its local state when a fresh match object arrives", () => {
    const { rerender, props } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    rerender(<SheetRoot><MatchRow {...props} match={{ ...openMatch }} tournament={{ ...props.tournament }} /></SheetRoot>);
    expect(screen.getByText(/How did it go/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it.each(["approve", "deny"] as const)("posts %s to the linked report", async action => {
    const fetchMock = vi.fn(async () => Response.json({ success: true })); vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn(); renderRow(pendingMatch, { currentUserPlayerId: 3, onChanged });
    fireEvent.click(screen.getByRole("button", { name: action === "approve" ? "Approve" : "Deny" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(`/api/matches/104/${action}`, { method: "POST" });
  });

  it.each([
    ["Report", "I won", "Failed to report match"],
    ["Approve", null, "Failed to approve"],
    ["Deny", null, "Failed to deny"],
    ["Start duel", null, "Failed to start the duel"],
    ["Reopen", "Reopen match", "Failed to reopen"],
  ])("keeps the %s fallback inline and never calls alert", async (button, secondButton, error) => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 500 })));
    const match = button === "Reopen" ? decidedMatch : ["Approve", "Deny"].includes(button) ? pendingMatch : openMatch;
    renderRow(match, { isHost: true, currentUserPlayerId: button === "Approve" || button === "Deny" ? 3 : 5 });
    fireEvent.click(screen.getByRole("button", { name: button }));
    if (secondButton) fireEvent.click(screen.getByRole("button", { name: new RegExp(secondButton) }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error!);
    expect(alert).not.toHaveBeenCalled();
  });

  it("retains API error messages and handles a network failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "This match is already decided" }, { status: 409 })).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock); renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.click(screen.getByRole("button", { name: /I won/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This match is already decided");
    fireEvent.click(screen.getByRole("button", { name: /I lost/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to report match"));
  });

  it("requires a Reopen confirmation, can keep the result, and preserves the request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true })); vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn(); renderRow(decidedMatch, { isHost: true, onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByText("Reopen this match?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep result" }));
    expect(screen.queryByText("Reopen this match?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen match" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/reopen", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tournamentMatchId: 7 }),
    });
  });
});

describe("online match states", () => {
  it("starts a duel and navigates to the existing destination", async () => {
    const fetchMock = vi.fn(async () => Response.json({ duel: { slug: "new-duel" } }, { status: 201 })); vi.stubGlobal("fetch", fetchMock);
    renderRow(); fireEvent.click(screen.getByRole("button", { name: "Start duel" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/duels/new-duel"));
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/matches/1/duel", { method: "POST" });
  });

  it("links the missing-deck guidance inline to My deck", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Marik_Mains has not registered a deck" }, { status: 409 })));
    renderRow(); fireEvent.click(screen.getByRole("button", { name: "Start duel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/has not registered a deck.*My deck/);
    expect(screen.getByRole("link", { name: "My deck" })).toHaveAttribute("href", "#my-deck");
    expect(alert).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });

  it("refreshes and shows the original missing-link message after a malformed success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true })));
    const onChanged = vi.fn(); renderRow(openMatch, { onChanged }); fireEvent.click(screen.getByRole("button", { name: "Start duel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The duel started, but its link is missing. Reload the page.");
    expect(onChanged).toHaveBeenCalledOnce(); expect(push).not.toHaveBeenCalled();
  });

  it("puts the live score between names, with Open duel for players", () => {
    renderRow(liveMatch, { currentUserPlayerId: 1 });
    expect(screen.getByTestId("tournament-match-score-3")).toHaveTextContent("1–0");
    expect(screen.getByText("Game 2 in progress · Kestrel took game 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open duel" })).toHaveAttribute("href", "/duels/duel-3");
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("offers Watch to everyone else and Set result to the organizer", () => {
    renderRow(liveMatch, { isHost: true });
    expect(screen.getByRole("link", { name: "Watch" })).toHaveAttribute("href", "/duels/duel-3");
    expect(screen.queryByRole("link", { name: "Open duel" })).toBeNull();
    expect(screen.getByText("Organizer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set result" })).toBeInTheDocument();
  });

  it("restores Report after a cancelled series or denied report refresh", () => {
    const { rerender, props } = renderRow({ ...openMatch, series: seriesFor(openMatch) });
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    rerender(<SheetRoot><MatchRow {...props} match={{ ...openMatch, series: seriesFor(openMatch, { status: "cancelled" }) }} /></SheetRoot>);
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start duel" })).toBeInTheDocument();
  });

  it("returns to not started after a denied report, clearing the stale report panel", () => {
    const { rerender, props } = renderRow(); fireEvent.click(screen.getByRole("button", { name: "Report" }));
    rerender(<SheetRoot><MatchRow {...props} match={{ ...openMatch, status: "pending_approval", winnerId: 5, reporterId: 5 }} /></SheetRoot>);
    expect(screen.getByText("You reported a win.")).toBeInTheDocument();
    rerender(<SheetRoot><MatchRow {...props} match={{ ...openMatch }} /></SheetRoot>);
    expect(screen.getByText(/Your match · not started/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report" })).toBeInTheDocument(); expect(screen.queryByText(/How did it go/)).toBeNull();
  });

  it("ticks between-games down once a second, stops at zero and accepts a changed deadline", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    const match = { ...liveMatch, series: seriesFor(liveMatch, { status: "between_games", wins: [1, 1], nextGameAt: "2026-10-01T12:01:40Z" }) };
    const { rerender, props } = renderRow(match);
    expect(screen.getByText(/Between games · game 3 starts in/)).toHaveTextContent("1:40");
    act(() => vi.advanceTimersByTime(1000)); expect(screen.getByText("1:39")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(99000)); expect(screen.getByText("0:00")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000)); expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<SheetRoot><MatchRow {...props} match={{ ...match, series: { ...match.series, nextGameAt: null } }} /></SheetRoot>);
    expect(screen.getByText("Between games · side decking")).toBeInTheDocument();
  });
});

describe("Set result dialog", () => {
  it("focuses on open, traps Tab, closes on Escape and restores the opener", () => {
    renderRow(openMatch, { isHost: true });
    const opener = screen.getByRole("button", { name: "Set result" }); opener.focus(); fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Set the result" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const radio = within(dialog).getByRole("radio", { name: "Imran" }); expect(radio).toHaveFocus();
    fireEvent.keyDown(radio, { key: "Tab", shiftKey: true }); expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(radio).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull(); expect(opener).toHaveFocus();
  });

  it("without a series, Record result is purple and disabled until selection, and Cancel resets the selection", () => {
    renderRow(openMatch, { isHost: true });
    const opener = screen.getByRole("button", { name: "Set result" }); fireEvent.click(opener);
    expect(screen.queryByText(/This cancels the online duel/)).toBeNull();
    const confirm = screen.getByRole("button", { name: "Record result" }); expect(confirm).toBeDisabled(); expect(confirm).toHaveClass("btn-primary");
    fireEvent.click(screen.getByRole("radio", { name: "Imran" })); expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "Record result" })).toBeDisabled();
  });

  it("warns about a live series and records the organizer's chosen winner", async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true })); vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn(); renderRow(liveMatch, { isHost: true, onChanged }); fireEvent.click(screen.getByRole("button", { name: "Set result" }));
    expect(screen.getByText(/This cancels the online duel in progress, which Kestrel leads/)).toHaveTextContent("1–0");
    const confirm = screen.getByRole("button", { name: "End duel and record" }); expect(confirm).toBeDisabled(); expect(confirm).toHaveClass("btn-danger");
    fireEvent.click(screen.getByRole("radio", { name: "voidpriest" })); fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday-night-duels-12/matches/3/result", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winnerPlayerId: 2 }),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("handles a tied series and shows result errors inside the modal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 500 })));
    renderRow({ ...liveMatch, series: seriesFor(liveMatch, { status: "between_games", wins: [1, 1] }) }, { isHost: true });
    fireEvent.click(screen.getByRole("button", { name: "Set result" }));
    expect(screen.getByText(/which is tied/)).toHaveTextContent("1–1");
    fireEvent.click(screen.getByRole("radio", { name: "Kestrel" })); fireEvent.click(screen.getByRole("button", { name: "End duel and record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to set the result");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps an open dialog and the chosen winner across live payload refreshes", () => {
    const { rerender, props } = renderRow(liveMatch, { isHost: true });
    fireEvent.click(screen.getByRole("button", { name: "Set result" })); fireEvent.click(screen.getByRole("radio", { name: "voidpriest" }));
    rerender(<SheetRoot><MatchRow {...props} tournament={tournament()} match={{ ...liveMatch, series: seriesFor(liveMatch, { wins: [1, 1], gameNumber: 3 }) }} /></SheetRoot>);
    expect(screen.getByRole("radio", { name: "voidpriest" })).toBeChecked();
    expect(screen.getByRole("button", { name: "End duel and record" })).toBeEnabled();
    expect(screen.getByText(/which is tied/)).toHaveTextContent("1–1");
  });
});
