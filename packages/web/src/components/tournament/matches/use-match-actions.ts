"use client";

import { useEffect, useState } from "react";
import { closePendingDuelWindow, navigateDuelWindow, openPendingDuelWindow } from "@/components/duel/duel-window";
import { isSeriesOpen, startDuelErrorText } from "../duel-rules";
import { useOptionalRouter } from "../use-optional-router";
import type { Match } from "../types";

/** Longer than a healthy Start duel; the player sees the usual start error after it. */
export const START_TIMEOUT_MS = 20_000;

type Action = "report" | "approve" | "deny" | "start" | "result" | "reopen";

/** All requests retain the existing endpoints and bodies. UI failures stay inline. */
export function useMatchActions(match: Match, tournamentSlug: string, onChanged: () => void) {
  const router = useOptionalRouter();
  const [reporting, setReporting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [loading, setLoading] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const seriesOpen = isSeriesOpen(match.series);
  useEffect(() => {
    if (match.status !== "open" || seriesOpen) setReporting(false);
    if (match.status !== "completed") setReopening(false);
    if (match.status === "completed") { setResultOpen(false); setWinner(null); setResultError(null); }
  }, [match.status, seriesOpen]);

  function closeResult() { setResultOpen(false); setWinner(null); setResultError(null); }

  async function request(action: Action, url: string, fallback: string, body?: object) {
    setLoading(action);
    // Inside the click, so pop-up blockers allow it; the duel's slug is not known until the server answers.
    let duelWindow = action === "start" ? openPendingDuelWindow() : null;
    if (action === "result") setResultError(null); else setError(null);
    // A hung start request must not leave a blank window open: the abort lands in the catch below.
    const controller = action === "start" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), START_TIMEOUT_MS) : null;
    try {
      const init: RequestInit = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" };
      if (controller) init.signal = controller.signal;
      const res = await fetch(url, init);
      // JSON failures use the original fallback; successful non-start responses need no body.
      const data = action === "start" || !res.ok ? await res.json().catch(() => null) : null;
      if (!res.ok) {
        const message = typeof data?.error === "string" ? data.error : fallback;
        if (action === "result") setResultError(message);
        else setError(action === "start" ? startDuelErrorText(res.status, message) : message);
        closePendingDuelWindow(duelWindow);
        return;
      }
      if (action === "start") {
        const slug: unknown = data?.duel?.slug;
        if (typeof slug !== "string") {
          setError("The duel started, but its link is missing. Reload the page.");
          closePendingDuelWindow(duelWindow);
          onChanged();
          return;
        }
        // The duel runs in the window opened at the click; this page stays on the floor. A blocked or
        // closed window means the duel opens here, straight onto the board.
        if (duelWindow && navigateDuelWindow(duelWindow, slug)) {
          duelWindow = null; // handed over: the catch below must not close it
          onChanged();
          return;
        }
        if (router) router.push(`/duels/${slug}`);
        else window.location.assign(`/duels/${slug}`);
        return;
      }
      if (action === "report") setReporting(false);
      if (action === "reopen") setReopening(false);
      if (action === "result") closeResult();
      onChanged();
    } catch (err) {
      closePendingDuelWindow(duelWindow);
      // A timed-out start may still have made the duel: refresh so the row shows Open duel.
      if (controller?.signal.aborted) onChanged();
      const message = action === "report" || action === "start" ? fallback : err instanceof Error ? err.message : fallback;
      if (action === "result") setResultError(message); else setError(message);
    } finally {
      if (timer) clearTimeout(timer);
      setLoading(null);
    }
  }

  const root = `/api/tournaments/${tournamentSlug}`;
  return {
    reporting, reopening, resultOpen, winner, loading, error, resultError,
    setWinner, closeResult,
    openReport: () => { setError(null); setReporting(true); },
    cancelReport: () => { setError(null); setReporting(false); },
    openReopen: () => { setError(null); setReopening(true); },
    cancelReopen: () => { setError(null); setReopening(false); },
    openResult: () => { setWinner(null); setResultError(null); setResultOpen(true); },
    report: (result: "win" | "loss") => request("report", `${root}/report`, "Failed to report match", { tournamentMatchId: match.id, result }),
    approve: () => { if (match.matchId) return request("approve", `/api/matches/${match.matchId}/approve`, "Failed to approve"); },
    deny: () => { if (match.matchId) return request("deny", `/api/matches/${match.matchId}/deny`, "Failed to deny"); },
    start: () => request("start", `${root}/matches/${match.id}/duel`, "Failed to start the duel"),
    reopen: () => request("reopen", `${root}/reopen`, "Failed to reopen", { tournamentMatchId: match.id }),
    recordResult: () => { if (winner !== null) return request("result", `${root}/matches/${match.id}/result`, "Failed to set the result", { winnerPlayerId: winner }); },
  };
}

export type MatchActions = ReturnType<typeof useMatchActions>;
