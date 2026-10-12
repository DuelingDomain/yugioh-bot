import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createWaitlistService } from "@yugidraft/shared/services";
import { createClerkBackend } from "@yugidraft/shared/clerk";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
// Verify real HMAC signatures through Clerk's existing SDK; no verification mock.
import { POST } from "../app/api/webhooks/clerk/route";

const signingKey = Buffer.alloc(32, 7);
const signingSecret = `whsec_${signingKey.toString("base64")}`;
const createdAt = Date.parse("2026-10-11T12:00:00.000Z");
const waitlist = { type: "waitlistEntry.created", timestamp: createdAt,
  data: { id: "waitlist_placeholder", email_address: "player@example.test", created_at: createdAt } };
const signup = { type: "user.created", timestamp: createdAt,
  data: { id: "user_placeholder", created_at: createdAt, primary_email_address_id: "email_primary_placeholder",
    email_addresses: [{ id: "email_other_placeholder", email_address: "other@example.test" }, { id: "email_primary_placeholder", email_address: "player@example.test" }] } };
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function signed(event: unknown = waitlist, id = "msg_placeholder", seconds = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", signingKey).update(`${id}.${seconds}.${body}`).digest("base64");
  return new NextRequest("https://app.example.test/api/webhooks/clerk", {
    method: "POST", headers: { "Content-Type": "application/json", "content-length": String(Buffer.byteLength(body)), "svix-id": id, "svix-timestamp": String(seconds), "svix-signature": `v1,${signature}` }, body,
  });
}
function receipts() { return state.db!.prepare("select * from clerk_webhook_receipts").all(); }
function messages() { return fetcher.mock.calls.map(([, options]) => JSON.parse(String(options!.body))); }

