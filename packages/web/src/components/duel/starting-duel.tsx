"use client";

import type { DuelRoom } from "@yugidraft/shared/duels";
import { duelFontClasses } from "./fonts";
import { cx } from "./sheet-ui";
import { formatLabel } from "./table-format";
import styles from "./starting-duel.module.css";

/**
 * Where the "Starting duel" state shows.
 * - `banner`: over the dice or RPS result, which stays on screen behind it.
 * - `card`: over the lobby, for a start with no opening (Tag, 1v1 without RPS) or an active room whose engine view is not there yet.
 * - `null`: nothing. A failed start clears the host flag, so the normal lobby comes back with no extra state here.
 */
export type StartingVariant = "banner" | "card";

export function startingVariant(room: Pick<DuelRoom, "starting" | "opening" | "engine" | "error"> & { session: Pick<DuelRoom["session"], "status"> }): StartingVariant | null {
  if (room.session.status === "lobby") {
    if (room.starting !== true) return null;
    return room.opening ? "banner" : "card";
  }
  // Active, but the first engine view has not arrived: the field has nothing to draw yet.
  if (room.session.status === "active" && !room.engine && !room.error) return "card";
  return null;
}

/** A calm loading state between the opening result and the field. Fixed over the page, so nothing under it moves. */
export function StartingDuel({ room, variant, reducedMotion = false }: { room: Pick<DuelRoom, "session">; variant: StartingVariant; reducedMotion?: boolean }) {
  const { session } = room;
  const names = session.seats.filter((seat) => seat.playerId != null).map((seat) => seat.displayName ?? `Player ${seat.seat + 1}`);
  if (variant === "banner") {
    return (
      <div className={cx(styles.banner, duelFontClasses)} data-testid="starting-duel" data-variant="banner" data-reduced={reducedMotion ? "true" : undefined}>
        <div className={styles.pill} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden />
          <span className={styles.label}>Starting duel</span>
          <span className={styles.bar} aria-hidden />
        </div>
      </div>
    );
  }
  return (
    <div className={cx(styles.card, duelFontClasses)} data-testid="starting-duel" data-variant="card" data-reduced={reducedMotion ? "true" : undefined}>
      <div className={styles.panel} role="status" aria-live="polite">
        <p className={styles.kicker}>{formatLabel(session.format)}</p>
        <h2 className={styles.title}>Starting duel</h2>
        {names.length > 0 ? (
          <ul className={styles.names} aria-label="Players">
            {names.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
          </ul>
        ) : null}
        <span className={styles.bar} aria-hidden />
        <span className={styles.sr}>Setting up the table</span>
      </div>
    </div>
  );
}
