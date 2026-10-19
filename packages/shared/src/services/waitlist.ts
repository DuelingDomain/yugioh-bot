import { recordProductEvent } from "../analytics/index.js";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { notifyJoinRequest } from "../notify/join-request.js";
import { normalizeEmailDomain } from "../util/email-domain.js";

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
    /** Privacy deletion also revokes action links, even without a local signup. */
    remove(email: string): { signups: number; actions: number } {
      const normalizedEmail = email.trim().toLowerCase();
      const subjectEmail = normalizeEmailDomain(normalizedEmail) ?? normalizedEmail;
      const hash = createHash("sha256").update(`email:${subjectEmail}`).digest("hex");
      return db.transaction(() => {
        const actions = db.prepare("delete from discord_waitlist_actions where subject_hash=?").run(hash).changes;
        const signups = db.prepare("delete from waitlist_signups where email=?").run(normalizedEmail).changes;
        return { signups, actions };
      }).immediate();
    },
    join(email: string, meta: WaitlistMeta = {}): { status: "joined" | "exists" } {
      const normalizedEmail = email.trim().toLowerCase();
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
