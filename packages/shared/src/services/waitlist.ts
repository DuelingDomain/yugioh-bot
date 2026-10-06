import type Database from "better-sqlite3";

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
      const result = insert.run(
        email.trim().toLowerCase(),
        new Date().toISOString(),
        meta.source?.trim().slice(0, 80) || "form",
        meta.userAgent?.slice(0, 300) ?? null,
      );
      return { status: result.changes === 0 ? "exists" : "joined" };
    },
  };
}

export type WaitlistService = ReturnType<typeof createWaitlistService>;
