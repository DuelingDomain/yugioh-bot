import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createWaitlistService } from "../../src/services/waitlist.js";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe("waitlist", () => {
  it("saves a normalized email with ISO time and bounded metadata, without guild or IP data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    expect(createWaitlistService(db).join("  Player@Example.COM  ", { source: "hero", userAgent: "x".repeat(400) }))
      .toEqual({ status: "joined" });
    expect(db.prepare("select * from waitlist_signups").get()).toEqual({
      id: 1, email: "player@example.com", created_at: "2026-10-05T12:00:00.000Z",
      source: "hero", user_agent: "x".repeat(300),
    });
  });

  it("deduplicates case and surrounding whitespace across service instances without replacing metadata", () => {
    createWaitlistService(db).join("player@example.com", { source: "hero" });
    expect(createWaitlistService(db).join(" Player@EXAMPLE.com ", { source: "footer" })).toEqual({ status: "exists" });
    expect(db.prepare("select email, source, user_agent from waitlist_signups").all())
      .toEqual([{ email: "player@example.com", source: "hero", user_agent: null }]);
  });

  it("keeps signups across repeat migrations and enforces uniqueness in SQLite", () => {
    createWaitlistService(db).join("player@example.com", {});
    migrate(db);
    expect(db.prepare("select source from waitlist_signups").all()).toEqual([{ source: "form" }]);
    expect(() => db.prepare("insert into waitlist_signups (email, created_at, source) values (?, ?, ?)")
      .run("player@example.com", new Date().toISOString(), "footer")).toThrow(/UNIQUE/);
  });
});
