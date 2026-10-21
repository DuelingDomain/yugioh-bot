"use client";

import { SheetButton } from "./sheet-ui";

/** Minimal shared control for lobby seats, pending invites and the live Players menu. */
export function KickPlayerButton({ playerId, displayName, active = false, busy, onKick }: {
  playerId: number; displayName: string; active?: boolean; busy: boolean; onKick: (playerId: number) => void;
}) {
  return <SheetButton kind="quiet" size="sm" disabled={busy} aria-label={`Kick ${displayName}`} onClick={() => {
    const consequence = active ? "Their seat will surrender under this duel's rules. " : "Their seat or invitation will be removed. ";
    if (window.confirm(`Kick ${displayName}? ${consequence}They can return only if you re-invite them.`)) onKick(playerId);
  }}>Kick</SheetButton>;
}