beforeEach(() => {
  state.db = new Database(":memory:");
  migrate(state.db);
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", signingSecret);
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/webhook-placeholder");
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "1");
  vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "0");
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", "0");
  vi.stubEnv("DISCORD_ADMIN_DASHBOARD_URL", undefined);
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (state.db?.open) state.db.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/clerk", () => {
  it("accepts a signed waitlist event and sends the masked event time and source", async () => {
    const response = await POST(signed());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(receipts()).toEqual([{ svix_id: "msg_placeholder", received_at: expect.any(String) }]);
    expect(messages()[0]).toMatchObject({ allowed_mentions: { parse: [] }, embeds: [{ title: "New join request", timestamp: new Date(createdAt).toISOString(),
      fields: [{ name: "Email", value: "`p***@example.test`" }, { name: "Source", value: "Clerk waitlist" }] }] });
  });

  it("rejects an invalid signature before database or Discord effects", async () => {
    const request = signed();
    request.headers.set("svix-signature", "v1,invalid-placeholder");
    expect((await POST(request)).status).toBe(400);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["svix-id", "svix-timestamp", "svix-signature"])("rejects a missing %s header", async header => {
    const request = signed();
    request.headers.delete(header);
    expect((await POST(request)).status).toBe(400);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an expired signed request", async () => {
    expect((await POST(signed(waitlist, "msg_placeholder", Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("returns 503 if the signing secret is %j", async value => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", value);
    expect((await POST(signed())).status).toBe(503);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("acknowledges an unknown event without an alert", async () => {
    expect((await POST(signed({ type: "future.event", data: {} }))).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...waitlist, data: {} },
    { ...waitlist, data: null },
    { ...waitlist, data: { email_address: "   " } },
    { ...waitlist, data: { email_address: 123 } },
    { ...signup, data: {} },
    { ...signup, data: null },
    { ...signup, data: { id: "   " } },
    { ...signup, data: { id: 123 } },
    { ...signup, data: { ...signup.data, email_addresses: [null] } },
    { ...signup, data: { ...signup.data, email_addresses: [{ email_address: 123 }] } },
  ])("stores and acknowledges an unusable signed event without an alert: %j", async event => {
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    const response = await POST(signed(event));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect((await POST(signed(event))).status).toBe(200);
    expect(receipts()).toEqual([{ svix_id: "msg_placeholder", received_at: expect.any(String) }]);
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a missing content-length before reading or verifying the body", async () => {
    const request = signed();
    request.headers.delete("content-length");
    request.headers.set("svix-signature", "v1,invalid-placeholder");
    const read = vi.spyOn(request, "text");
    const response = await POST(request);
    expect(response.status).toBe(411);
    expect(await response.json()).toEqual({ error: "length_required" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects content-length above 64 KiB before reading or verifying the body", async () => {
    const request = signed();
    request.headers.set("content-length", String(64 * 1024 + 1));
    request.headers.set("svix-signature", "v1,invalid-placeholder");
    const read = vi.spyOn(request, "text");
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(receipts()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("verifies a request at the 64 KiB content-length boundary", async () => {
    const request = signed();
    request.headers.set("content-length", String(64 * 1024));
    expect((await POST(request)).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([waitlist, signup])("acknowledges usable identities with malformed event times: $type", async event => {
    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    const malformed = { ...event, timestamp: { toString: 0 }, data: { ...event.data, created_at: undefined } };
    expect((await POST(signed(malformed))).status).toBe(200);
    expect(receipts()).toEqual([{ svix_id: "msg_placeholder", received_at: new Date(createdAt).toISOString() }]);
    expect(messages()[0].embeds[0].timestamp).toBe(new Date(createdAt).toISOString());
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent Svix replays after another migration", async () => {
    const responses = await Promise.all([POST(signed()), POST(signed())]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    migrate(state.db!);
    expect((await POST(signed())).status).toBe(200);
    expect(receipts()).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("deduplicates the same person across distinct event IDs and email variants", async () => {
    await POST(signed());
    await POST(signed({ ...waitlist, data: { ...waitlist.data, email_address: " PLAYER@EXAMPLE.TEST " } }, "msg_other_placeholder"));
    expect(receipts()).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["form-first", "clerk-first"])("deduplicates a form and Clerk event in order %s", async order => {
    if (order === "clerk-first") await POST(signed());
    createWaitlistService(state.db!).join("player@example.test");
    if (order === "form-first") await POST(signed());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(state.db!.prepare("select email from waitlist_signups").all()).toEqual([{ email: "player@example.test" }]);
  });

  it("covers entries created through the shared backend used by owner reconciliation", async () => {
    const backend = createClerkBackend({ secretKey: "secret-placeholder", fetch: async (_url, options) => {
      expect(JSON.parse(String(options?.body))).toEqual({ email_address: "player@example.test", notify: true });
      return Response.json({ ...waitlist.data, status: "pending" });
    } });
    const entry = await backend.createWaitlistEntry({ emailAddress: "player@example.test", notify: true });
    await POST(signed({ ...waitlist, data: entry }));
    await POST(signed({ ...waitlist, data: entry }));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("keeps signup alerts disabled by default", async () => {
    expect((await POST(signed(signup))).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(receipts()).toHaveLength(1);
  });

  it("enables signup alerts separately, selects the primary email, and deduplicates replays", async () => {
    vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "0");
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    await POST(signed());
    await POST(signed(signup, "msg_signup_placeholder"));
    await POST(signed(signup, "msg_signup_placeholder"));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(messages()[0].embeds[0]).toMatchObject({ title: "New user sign-up", fields: [{ name: "Email", value: "`p***@example.test`" }, { name: "Source", value: "sign\\-up" }] });
  });

  it("supports an email-less user and a missing primary email", async () => {
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    await POST(signed({ ...signup, data: { ...signup.data, email_addresses: [] } }));
    await POST(signed({ ...signup, data: { ...signup.data, id: "user_other_placeholder", primary_email_address_id: null } }, "msg_other_placeholder"));
    expect(messages().map(message => message.embeds[0].fields[0].value)).toEqual(["Email unavailable", "`o***@example.test`"]);
  });

  it("returns 2xx while Discord is pending and after Discord fails", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("private request data")));
    }));
    expect((await POST(signed())).status).toBe(200);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect((await POST(signed())).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns 2xx for a Discord 500 without another delivery on replay", async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 500 }));
    expect((await POST(signed())).status).toBe(200);
    expect((await POST(signed())).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns 503 if receipt storage fails so Clerk can retry", async () => {
    state.db!.exec("drop table clerk_webhook_receipts");
    expect((await POST(signed())).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("prunes at most 100 receipts older than seven days per new receipt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(createdAt);
    const cutoff = createdAt - 7 * 24 * 60 * 60 * 1000;
    const insert = state.db!.prepare("insert into clerk_webhook_receipts (svix_id, received_at) values (?, ?)");
    state.db!.transaction(() => {
      for (let index = 0; index < 150; index++) {
        insert.run(`msg_old_placeholder_${index}`, new Date(cutoff - 150_000 + index * 1000).toISOString());
      }
      insert.run("msg_boundary_placeholder", new Date(cutoff).toISOString());
      insert.run("msg_recent_placeholder", new Date(cutoff + 1).toISOString());
    })();
    const event = { type: "future.event", data: {} };
    expect((await POST(signed(event))).status).toBe(200);
    expect(receipts()).toHaveLength(53);
    expect(state.db!.prepare("select svix_id from clerk_webhook_receipts where received_at < ? order by received_at")
      .all(new Date(cutoff).toISOString())).toEqual(Array.from({ length: 50 }, (_, index) => ({ svix_id: `msg_old_placeholder_${index + 100}` })));
    // A replay must not add another cleanup batch to the same delivery.
    expect((await POST(signed(event))).status).toBe(200);
    expect(receipts()).toHaveLength(53);
    expect((await POST(signed(event, "msg_next_placeholder"))).status).toBe(200);
    expect(receipts()).toEqual(expect.arrayContaining([
      { svix_id: "msg_boundary_placeholder", received_at: new Date(cutoff).toISOString() },
      { svix_id: "msg_recent_placeholder", received_at: new Date(cutoff + 1).toISOString() },
      { svix_id: "msg_placeholder", received_at: new Date(createdAt).toISOString() },
      { svix_id: "msg_next_placeholder", received_at: new Date(createdAt).toISOString() },
    ]));
    expect(receipts()).toHaveLength(4);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rolls back a receipt when cleanup fails so a storage retry can still alert", async () => {
    state.db!.prepare("insert into clerk_webhook_receipts values (?, ?)").run("msg_old_placeholder", "2020-01-01T00:00:00.000Z");
    state.db!.exec(`create trigger reject_receipt_cleanup before delete on clerk_webhook_receipts
      begin select raise(abort, 'cleanup unavailable'); end;`);
    expect((await POST(signed())).status).toBe(503);
    expect(receipts()).toEqual([{ svix_id: "msg_old_placeholder", received_at: "2020-01-01T00:00:00.000Z" }]);
    expect(fetcher).not.toHaveBeenCalled();
    state.db!.exec("drop trigger reject_receipt_cleanup");
    expect((await POST(signed())).status).toBe(200);
    expect(receipts()).toEqual([{ svix_id: "msg_placeholder", received_at: expect.any(String) }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("acknowledges events while Discord is unset without claiming an alert", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", undefined);
    expect((await POST(signed())).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
  });
});
