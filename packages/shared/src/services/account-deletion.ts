import type Database from "better-sqlite3";
import { userHistory } from "./user-history.js";

/** What every kept row of a deleted account says in place of the person's name. */
export const DELETED_PLAYER_NAME = "Deleted player";

export type AccountDeletionMode = "removed" | "anonymised";

/** No personal data: IDs, a mode and row counts only. A count of zero is left out. */
export interface AccountDeletionSummary {
  userId: number;
  mode: AccountDeletionMode;
  counts: Record<string, number>;
}

export interface AccountDeletionPreview {
  userId: number;
  exists: boolean;
  mode: AccountDeletionMode;
  /** The row still has a Clerk user ID, so the Clerk user may still exist. */
  hasClerkUser: boolean;
}

const SAVED_DECK_OWNER = "saved_decks.owner_user_id";

/** The username an anonymised row keeps. It stays unique per user and carries nothing personal. */
export const deletedUsername = (userId: number): string => `deleted-${userId}`;

type UserRow = { id: number; clerk_user_id: string | null; email: string | null };
type PlayerRow = { id: number; display_name: string };

/**
 * What a deletion would do, without writing. Saved decks are deleted first by the real run, so they do not
 * count as history here either: a user whose only data is saved decks is removed, not anonymised.
 */
export function previewUserDeletion(db: Database.Database, userId: number): AccountDeletionPreview {
  const user = db.prepare<[number], UserRow>("select id, clerk_user_id, email from users where id = ?").get(userId);
  if (!user) return { userId, exists: false, mode: "removed", hasClerkUser: false };
  const shared = Object.keys(userHistory(db, userId)).filter(key => key !== SAVED_DECK_OWNER);
  return { userId, exists: true, mode: shared.length === 0 ? "removed" : "anonymised", hasClerkUser: user.clerk_user_id !== null };
}

/** "<name> vs <other>" and "<other> vs <name>" are the names a challenge gets by default. */
function scrubDuelName(name: string, personNames: readonly string[]): string {
  let next = name;
  for (const person of personNames) {
    if (next.startsWith(`${person} vs `)) next = `${DELETED_PLAYER_NAME}${next.slice(person.length)}`;
    if (next.endsWith(` vs ${person}`)) next = `${next.slice(0, next.length - person.length)}${DELETED_PLAYER_NAME}`;
  }
  return next;
}

/**
 * Deletes a person's account while other players' history survives. One `BEGIN IMMEDIATE` transaction;
 * safe to run again (a second run changes nothing) and safe to run after a half-finished attempt.
 *
 * Order matters: the email and the old names are read first, saved decks and the waitlist row go next, and
 * only then is the user checked for history. With none left, the user and their players are removed.
 * Otherwise the user and players stay (every FK and every match, pick, seat and standing keeps its ID) and
 * lose their name, email, Discord and Clerk identity.
 *
 * Copied personal data that is scrubbed in the anonymised case: `players.display_name`,
 * `players.discord_user_id`, the default "<name> vs <name>" `duels.name` of duels they played or organised,
 * and `bug_reports.context_json.userAgent`. Everything else that mentions a person is a join at read time.
 */
export function deleteUserAccount(db: Database.Database, userId: number): AccountDeletionSummary {
  const run = db.transaction((): AccountDeletionSummary => {
    const user = db.prepare<[number], UserRow & { display_name: string }>("select id, clerk_user_id, email, display_name from users where id = ?").get(userId);
    const counts: Record<string, number> = {};
    const note = (key: string, changes: number) => { if (changes > 0) counts[key] = changes; };
    if (!user) return { userId, mode: "removed", counts };

    const players = db.prepare<[number], PlayerRow>("select id, display_name from players where user_id = ?").all(userId);
    const personNames = [...new Set([user.display_name, ...players.map(player => player.display_name)])]
      .filter(name => name.trim() !== "" && name !== DELETED_PLAYER_NAME)
      .sort((a, b) => b.length - a.length);

    note("saved_decks", db.prepare("delete from saved_decks where owner_user_id = ?").run(userId).changes);
    if (user.email) note("waitlist_signups", db.prepare("delete from waitlist_signups where email = ?").run(user.email).changes);

    const owned = "(select id from players where user_id = ?)";
    if (Object.keys(userHistory(db, userId)).length === 0) {
      note("players", db.prepare("delete from players where user_id = ?").run(userId).changes);
      note("users", db.prepare("delete from users where id = ?").run(userId).changes);
      return { userId, mode: "removed", counts };
    }

    // Default challenge names carry both players' display names; keep custom names as they are.
    const duels = db.prepare<[number, number, number, number, number], { id: number; name: string }>(`
      select id, name from duels
      where organizer_player_id in ${owned} or winner_player_id in ${owned}
         or id in (select duel_id from duel_seats where player_id in ${owned})
         or series_id in (select id from duel_series where player0_id in ${owned} or player1_id in ${owned})
    `).all(userId, userId, userId, userId, userId);
    const renameDuel = db.prepare("update duels set name = ? where id = ?");
    let renamed = 0;
    for (const duel of duels) {
      const name = scrubDuelName(duel.name, personNames);
      if (name !== duel.name) renamed += renameDuel.run(name, duel.id).changes;
    }
    note("duel_names", renamed);

    // The browser string is device data; the report's own text stays, as the owner decided.
    const reports = db.prepare<[number], { id: number; context_json: string }>(
      `select id, context_json from bug_reports where player_id in ${owned}`).all(userId);
    const writeContext = db.prepare("update bug_reports set context_json = ? where id = ?");
    let contexts = 0;
    for (const report of reports) {
      let context: unknown;
      try { context = JSON.parse(report.context_json); } catch { continue; }
      if (context === null || typeof context !== "object" || Array.isArray(context) || !("userAgent" in context)) continue;
      delete (context as Record<string, unknown>).userAgent;
      contexts += writeContext.run(JSON.stringify(context), report.id).changes;
    }
    note("bug_report_contexts", contexts);

    note("players", db.prepare(
      "update players set display_name = ?, discord_user_id = null where user_id = ? and (display_name <> ? or discord_user_id is not null)",
    ).run(DELETED_PLAYER_NAME, userId, DELETED_PLAYER_NAME).changes);
    note("users", db.prepare(`
      update users set clerk_user_id = null, email = null, email_verified = 0, discord_user_id = null,
        username = ?, display_name = ?, synced_at = null, updated_at = current_timestamp
      where id = ? and (clerk_user_id is not null or email is not null or email_verified <> 0 or discord_user_id is not null
        or username <> ? or display_name <> ? or synced_at is not null)
    `).run(deletedUsername(userId), DELETED_PLAYER_NAME, userId, deletedUsername(userId), DELETED_PLAYER_NAME).changes);
    return { userId, mode: "anonymised", counts };
  });
  return run.immediate();
}
