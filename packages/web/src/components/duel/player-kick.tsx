"use client";

import { useRef, type ReactNode } from "react";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cx } from "./sheet-ui";
import styles from "./player-kick.module.css";

export interface KickTarget { playerId: number; displayName: string }

/** Where the host kicks from: a pending invite, a lobby seat, or a seat in the opening. Never a live duel. */
export type KickScope = "invited" | "seated" | "opening";

/** What the confirm dialog asks. The page holds one, so every Kick control opens the same dialog. */
export interface KickRequest { player: KickTarget; scope: KickScope }

/** The plain words for what happens to the player, and whether they can come back. */
export function kickConsequence({ player, scope }: KickRequest): string[] {
  const name = player.displayName;
  switch (scope) {
    case "invited":
      return [`${name}'s invitation is removed. They cannot open this duel until you invite them again.`];
    case "seated":
      return [`${name} loses their seat and leaves this table.`, "They can return only if you invite them again."];
    case "opening":
      return [`${name} loses their seat and the opening is cancelled.`, "You can invite them again from the table."];
  }
}

/** The Kick control of one player row. Host only; the caller never renders it on the host's own row. */
export function KickPlayerButton({ player, scope, busy, onAsk, className, label = "Kick" }: {
  player: KickTarget; scope: KickScope; busy: boolean; onAsk: (request: KickRequest) => void;
  className?: string; label?: string;
}) {
  return (
    <button type="button" className={cx(styles.kick, className)} disabled={busy} data-testid="kick-player"
      aria-label={`${label} ${player.displayName}`} title={`${label} ${player.displayName}`}
      onClick={() => onAsk({ player, scope })}>
      <UserX size={14} strokeWidth={1.7} aria-hidden />
      {label}
    </button>
  );
}

/** The confirm dialog. It stays open while the kick is sent, and shows the error if the kick fails. */
export function KickPlayerDialog({ request, busy, error, onClose, onConfirm }: {
  request: KickRequest | null; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void;
}) {
  // The dialog fades out after `request` clears; keep the last words on screen while it does.
  const last = useRef<KickRequest | null>(null);
  if (request) last.current = request;
  const shown = request ?? last.current;
  const lines = shown ? kickConsequence(shown) : [];
  // The opening screen is a full-screen layer; the wrapper lifts the dialog above it.
  return (
    <div className={styles.layer}>
      <Modal open={request != null} onClose={() => { if (!busy) onClose(); }} title={shown ? `Kick ${shown.player.displayName}?` : "Kick player"}
        describedBy="kick-dialog-text">
        <div id="kick-dialog-text" className="grid gap-2 text-sm leading-relaxed text-text-secondary">
          {lines.map(line => <p key={line}>{line}</p>)}
        </div>
        {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
        <div className="mt-5 flex gap-2">
          <Button type="button" variant="danger" loading={busy} onClick={onConfirm} data-testid="kick-confirm">
            {error ? "Try again" : `Kick ${shown?.player.displayName ?? ""}`.trim()}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      </Modal>
    </div>
  );
}

function PlayerRows({ players, scope, busy, onAsk }: {
  players: KickTarget[]; scope: KickScope; busy: boolean; onAsk: (request: KickRequest) => void;
}) {
  return (
    <ul className={styles.rows}>
      {players.map(player => (
        <li key={player.playerId} className={styles.row}>
          <span className={styles.avatar} aria-hidden>{(player.displayName.trim()[0] ?? "?").toUpperCase()}</span>
          <span className={styles.name}>{player.displayName}</span>
          <KickPlayerButton player={player} scope={scope} busy={busy} onAsk={onAsk} />
        </li>
      ))}
    </ul>
  );
}

/** The host's Kick controls under the opening (rock-paper-scissors or dice): the same rows, inline. */
export function HostOpeningKick({ players, busy, onAsk }: {
  players: KickTarget[]; busy: boolean; onAsk: (request: KickRequest) => void;
}): ReactNode {
  if (players.length === 0) return null;
  return (
    <div className={styles.inline} data-testid="host-opening-kick">
      <p className={styles.panelTitle}>Host</p>
      <PlayerRows players={players} scope="opening" busy={busy} onAsk={onAsk} />
    </div>
  );
}
