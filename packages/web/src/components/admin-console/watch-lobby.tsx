"use client";
import type { DuelRoom } from "@yugidraft/shared/duels";
import styles from "./live-watch.module.css";

/** The table has not started: who sits where. No seat, deck or Start control: an admin watch only reads. */
export function AdminLobbyPanel({ room }: { room: DuelRoom }) {
  const { session } = room;
  return (
    <section className={styles.lobby} aria-label="Waiting table" data-testid="admin-watch-lobby">
      <h1>{session.name}</h1>
      <p>This table has not started yet. The board appears here as soon as the duel begins.</p>
      <ul>
        {session.seats.map((seat) => (
          <li key={seat.seat}>
            <span className={styles.lobbySeat}>Seat {seat.seat + 1}</span>
            <strong>{seat.displayName}</strong>
            <span className={styles.lobbyState}>{seat.isBot ? "Bot" : seat.playerId == null ? "Open" : seat.ready ? "Ready" : "Choosing a deck"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
