import type Database from "better-sqlite3";
import { notifyJoinRequest } from "../notify/join-request.js";

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
    join(email: string, meta: WaitlistMeta = {}): { status: "joined" | "exists" } {
      const normalizedEmail = email.trim().toLowerCase();
      const createdAt = new Date().toISOString();
      const result = insert.run(
        normalizedEmail,
        createdAt,
        meta.source?.trim().slice(0, 80) || "form",
        meta.userAgent?.slice(0, 300) ?? null,
      );
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
