import { DEFAULT_DUEL_FORMAT, DUEL_FORMATS, seatCountFor, type DuelFormat } from "./settings.js";

/**
 * Feature flag MULTIPLAYER_TABLES. Off by default in code: only 1v1 tables exist. The Compose files set it on (default `1`), so Tag and 3 or 4 player tables
 * are open in production and staging; `MULTIPLAYER_TABLES=0` closes them. The flag is read from the process environment each time it is asked, so a restart (not a build)
 * switches it. Only "1", "true" and "on" turn it on.
 */
export const MULTIPLAYER_TABLES_ENV = "MULTIPLAYER_TABLES";

export const MULTIPLAYER_TABLES_OFF_MESSAGE = "Only 1v1 tables are open on this server. Tag, 3-player and 4-player tables are not available yet.";

export function multiplayerTablesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[MULTIPLAYER_TABLES_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
}

/** The table types a creator may offer. Only 1v1 while the flag is off. */
export function enabledDuelFormats(enabled: boolean): readonly DuelFormat[] {
  return enabled ? DUEL_FORMATS : [DEFAULT_DUEL_FORMAT];
}

/** A reason why this table type cannot be made or started, or null when it can. */
export function multiplayerTablesBlockReason(format: DuelFormat | undefined, enabled: boolean): string | null {
  if (enabled || format === undefined || format === DEFAULT_DUEL_FORMAT) return null;
  return MULTIPLAYER_TABLES_OFF_MESSAGE;
}

/** Same check by seat count (the duel host counts seats). */
export function multiplayerSeatsBlockReason(seatCount: number, enabled: boolean): string | null {
  if (enabled || seatCount <= seatCountFor(DEFAULT_DUEL_FORMAT)) return null;
  return MULTIPLAYER_TABLES_OFF_MESSAGE;
}
