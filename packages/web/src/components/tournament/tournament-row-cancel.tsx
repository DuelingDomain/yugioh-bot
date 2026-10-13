"use client";

import { useState } from "react";
import { CancelTournamentDialog } from "./cancel-tournament-dialog";
import type { TournamentListItem } from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

/**
 * The organizer's Cancel control on a tournament row. It is its own client component because the row
 * also renders on the server (the dashboard). The dialog mounts on the first click, so a list of rows
 * adds no portal until someone asks to cancel.
 */
export function TournamentRowCancel({ tournament, onCancelled }: {
  tournament: TournamentListItem;
  /** Runs after the server cancelled the tournament. */
  onCancelled?: (tournament: TournamentListItem) => void;
}) {
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(false);
  if (!tournament.webSlug) return null;
  return (
    <>
      <button
        type="button"
        className={styles.cancelLink}
        aria-label={`Cancel tournament ${tournament.name}`}
        aria-haspopup="dialog"
        onClick={() => { setAsked(true); setOpen(true); }}
      >
        Cancel tournament
      </button>
      {asked && (
        <CancelTournamentDialog
          open={open}
          target={{ name: tournament.name, status: tournament.status, participantCount: tournament.participantCount, slug: tournament.webSlug }}
          onClose={() => setOpen(false)}
          onCancelled={() => onCancelled?.(tournament)}
        />
      )}
    </>
  );
}
