"use client";

import { useState } from "react";
import Link from "next/link";
import { Mono, StatusLine, SvButton, ringColour, YouPill } from "@/components/sheet";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { DeckMarker } from "../deck-marker";
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

/**
 * End now (keep results) and Cancel (no results). End now confirms in place; Cancel asks the sheet to
 * open the cancel dialog (`onCancel`), which sits outside the drawer so the two dialogs never trap each other.
 */
export function EndingEarly({ tournament, tournamentSlug, onChanged, onCancel }: { tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void; onCancel: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (tournament.status !== "active") return null;

  async function endNow() {
    setBusy(true);
    setError(null);
    const fallback = "Failed to end tournament";
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}/complete`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? fallback);
      }
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {confirming ? (
        <div className={styles.confirmBox}>
          <StatusLine tone="warn">
            <strong>End the tournament now?</strong>{" "}
            Unplayed matches stay unplayed and open games close. The standings so far are kept. No champion is recorded.
          </StatusLine>
          <div className={styles.endActs}>
            <SvButton variant="quiet" disabled={busy} onClick={() => { setConfirming(false); setError(null); }}>Go back</SvButton>
            <SvButton variant="danger" disabled={busy} aria-busy={busy} onClick={endNow}>Yes, end now</SvButton>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.endRow}>
            <p className={styles.endT}>End now (keep results)</p>
            <p className={styles.endN}>Closes the tournament with the standings as they are. Unplayed matches stay unplayed and no champion is recorded.</p>
            <div className={styles.endActs}><SvButton onClick={() => setConfirming(true)}>End now</SvButton></div>
          </div>
          <div className={styles.endRow}>
            <p className={styles.endT}>Cancel (no results)</p>
            <p className={styles.endN}>Cancels open matches and records no final standings. You are asked to confirm.</p>
            <div className={styles.endActs}><SvButton variant="danger" onClick={onCancel}>Cancel tournament</SvButton></div>
          </div>
        </>
      )}
      {error && <div className={styles.err} role="alert"><StatusLine tone="block">{error}</StatusLine></div>}
    </div>
  );
}
