import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createWaitlistService } from "../../src/services/waitlist.js";

let db: Database.Database;
beforeEach(() => {
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", undefined);
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "1");
  db = new Database(":memory:");
  migrate(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("alerts once after a new local join commits, across service instances", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      expect(db.inTransaction).toBe(false);
      expect(db.prepare("select email from waitlist_signups").get()).toEqual({ email: "player@example.test" });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(createWaitlistService(db).join("player@example.test")).toEqual({ status: "joined" });
    expect(createWaitlistService(db).join(" PLAYER@EXAMPLE.TEST ")).toEqual({ status: "exists" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1]!.body)).embeds[0].fields[1].value).toBe("marketing waitlist");
    await Promise.resolve();
  });

  it("labels app requests without including untrusted source text", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    createWaitlistService(db).join("player@example.test", { source: "app-not-invited" });
    createWaitlistService(db).join("other@example.test", { source: "@everyone" });
    const messages = fetcher.mock.calls.map(([, options]) => JSON.parse(String(options!.body)));
    expect(messages.map(message => message.embeds[0].fields[1].value)).toEqual(["app waitlist", "marketing waitlist"]);
    expect(JSON.stringify(messages)).not.toContain("@everyone");
    await Promise.resolve();
  });

  it("returns joined while Discord is pending, then swallows the timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("timeout")));
    }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(createWaitlistService(db).join("player@example.test")).toEqual({ status: "joined" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(createWaitlistService(db).join("player@example.test")).toEqual({ status: "exists" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("still saves a join if the alert database claim fails", () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.exec("drop table join_request_notifications");
    expect(createWaitlistService(db).join("player@example.test")).toEqual({ status: "joined" });
    expect(db.prepare("select email from waitlist_signups").get()).toEqual({ email: "player@example.test" });
  });
});

it("records one anonymous join with no metadata and rolls back when recording fails", () => {
  const waitlist = createWaitlistService(db);
  waitlist.join("member@example.test", { source: "private text", userAgent: "private browser" });
  waitlist.join("MEMBER@example.test");
  expect(db.prepare("select name,user_id,props_json from product_events").all()).toEqual([
    { name: "waitlist_joined", user_id: null, props_json: "{}" },
  ]);
  db.exec("create trigger reject_event before insert on product_events begin select raise(abort, 'record failed'); end");
  expect(() => waitlist.join("other@example.test")).toThrow("record failed");
  expect(db.prepare("select count(*) as n from waitlist_signups").get()).toEqual({ n: 1 });
});
