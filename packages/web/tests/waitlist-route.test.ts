import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));

let post: typeof import("../app/api/waitlist/route").POST;
function json(body: unknown = { email: "player@example.com" }, ip = "192.0.2.1") {
  return new Request("https://marketing.localhost/api/waitlist", {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-forwarded-for": ip, "user-agent": "test-browser" },
    body: JSON.stringify(body),
  });
}
function form(body = "email=player%40example.com&source=footer") {
  return new Request("https://marketing.localhost/api/waitlist", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }, body,
  });
}
function rows() { return state.db!.prepare("select * from waitlist_signups").all(); }
function redirect(response: Response, status: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`/?waitlist=${status}#join`);
}

beforeEach(async () => {
  vi.resetModules();
  state.db = new Database(":memory:");
  migrate(state.db);
  post = (await import("../app/api/waitlist/route")).POST;
});
afterEach(() => {
  if (state.db?.open) state.db.close();
  vi.useRealTimers();
});

describe("POST /api/waitlist", () => {
  it("joins anonymously and never echoes the email", async () => {
    const response = await post(json({ email: " Player@Example.COM ", source: "hero" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com", source: "hero", user_agent: "test-browser" })]);
  });

  it("returns exists for case/whitespace variants", async () => {
    await post(json());
    const response = await post(json({ email: " PLAYER@EXAMPLE.COM " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "exists" });
    expect(rows()).toHaveLength(1);
  });

  it.each([undefined, null, 123, "", "missing-at", "a@@b.com", "a@localhost", "a b@c.com", "a@b .com", "a@.com", "a@b.", "a".repeat(249) + "@b.com"])
    ("rejects invalid email %j without saving it", async (email) => {
      const response = await post(json({ email }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_email" });
      expect(rows()).toHaveLength(0);
    });

  it("accepts the 254-character boundary", async () => {
    expect((await post(json({ email: "a".repeat(248) + "@b.com" }))).status).toBe(201);
  });

  it.each([{ body: null }, { body: [] }, { body: "string" }])("rejects a non-object JSON body $body", async ({ body }) => {
    const response = await post(json(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
  });

  it("rejects malformed JSON", async () => {
    const response = await post(new Request("http://localhost/api/waitlist", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
  });

  it("silently accepts the honeypot even with an invalid email, without opening the DB", async () => {
    state.db!.close();
    const response = await post(json({ email: "bad", company: "spam" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
  });

  it("limits the first forwarded hop to 5 attempts and resets after 10 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 5; i++) await post(json({}, "192.0.2.1, 10.0.0.1"));
    vi.setSystemTime(60_000);
    const response = await post(json(undefined, "192.0.2.1, 10.0.0.2"));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited" });
    expect(response.headers.get("retry-after")).toBe("540");
    expect((await post(json(undefined, "192.0.2.2"))).status).toBe(201);
    vi.setSystemTime(600_000);
    expect((await post(json({ email: "next@example.com" }))).status).toBe(201);
  });

  it("bounds the IP map without evicting a client's active limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // Honeypots exercise the limiter without 10,000 database writes.
    for (let i = 0; i < 10_000; i++) {
      expect((await post(json({ company: "bot" }, `client-${i}`))).status).toBe(201);
    }
    expect((await post(json({ company: "bot" }, "overflow"))).status).toBe(429);
    vi.setSystemTime(600_000);
    expect((await post(json(undefined, "overflow"))).status).toBe(201);
  });

  it("redirects form joins and duplicates to a relative marketing URL", async () => {
    redirect(await post(form()), "joined");
    redirect(await post(form("email=+PLAYER%40EXAMPLE.COM+")), "exists");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com", source: "footer" })]);
  });

  it("redirects invalid forms", async () => {
    redirect(await post(form("email=invalid")), "invalid");
    expect(rows()).toHaveLength(0);
  });

  it("redirects form honeypots as joined without saving anything", async () => {
    redirect(await post(form("email=bad&company=filled")), "joined");
    expect(rows()).toHaveLength(0);
  });

  it("limits form posts with no forwarded IP in the unknown bucket", async () => {
    for (let i = 0; i < 5; i++) await post(form());
    const response = await post(form());
    redirect(response, "limited");
    expect(response.headers.get("retry-after")).toBeTruthy();
  });

  it.each(["text/plain", "multipart/form-data", "application/xml"])("rejects %s with 415", async (contentType) => {
    const response = await post(new Request("http://localhost/api/waitlist", {
      method: "POST", headers: { "content-type": contentType }, body: "email=player@example.com",
    }));
    expect(response.status).toBe(415);
    expect(rows()).toHaveLength(0);
  });

  it("enforces a 2 KiB byte cap even without Content-Length", async () => {
    const response = await post(json({ email: "player@example.com", source: "é".repeat(1024) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    expect(rows()).toHaveLength(0);
    redirect(await post(form("email=player%40example.com&source=" + "x".repeat(2048))), "invalid");
  });

  it("returns a generic 500 for storage failures", async () => {
    state.db!.close();
    const response = await post(json());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });
});
