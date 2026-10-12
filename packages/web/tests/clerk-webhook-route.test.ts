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
    method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": String(seconds), "svix-signature": `v1,${signature}` }, body,
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
      fields: [{ name: "Email", value: "p\\*\\*\\*@example\\.test" }, { name: "Source", value: "Clerk waitlist" }] }] });
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
    expect(messages()[0].embeds[0]).toMatchObject({ title: "New user sign-up", fields: [{ name: "Email", value: "p\\*\\*\\*@example\\.test" }, { name: "Source", value: "sign\\-up" }] });
  });

  it("supports an email-less user and a missing primary email", async () => {
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
    await POST(signed({ ...signup, data: { ...signup.data, email_addresses: [] } }));
    await POST(signed({ ...signup, data: { ...signup.data, id: "user_other_placeholder", primary_email_address_id: null } }, "msg_other_placeholder"));
    expect(messages().map(message => message.embeds[0].fields[0].value)).toEqual(["Email unavailable", "o\\*\\*\\*@example\\.test"]);
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

  it("acknowledges events while Discord is unset without claiming an alert", async () => {
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", undefined);
    expect((await POST(signed())).status).toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
  });
});
