import { randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { TournamentVisibility } from "../types/index.js";

export class TournamentVisibilityServiceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

export function isTournamentVisibility(value: unknown): value is TournamentVisibility {
  return value === "open" || value === "private";
}

// Mirror private duel invites, including a timing-safe operation on length mismatch.
function inviteCodeMatches(stored: string, provided: string): boolean {
  const expected = Buffer.from(stored);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(expected, actual);
}

type Row = { id: number; status: string; visibility: TournamentVisibility; created_by_user_id: number; invite_code: string | null };

export function createTournamentVisibilityService(db: Database.Database) {
  const load = (slug: string, guildId: string): Row => {
    const row = db.prepare("select id,status,visibility,created_by_user_id,invite_code from tournaments where web_slug=? and guild_id=?")
      .get(slug, guildId) as Row | undefined;
    if (!row) throw new TournamentVisibilityServiceError("Tournament not found", 404);
    return row;
  };
  const creator = (slug: string, guildId: string, userId: number) => {
    const row = load(slug, guildId);
    if (row.created_by_user_id !== userId) throw new TournamentVisibilityServiceError("Tournament not found", 404);
    return row;
  };
  const storeCode = (row: Row): string => {
    const code = randomBytes(32).toString("base64url");
    db.prepare("update tournaments set invite_code=? where id=?").run(code, row.id);
    return code;
  };

  return {
    invite: db.transaction((slug: string, guildId: string, userId: number) => {
      const row = creator(slug, guildId, userId);
      return row.invite_code ?? storeCode(row);
    }).immediate,
    resetInvite: db.transaction((slug: string, guildId: string, userId: number) => {
      // Grants already redeemed survive rotation.
      return storeCode(creator(slug, guildId, userId));
    }).immediate,
    admit: db.transaction((slug: string, guildId: string, userId: number, code: unknown) => {
      const row = load(slug, guildId);
      if (!row.invite_code || typeof code !== "string" || !inviteCodeMatches(row.invite_code, code)) {
        throw new TournamentVisibilityServiceError("Tournament not found", 404);
      }
      db.prepare("insert or ignore into tournament_invite_grants(tournament_id,user_id) values(?,?)").run(row.id, userId);
    }).immediate,
    setVisibility: db.transaction((slug: string, guildId: string, userId: number, visibility: unknown): TournamentVisibility => {
      const row = creator(slug, guildId, userId);
      if (!isTournamentVisibility(visibility)) throw new TournamentVisibilityServiceError("visibility must be open or private", 400);
      if (row.status !== "pending") throw new TournamentVisibilityServiceError("Tournament must be pending", 409);
      if (row.visibility !== visibility) {
        db.prepare("update tournaments set visibility=? where id=?").run(visibility, row.id);
      }
      return visibility;
    }).immediate,
  };
}
