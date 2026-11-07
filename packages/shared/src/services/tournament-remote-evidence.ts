import type Database from "better-sqlite3";

/** B4 handoff: called inside the proposal transaction, after the final room event/state and proposal are stored.
 * Implement sanitized evidence capture here; do not retain full snapshots or private decks. */
export function captureTournamentEvidence(_db: Database.Database, _tableId: number): void {
  // Evidence capture and retention belong to B4.
}
