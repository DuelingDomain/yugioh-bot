import type Database from "better-sqlite3";
import { isRemoteDuelUser } from "../access/remote-duel-users.js";
import { ExpectedError } from "../observability/index.js";

export class TournamentRemoteError extends ExpectedError {
  constructor(message: string, status: number, public readonly code: string,
    public readonly entrants?: { playerId: number; displayName: string }[]) {
    super(message, status);
    this.name = "TournamentRemoteError";
  }
}

export function assertRemoteTournamentEnabled(): void {
  if (process.env.REMOTE_DUELS !== "1") {
    throw new TournamentRemoteError("Remote Duels are disabled", 404, "REMOTE_DISABLED");
  }
}

export function assertRemoteTournamentUser(userId: number): void {
  assertRemoteTournamentEnabled();
  if (!isRemoteDuelUser(userId)) {
    throw new TournamentRemoteError("This tournament uses Remote Duels. Ask for access first.", 403, "REMOTE_ACCESS_REQUIRED");
  }
}

export function assertRemoteTournamentEntrants(db: Database.Database, tournamentId: number, playerIds?: number[]): void {
  assertRemoteTournamentEnabled();
  const players = db.prepare(`select p.id, p.user_id, p.display_name from tournament_participants tp
    join players p on p.id=tp.player_id where tp.tournament_id=? order by p.id`).all(tournamentId) as
    { id: number; user_id: number; display_name: string }[];
  const blocked = players.filter(p => (!playerIds || playerIds.includes(p.id)) && !isRemoteDuelUser(p.user_id))
    .map(p => ({ playerId: p.id, displayName: p.display_name }));
  if (blocked.length) throw new TournamentRemoteError("Some entrants do not have Remote Duel access", 409, "REMOTE_ENTRANTS_BLOCKED", blocked);
}

export function assertRemoteTournamentFormat(rules: { mode: string; settings: { genesys?: unknown } }): void {
  if (rules.mode !== "normal" || rules.settings.genesys != null) {
    throw new TournamentRemoteError("Remote tournaments support Advanced format only", 400, "REMOTE_FORMAT_UNSUPPORTED");
  }
}
