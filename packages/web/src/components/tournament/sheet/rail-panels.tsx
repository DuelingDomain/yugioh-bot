"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Flag, Lock, X } from "lucide-react";
import { ConfirmPanel, DangerRow, DangerZone, RankGem, SheetPanel } from "@/components/sheet";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { useOptionalRouter } from "../use-optional-router";

/** Decks (organizer) or Players (everyone else): one list, ids "players" for the old ?tab=players link. */
export function PlayersPanel({ tournament, isHost, ratings }: { tournament: TournamentDetail; isHost: boolean; ratings: PlayerRatings }) {
  return (
    <SheetPanel id="players" title={isHost ? "Decks" : "Players"} aside={<small>{isHost ? "organizer only" : `${tournament.participants.length} players`}</small>}>
      <ul className="plist">
        {tournament.participants.map((player) => (
          <li key={player.playerId}>
            <span className="nm">
              <RankGem tier={ratings.get(player.playerId)?.rank ?? "none"} />
              <Link href={`/player/${player.playerId}`}>{player.displayName}</Link>
              {player.playerId === tournament.currentUserPlayerId && <span className="youtag">you</span>}
            </span>
            {isHost && (player.deckRegistered !== undefined || player.deckLocked === true) && (
              player.deckLocked ? <span className="deckst ok"><Lock className="ic sm" aria-hidden="true" />Locked</span>
                : player.deckRegistered ? <span className="deckst ok"><Check className="ic sm" aria-hidden="true" />Registered</span>
                  : <span className="deckst no"><span className="lamp" data-s="wait" aria-hidden="true" />No deck yet</span>
            )}
          </li>
        ))}
      </ul>
    </SheetPanel>
  );
}

/** End now and Cancel, fenced off. Both confirm in place; same endpoints as the old host controls. */
export function EndingEarly({ tournament, tournamentSlug, onChanged }: { tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void }) {
  const router = useOptionalRouter();
  const [confirm, setConfirm] = useState<"complete" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (tournament.status !== "active") return null;

  async function run(kind: "complete" | "cancel") {
    setBusy(true);
    setError(null);
    const fallback = kind === "complete" ? "Failed to end tournament" : "Failed to cancel";
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}${kind === "complete" ? "/complete" : ""}`, { method: kind === "complete" ? "POST" : "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? fallback);
      }
      if (kind === "cancel") router?.push("/tournaments");
      else { setConfirm(null); onChanged(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DangerZone title="Ending early">
      {confirm ? (
        <ConfirmPanel
          title={confirm === "complete" ? "End the tournament now?" : "Cancel this tournament?"}
          confirmLabel={confirm === "complete" ? "Yes, end now" : "Yes, cancel"}
          cancelLabel="Go back"
          busy={busy}
          onCancel={() => { setConfirm(null); setError(null); }}
          onConfirm={() => run(confirm)}
        >
          {confirm === "complete" ? "Unplayed matches stay unplayed. No champion is recorded." : "It closes for everyone, results and Elo included, and can't be reopened."}
        </ConfirmPanel>
      ) : (
        <>
          <DangerRow title="End tournament now" description="Unplayed matches stay unplayed. No champion is recorded." action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm("complete")}><Flag className="ic sm" aria-hidden="true" />End now</button>} />
          <DangerRow title="Cancel tournament" description="Removes it for everyone, results and Elo included." action={<button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirm("cancel")}><X className="ic sm" aria-hidden="true" />Cancel</button>} />
        </>
      )}
      {error && <div className="banner banner-bad" role="alert"><p>{error}</p></div>}
    </DangerZone>
  );
}
