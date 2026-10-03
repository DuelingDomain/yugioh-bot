"use client";

import { useState } from "react";
import Link from "next/link";
import { Mono, StatusLine, SvButton, ringColour, YouPill } from "@/components/sheet";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { DeckMarker } from "../deck-marker";
import { useOptionalRouter } from "../use-optional-router";
import styles from "./rail.module.css";

/** The organizer's list of who has a deck in. Everyone else sees the standings instead. */
export function PlayersPanel({ tournament }: { tournament: TournamentDetail; ratings?: PlayerRatings }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {tournament.participants.map((player) => (
        <li key={player.playerId} className={styles.deckRow}>
          <span className={styles.deckName}>
            <Mono name={player.displayName} size="sm" ring={ringColour(player.playerId)} you={player.playerId === tournament.currentUserPlayerId} />
            <Link href={`/player/${player.playerId}`}>{player.displayName}</Link>
            {player.playerId === tournament.currentUserPlayerId && <YouPill />}
          </span>
          <DeckMarker participant={player} />
        </li>
      ))}
    </ul>
  );
}

/** End now and Cancel. Both confirm in place; same endpoints as the old host controls. */
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
    <div>
      {confirm ? (
        <div className={styles.confirmBox}>
          <StatusLine tone="warn">
            <strong>{confirm === "complete" ? "End the tournament now?" : "Cancel this tournament?"}</strong>{" "}
            {confirm === "complete" ? "Unplayed matches stay unplayed. No champion is recorded." : "It closes for everyone, results and Elo included, and can't be reopened."}
          </StatusLine>
          <div className={styles.endActs}>
            <SvButton variant="quiet" disabled={busy} onClick={() => { setConfirm(null); setError(null); }}>Go back</SvButton>
            <SvButton variant="danger" disabled={busy} aria-busy={busy} onClick={() => run(confirm)}>{confirm === "complete" ? "Yes, end now" : "Yes, cancel"}</SvButton>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.endRow}>
            <p className={styles.endT}>End the tournament early</p>
            <p className={styles.endN}>Unplayed matches stay unplayed and no champion is recorded.</p>
            <div className={styles.endActs}><SvButton onClick={() => setConfirm("complete")}>End now</SvButton></div>
          </div>
          <div className={styles.endRow}>
            <p className={styles.endT}>Remove it</p>
            <p className={styles.endN}>Removes the tournament for everyone, results and Elo included.</p>
            <div className={styles.endActs}><SvButton variant="danger" onClick={() => setConfirm("cancel")}>Cancel the tournament</SvButton></div>
          </div>
        </>
      )}
      {error && <div className={styles.err} role="alert"><StatusLine tone="block">{error}</StatusLine></div>}
    </div>
  );
}
