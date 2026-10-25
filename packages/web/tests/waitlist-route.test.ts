import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { migrate } from "@yugidraft/shared/db";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  join: vi.fn(),
  createWaitlistEntry: vi.fn(),
  createBackend: vi.fn(),
  events: [] as string[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@yugidraft/shared/clerk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@yugidraft/shared/clerk")>(),
  createClerkBackend: state.createBackend,
}));
vi.mock("@yugidraft/shared/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yugidraft/shared/services")>();
  return {
    ...actual,
    createWaitlistService: (db: Database.Database) => {
      const service = actual.createWaitlistService(db);
      state.join.mockImplementation((...args: Parameters<typeof service.join>) => {
        const result = service.join(...args);
        state.events.push("join committed");
        return result;
      });
      return { join: state.join };
    },
  };
});

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
  expect(response.headers.get("cache-control")).toBe("no-store");
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", undefined);
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "1");
  state.events = [];
  state.createBackend.mockReturnValue({ createWaitlistEntry: state.createWaitlistEntry });
  state.createWaitlistEntry.mockImplementation(async ({ emailAddress }: { emailAddress: string }) => {
    state.events.push("Clerk called");
    expect(state.db!.inTransaction).toBe(false);
    expect(rows()).toContainEqual(expect.objectContaining({ email: emailAddress }));
    return { id: "waitlist_test", email_address: emailAddress, status: "pending" };
  });
  state.db = new Database(":memory:");
  migrate(state.db);
  post = (await import("../app/api/waitlist/route")).POST;
});
afterEach(() => {
  if (state.db?.open) state.db.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/waitlist", () => {
  it("alerts once for duplicate marketing or app requests", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await post(json({ email: "player@example.test", source: "hero" }))).status).toBe(201);
    expect((await post(json({ email: " PLAYER@EXAMPLE.TEST ", source: "app-not-invited" }))).status).toBe(201);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(2);
  });

  it("succeeds with Discord still pending and after Discord fails", async () => {
    vi.useFakeTimers();
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("private webhook data")));
    }));
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post(json())).status).toBe(201);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect((await post(json())).status).toBe(201);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("alerts a saved request even when Clerk needs a retry, without a duplicate on recovery", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    state.createWaitlistEntry.mockRejectedValueOnce(new Error("Clerk unavailable"));
    expect((await post(json())).status).toBe(503);
    expect((await post(json())).status).toBe(201);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("joins anonymously and never echoes the email", async () => {
    const response = await post(json({ email: " Player@Example.COM ", source: "hero" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com", source: "hero", user_agent: "test-browser" })]);
    expect(state.createBackend).toHaveBeenCalledWith({ secretKey: "test-secret" });
    expect(state.join).toHaveBeenCalledTimes(1);
    expect(state.createWaitlistEntry).toHaveBeenCalledExactlyOnceWith({ emailAddress: "player@example.com", notify: true });
    expect(state.events).toEqual(["join committed", "Clerk called"]);
  });

  it("returns the same success for case/whitespace variants", async () => {
    await post(json());
    const response = await post(json({ email: " PLAYER@EXAMPLE.COM " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rows()).toHaveLength(1);
    expect(state.join).toHaveBeenCalledTimes(2);
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(2);
    expect(state.createWaitlistEntry).toHaveBeenNthCalledWith(2, { emailAddress: "player@example.com", notify: true });
    expect(state.events).toEqual(["join committed", "Clerk called", "join committed", "Clerk called"]);
  });

  it.each([undefined, null, 123, "", "missing-at", "a@@b.com", "a@localhost", "a b@c.com", "a@b .com", "a@.com", "a@b.", "a".repeat(249) + "@b.com"])
    ("rejects invalid email %j without saving it", async (email) => {
      const response = await post(json({ email }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_email" });
      expect(rows()).toHaveLength(0);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(state.join).not.toHaveBeenCalled();
      expect(state.createBackend).not.toHaveBeenCalled();
    });

  it("accepts the 254-character boundary", async () => {
    expect((await post(json({ email: "a".repeat(248) + "@b.com" }))).status).toBe(201);
  });

  it.each([
    ["zero-width space", "player\u200b"],
    ["zero-width non-joiner", "player\u200c"],
    ["zero-width joiner", "player\u200d"],
    ["right-to-left override", "player\u202e"],
    ["word joiner", "player\u2060"],
    ["byte-order mark", "player\ufeff"],
    ["leading byte-order mark", "\ufeffplayer"],
    ["supplementary language tag", "player\u{e0001}"],
  ])("rejects a local-part %s before any effects", async (_name, localPart) => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const email = `${localPart}@example.test`;
    const response = await post(json({ email }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    redirect(await post(form(new URLSearchParams({ email }).toString())), "invalid");
    expect(rows()).toEqual([]);
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "x@https://evil.example.test/claim",
    "x@example.test/path",
    "x@example.test\\path",
    "x@example%2etest",
    "x@example.test:443",
    "x@example.test?claim",
    "x@example.test#claim",
    "x@example_test.test",
    "x@-example.test",
    "x@example-.test",
    "x@" + "a".repeat(64) + ".test",
  ])("rejects a non-host email domain in %s before any effects", async email => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    expect((await post(json({ email }))).status).toBe(400);
    expect(rows()).toEqual([]);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["player@sub.example.test", "player@xn--bcher-kva.test", "player@host-1.test"])
    ("accepts host labels in %s", async email => {
      expect((await post(json({ email }))).status).toBe(201);
    });

  it("uses the ASCII email for storage and Clerk when submitted a Unicode domain", async () => {
    const email = "player@xn--bcher-kva.test";
    expect((await post(json({ email: "player@bücher.test" }))).status).toBe(201);
    expect(rows()).toEqual([expect.objectContaining({ email })]);
    expect(state.createWaitlistEntry).toHaveBeenCalledExactlyOnceWith({ emailAddress: email, notify: true });
  });

  it.each([
    [" Player@ｅｘａｍｐｌｅ．ｔｅｓｔ ", "player@example.test"],
    ["Player@example。test", "player@example.test"],
    ["Player@example.test\u200b", "player@example.test"],
    ["Player@BÜCHER.test", "player@xn--bcher-kva.test"],
  ])("deduplicates %s with its ASCII form across rows, claims and Clerk", async (submitted, email) => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await post(json({ email: submitted }))).status).toBe(201);
    redirect(await post(form(new URLSearchParams({ email }).toString())), "joined");
    expect(rows()).toEqual([expect.objectContaining({ email })]);
    expect(state.db!.prepare("select kind, subject_hash from join_request_notifications").all()).toEqual([
      { kind: "join", subject_hash: createHash("sha256").update(`email:${email}`).digest("hex") },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(state.join.mock.calls.map(([value]) => value)).toEqual([email, email]);
    expect(state.createWaitlistEntry.mock.calls.map(([value]) => value)).toEqual([
      { emailAddress: email, notify: true }, { emailAddress: email, notify: true },
    ]);
  });

  it("rejects an email whose ASCII form exceeds the length limit before any effects", async () => {
    expect((await post(json({ email: "a".repeat(240) + "@bücher.test" }))).status).toBe(400);
    expect(rows()).toEqual([]);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it.each([{ body: null }, { body: [] }, { body: "string" }])("rejects a non-object JSON body $body", async ({ body }) => {
    const response = await post(json(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await post(new Request("http://localhost/api/waitlist", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("silently accepts the honeypot even with an invalid email, without opening the DB", async () => {
    state.db!.close();
    const response = await post(json({ email: "bad", company: "spam" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
    expect((await post(json(undefined, "192.0.2.2"))).status).toBe(201);
    vi.setSystemTime(600_000);
    expect((await post(json({ email: "next@example.com" }))).status).toBe(201);
  });

  it("evicts the oldest IP window so a new client can join", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    // Honeypots exercise the limiter without 10,000 database writes.
    for (let i = 0; i < 10_000; i++) {
      expect((await post(json({ company: "bot" }, `client-${i}`))).status).toBe(201);
    }
    expect((await post(json({ company: "bot" }, "overflow"))).status).toBe(201);
    vi.setSystemTime(600_000);
    expect((await post(json(undefined, "overflow"))).status).toBe(201);
  });

  it.each([
    ["2001:db8:1:2::1", "2001:0db8:0001:0002:ffff::2"],
    ["::ffff:192.0.2.1", "192.0.2.1"],
    ["::ffff:c000:201", "192.0.2.1"],
  ])("shares a client window between %s and %s", async (first, second) => {
    for (let i = 0; i < 5; i++) await post(json({ company: "filled" }, first));
    expect((await post(json({ company: "filled" }, second))).status).toBe(429);
    expect((await post(json({ company: "filled" }, "2001:db8:1:3::1"))).status).toBe(201);
  });

  it("redirects form joins and duplicates to a relative marketing URL", async () => {
    redirect(await post(form()), "joined");
    redirect(await post(form("email=+PLAYER%40EXAMPLE.COM+")), "joined");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com", source: "footer" })]);
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(2);
    expect(state.createWaitlistEntry).toHaveBeenNthCalledWith(2, { emailAddress: "player@example.com", notify: true });
  });

  it("redirects invalid forms", async () => {
    redirect(await post(form("email=invalid")), "invalid");
    expect(rows()).toHaveLength(0);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("redirects form honeypots as joined without saving anything", async () => {
    redirect(await post(form("email=bad&company=filled")), "joined");
    expect(rows()).toHaveLength(0);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("limits form posts with no forwarded IP in the unknown bucket", async () => {
    for (let i = 0; i < 5; i++) await post(form());
    const response = await post(form());
    redirect(response, "limited");
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(state.join).toHaveBeenCalledTimes(5);
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(5);
  });

  it.each(["text/plain", "multipart/form-data", "application/xml"])("rejects %s with 415", async (contentType) => {
    const response = await post(new Request("http://localhost/api/waitlist", {
      method: "POST", headers: { "content-type": contentType }, body: "email=player@example.com",
    }));
    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rows()).toHaveLength(0);
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("enforces a 2 KiB byte cap even without Content-Length", async () => {
    const response = await post(json({ email: "player@example.com", source: "é".repeat(1024) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    expect(rows()).toHaveLength(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
    redirect(await post(form("email=player%40example.com&source=" + "x".repeat(2048))), "invalid");
    expect(state.join).not.toHaveBeenCalled();
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("returns a generic 500 for storage failures", async () => {
    state.db!.close();
    const response = await post(json());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("redirects storage failures for native forms without calling Clerk", async () => {
    state.db!.close();
    redirect(await post(form()), "error");
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it.each([
    ["5xx", new ClerkBackendError("upstream unavailable", 502, null, null)],
    ["timeout", new ClerkBackendError("Clerk request timed out", 0, null, null)],
    ["429", new ClerkBackendError("rate limited", 429, null, 2000)],
    ["4xx", new ClerkBackendError("unauthorized", 401, null, null)],
    ["unexpected", new Error("private request data")],
  ])("keeps the local row and returns retry for Clerk %s failures", async (_name, error) => {
    state.createWaitlistEntry.mockRejectedValue(error);
    const response = await post(json());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "retry_later" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com" })]);
    expect(state.createWaitlistEntry).toHaveBeenCalledExactlyOnceWith({ emailAddress: "player@example.com", notify: true });
    redirect(await post(form()), "retry");
    expect(rows()).toHaveLength(1);
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(2);
  });

  it("heals a partial failure on the next duplicate signup, retaining the first metadata", async () => {
    state.createWaitlistEntry.mockRejectedValueOnce(new ClerkBackendError("unavailable", 503, null, null));
    expect((await post(json({ email: "player@example.com", source: "hero" }))).status).toBe(503);
    const response = await post(form());
    redirect(response, "joined");
    expect(rows()).toEqual([expect.objectContaining({ email: "player@example.com", source: "hero", user_agent: "test-browser" })]);
    expect(state.events).toEqual(["join committed", "join committed", "Clerk called"]);
    expect(state.createWaitlistEntry).toHaveBeenCalledTimes(2);
  });

  it("awaits Clerk after the local join has committed before reporting success", async () => {
    let release!: () => void;
    state.createWaitlistEntry.mockImplementation(() => {
      expect(state.events).toEqual(["join committed"]);
      expect(state.db!.inTransaction).toBe(false);
      expect(rows()).toHaveLength(1);
      return new Promise(resolve => {
        release = () => resolve({ id: "waitlist_test", email_address: "player@example.com", status: "pending" });
      });
    });
    let settled = false;
    const pending = post(json()).then(response => { settled = true; return response; });
    await vi.waitFor(() => expect(state.createWaitlistEntry).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    release();
    expect((await pending).status).toBe(201);
  });

  it.each([undefined, ""])("returns retry with a saved row when the secret is %j", async (secret) => {
    vi.stubEnv("CLERK_SECRET_KEY", secret);
    const response = await post(json());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "retry_later" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    redirect(await post(form()), "retry");
    expect(rows()).toHaveLength(1);
    expect(state.createBackend).not.toHaveBeenCalled();
  });

  it("sends an allowlisted email its invitation again and makes no Clerk waitlist entry", async () => {
    vi.stubEnv("WEB_URL", "https://app.example.test");
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("yugidraft.creatorSendLimit")];
    const { createCreatorAccessService, RESEND_COOLDOWN_MS } = await import("@yugidraft/shared/services/creator-access");
    state.db!.exec("insert into users(id, username, display_name) values (1, 'op', 'Operator')");
    // The owner added the email before the cooldown, so a waitlist join is due for a re-send.
    const sentAt = Date.now() - RESEND_COOLDOWN_MS - 60_000;
    const seed = createCreatorAccessService(state.db!, {
      webUrl: "https://app.example.test", now: () => sentAt,
      clerk: { createInvitation: async () => ({ id: "inv_seed", email_address: "vip@example.test", status: "pending" }), revokeInvitation: async () => {} } as never,
    });
    const creator = seed.createCreator({ name: "Kaiba Plays", actorUserId: 1 });
    expect(await seed.addAllowlistEmails(creator.id, ["vip@example.test"], 1)).toEqual([expect.objectContaining({ outcome: "sent" })]);

    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toMatch(/^https:\/\/api\.clerk\.com\/v1\/invitations(\/[^/]+\/revoke)?$/);
      if (String(url).endsWith("/revoke")) return Response.json({ id: "inv_seed", status: "revoked" });
      return Response.json({ id: "inv_again", email_address: JSON.parse(String(init!.body)).email_address, status: "pending", url: "https://clerk.example.test/v1/tickets/accept?__clerk_ticket=t" });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await post(json({ email: " VIP@example.test ", source: "hero" }));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "joined" });
    expect(text).not.toMatch(/ticket|inv_/);
    const invites = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/v1/invitations"));
    expect(invites).toHaveLength(1);
    expect(JSON.parse(String(invites[0]![1]!.body))).toMatchObject({ email_address: "vip@example.test", notify: true });
    expect(state.createWaitlistEntry).not.toHaveBeenCalled();
    expect(state.join).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("yugidraft.creatorSendLimit")];
  });

  it("stores a valid heard-from answer and drops an unknown one", async () => {
    expect((await post(json({ email: "yt@example.test", heardFrom: "YouTube", heardFromDetail: "  Kaiba\u0000 video  " }))).status).toBe(201);
    expect((await post(json({ email: "odd@example.test", heardFrom: "billboard", heardFromDetail: "x" }, "192.0.2.7"))).status).toBe(201);
    expect(state.db!.prepare("select email, heard_from, heard_from_detail from waitlist_signups order by id").all()).toEqual([
      { email: "yt@example.test", heard_from: "youtube", heard_from_detail: "Kaiba video" },
      { email: "odd@example.test", heard_from: null, heard_from_detail: null },
    ]);
  });

  it("reads the backend secret per request, allowing a retry after configuration is restored", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", undefined);
    expect((await post(json())).status).toBe(503);
    vi.stubEnv("CLERK_SECRET_KEY", "restored-test-secret");
    const response = await post(json());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "joined" });
    expect(state.createBackend).toHaveBeenCalledExactlyOnceWith({ secretKey: "restored-test-secret" });
    expect(rows()).toHaveLength(1);
  });
});
