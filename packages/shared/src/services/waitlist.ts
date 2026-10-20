import { recordProductEvent } from "../analytics/index.js";
import type Database from "better-sqlite3";
import { notifyJoinRequest } from "../notify/join-request.js";
import { clearDiscordSubject } from "../discord-admin/privacy.js";
import { normalizedNoticeEmail } from "../discord-admin/subject.js";

export interface WaitlistMeta {
  source?: string;
  userAgent?: string | null;
}

export function createWaitlistService(db: Database.Database) {
  // One atomic insert handles concurrent writers without replacing the first signup.
  const insert = db.prepare(`
    insert into waitlist_signups (email, created_at, source, user_agent)
    values (?, ?, ?, ?)
    on conflict(email) do nothing
  `);

  return {
    /** Remove local and Discord state, including Clerk-only entries with no local signup. */
    remove(email: string): { signups: number; actions: number } {
      return db.transaction(() => {
        const cleared = clearDiscordSubject(db, { email });
        const signups = db.prepare("delete from waitlist_signups where email in (?,?)")
          .run(normalizedNoticeEmail(email), email.trim().toLowerCase()).changes;
        return { signups, actions: cleared.actions };
      }).immediate();
    },
    join(email: string, meta: WaitlistMeta = {}): { status: "joined" | "exists" } {
      const normalizedEmail = normalizedNoticeEmail(email);
      const createdAt = new Date().toISOString();
      const result = db.transaction(() => {
        const result = insert.run(
          normalizedEmail,
          createdAt,
          meta.source?.trim().slice(0, 80) || "form",
          meta.userAgent?.slice(0, 300) ?? null,
        );
        if (result.changes !== 0) recordProductEvent(db, "waitlist_joined", null);
        return result;
      }).immediate();
      if (result.changes !== 0) {
        void notifyJoinRequest(db, {
          email: normalizedEmail, createdAt,
          source: meta.source?.trim() === "app-not-invited" ? "app waitlist" : "marketing waitlist",
        });
      }
      return { status: result.changes === 0 ? "exists" : "joined" };
    },
  };
}

export type WaitlistService = ReturnType<typeof createWaitlistService>;
