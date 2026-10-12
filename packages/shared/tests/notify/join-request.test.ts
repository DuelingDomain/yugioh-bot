import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { notifyJoinRequest } from "../../src/notify/index.js";

let db: Database.Database;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const notice = { email: "player@example.test", source: "marketing waitlist" as const, createdAt: "2026-10-11T12:00:00.000Z" };
const webhook = "https://discord.example.test/webhook-placeholder";
function payload() { return JSON.parse(String(fetcher.mock.calls[0][1]?.body)); }
function claims() { return db.prepare("select * from join_request_notifications").all(); }

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", webhook);
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", undefined);
  vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", undefined);
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", undefined);
  vi.stubEnv("DISCORD_ADMIN_DASHBOARD_URL", undefined);
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("join request notifications", () => {
  it("posts a masked embed with source, event time, dashboard and no mentions", async () => {
    await notifyJoinRequest(db, notice);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(webhook);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, signal: expect.any(AbortSignal) });
    expect(payload()).toEqual({
      allowed_mentions: { parse: [] },
      embeds: [{ title: "New join request", url: "https://dashboard.clerk.com/", timestamp: notice.createdAt,
        fields: [{ name: "Email", value: "p\\*\\*\\*@example\\.test" }, { name: "Source", value: "marketing waitlist" }] }],
    });
    expect(JSON.stringify(payload())).not.toContain(notice.email);
    expect(claims()).toEqual([{ kind: "join", subject_hash: createHash("sha256").update("email:player@example.test").digest("hex"), attempted_at: expect.any(String) }]);
  });

  it.each(["", undefined, "   "])("does nothing when the URL is %j, including no database claim", async value => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", value);
    await notifyJoinRequest(db, notice);
    expect(fetcher).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
  });

  it("can disable join alerts without disabling sign-up alerts", async () => {
    vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "0");
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    await notifyJoinRequest(db, notice);
    await notifyJoinRequest(db, { ...notice, source: "sign-up" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(payload().embeds[0].title).toBe("New user sign-up");
    expect(claims()).toEqual([expect.objectContaining({ kind: "signup" })]);
  });

  it("disables sign-up alerts by default", async () => {
    await notifyJoinRequest(db, { ...notice, source: "sign-up" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
  });

  it("shows and escapes the full email only with the explicit flag", async () => {
    vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", "1");
    await notifyJoinRequest(db, { ...notice, email: "*`_[x](y)~|+\\<>@example.test" });
    expect(payload().embeds[0].fields[0].value).toBe("\\*\\`\\_\\[x\\]\\(y\\)\\~\\|\\+\\\\\\<\\>@example\\.test");
    expect(payload().allowed_mentions).toEqual({ parse: [] });
  });

  it.each(["0", "true"])("keeps emails masked when the full-email flag is %s", async value => {
    vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", value);
    await notifyJoinRequest(db, notice);
    expect(payload().embeds[0].fields[0].value).toBe("p\\*\\*\\*@example\\.test");
  });

  it("uses the configured HTTPS dashboard page", async () => {
    vi.stubEnv("DISCORD_ADMIN_DASHBOARD_URL", "https://admin.example.test/waitlist");
    await notifyJoinRequest(db, notice);
    expect(payload().embeds[0].url).toBe("https://admin.example.test/waitlist");
  });

  it.each(["javascript:alert(1)", "invalid"])("uses the Clerk dashboard when the configured link is invalid: %s", async value => {
    vi.stubEnv("DISCORD_ADMIN_DASHBOARD_URL", value);
    await notifyJoinRequest(db, notice);
    expect(payload().embeds[0].url).toBe("https://dashboard.clerk.com/");
  });

  it("atomically deduplicates concurrent calls and different join sources", async () => {
    await Promise.all([
      notifyJoinRequest(db, notice),
      notifyJoinRequest(db, { ...notice, email: " PLAYER@EXAMPLE.TEST ", source: "Clerk waitlist" }),
      notifyJoinRequest(db, { ...notice, source: "app waitlist" }),
    ]);
    migrate(db);
    await notifyJoinRequest(db, notice);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(claims()).toHaveLength(1);
  });

  it("keeps join and sign-up alerts separate for the same person", async () => {
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    await notifyJoinRequest(db, notice);
    await notifyJoinRequest(db, { ...notice, source: "sign-up" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(claims()).toHaveLength(2);
  });

  it("can notify distinct email-less sign-ups and deduplicates their subject IDs", async () => {
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    for (const subjectId of ["user_placeholder_one", "user_placeholder_one", "user_placeholder_two"]) {
      await notifyJoinRequest(db, { source: "sign-up", subjectId });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(payload().embeds[0].fields[0].value).toBe("Email unavailable");
    expect(JSON.stringify(claims())).not.toContain("user_placeholder");
  });

  it("does not claim a notice with no identity", async () => {
    await notifyJoinRequest(db, { source: "Clerk waitlist" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
  });

  it("swallows database failures", async () => {
    db.exec("drop table join_request_notifications");
    await expect(notifyJoinRequest(db, notice)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("swallows transport failures without logging private data or retrying a duplicate", async () => {
    fetcher.mockRejectedValue(new Error(`${webhook} ${notice.email}`));
    await expect(notifyJoinRequest(db, notice)).resolves.toBeUndefined();
    await notifyJoinRequest(db, notice);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/player@|discord\.example/);
  });

  it.each([400, 401, 500])("does not retry HTTP %s", async status => {
    fetcher.mockResolvedValue(new Response(null, { status }));
    await expect(notifyJoinRequest(db, notice)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("aborts a slow HTTP request after two seconds", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("timeout")));
    }));
    const pending = notifyJoinRequest(db, notice);
    const signal = fetcher.mock.calls[0][1]!.signal!;
    await vi.advanceTimersByTimeAsync(1999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a 429 once after fractional retry_after seconds", async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(Response.json({ retry_after: 0.25 }, { status: 429 }));
    const pending = notifyJoinRequest(db, notice);
    await vi.advanceTimersByTimeAsync(249);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]!.body).toBe(fetcher.mock.calls[0][1]!.body);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses Retry-After if the 429 body is not JSON", async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 429, headers: { "Retry-After": "0.1" } }));
    const pending = notifyJoinRequest(db, notice);
    await vi.advanceTimersByTimeAsync(99);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 429 with no valid delay", async () => {
    fetcher.mockResolvedValue(Response.json({ retry_after: -1 }, { status: 429 }));
    await notifyJoinRequest(db, notice);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("stops after a second 429", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(async () => Response.json({ retry_after: 0.1 }, { status: 429 }));
    const pending = notifyJoinRequest(db, notice);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
