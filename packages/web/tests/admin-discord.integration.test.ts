import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { migrate } from "@yugidraft/shared/db";
import { deleteUserAccount } from "@yugidraft/shared/services";
import { notifyJoinRequest } from "@yugidraft/shared/notify";
import { getDb } from "@/lib/db";
import { signE2ESession } from "@/lib/e2e-auth";

// Next's request context is the only framework seam. Session signatures, identity,
// owner checks, database, webhook verification and HTTP adapters all stay real.
const context = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => context.cookie ? { value: context.cookie } : undefined }) }));
import { POST as webhook } from "../app/api/webhooks/clerk/route";
import { GET, POST } from "../app/admin/waitlist/[token]/route";
import { POST as heartbeat } from "../app/api/presence/route";

const directory = mkdtempSync(join(tmpdir(), "dd-admin-integration-"));
const secret = "integration-placeholder-32-characters-long";
const origin = "https://app.example.test";
const key = Buffer.alloc(32, 3);
let calls: { url: string; method: string; body: any }[];
let clerkReply: (options?: RequestInit) => Response | Promise<Response>;
let discordReply: (method: string) => Response;
const db = () => getDb();

function signedEvent(email = "invitee@example.test", id = "waitlist_fixture") {
  const body = JSON.stringify({ type: "waitlistEntry.created", data: { id, email_address: email, created_at: Date.now() } });
  const seconds = Math.floor(Date.now() / 1000);
  return new NextRequest(`${origin}/api/webhooks/clerk`, { method: "POST", body, headers: {
    "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "svix-id": `msg_${id}`,
    "svix-timestamp": String(seconds), "svix-signature": `v1,${createHmac("sha256", key).update(`msg_${id}.${seconds}.${body}`).digest("base64")}`,
  } });
}
function actionUrl(decision = "Approve") {
  const message = calls.find(c => c.method === "POST" && c.url.includes("discord"))!;
  const text = JSON.stringify(message.body);
  return new URL(new RegExp(`\\[${decision}\\]\\((https:[^)]+)\\)`).exec(text)![1]);
}
function params(url: URL) { return { params: Promise.resolve({ token: url.pathname.split("/").at(-1)! }) }; }
function request(url: URL, method = "GET", requestOrigin = origin) {
  return new NextRequest(url, { method, ...(method === "POST" ? { headers: { origin: requestOrigin } } : {}) });
}
async function alert() {
  expect((await webhook(signedEvent())).status).toBe(200);
  await vi.waitFor(() => expect(db().prepare("select discord_message_id from discord_waitlist_actions").get()).toMatchObject({ discord_message_id: "123456789" }));
  return actionUrl();
}
beforeAll(() => {
  vi.stubEnv("DATABASE_PATH", join(directory, "test.sqlite"));
  migrate(db());
  db().prepare("insert into users(id,username,display_name) values (101,'owner','Owner'),(102,'member','Member')").run();
});
beforeEach(() => {
  for (const [name, value] of Object.entries({ E2E_AUTH: "1", E2E_AUTH_SECRET: secret, CLERK_SECRET_KEY: "sk_test_placeholder",
    OWNER_USER_IDS: "101", WEB_URL: origin, DISCORD_ADMIN_ACTION_SIGNING_SECRET: secret,
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${key.toString("base64")}`, DISCORD_ADMIN_WEBHOOK_URL: "https://discord.example.test/api/webhooks/1/fixture",
    DISCORD_JOIN_REQUEST_ALERTS_ENABLED: "1", DISCORD_ONLINE_STATUS_ENABLED: "1" })) vi.stubEnv(name, value);
  db().exec("delete from clerk_webhook_receipts; delete from join_request_notifications; delete from discord_waitlist_actions; update users set last_seen_at=null,last_route=null");
  context.cookie = signE2ESession(101, secret);
  calls = [];
  clerkReply = () => Response.json({ id: "waitlist_fixture", status: "invited" });
  discordReply = method => Response.json({ id: "123456789" }, { status: method === "POST" ? 200 : 200 });
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith("https://api.clerk.com/v1/")) return clerkReply(init);
    if (url.startsWith("https://discord.example.test/")) return discordReply(method);
    throw new Error("Unexpected outbound HTTP");
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(() => { db().close(); rmSync(directory, { recursive: true, force: true }); });

describe("owner Discord administration with real SQLite and network-edge stubs", () => {
  it("GET confirms without effects; POST invites once, consumes both choices and edits the stored Discord message", async () => {
    const url = await alert();
    const reject = actionUrl("Reject");
    expect(calls[0].url).toContain("wait=true");
    const page = await GET(request(url), params(url));
    expect(await page.text()).toContain('method="post"');
    expect(page.headers.get("referrer-policy")).toBe("strict-origin");
    expect(calls).toHaveLength(1);
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect((await POST(request(reject, "POST"), params(reject))).status).toBe(409);
    expect(calls.filter(c => c.url.includes("clerk"))).toMatchObject([{ method: "POST", url: "https://api.clerk.com/v1/waitlist_entries/waitlist_fixture/invite" }]);
    const edit = calls.find(c => c.method === "PATCH")!;
    expect(edit.url).toContain("/messages/123456789");
    expect(JSON.stringify(edit.body)).toContain("Approved by Owner");
    expect(JSON.stringify(edit.body)).not.toContain("[Approve]");
    expect(edit.body.allowed_mentions).toEqual({ parse: [] });
    migrate(db());
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(1);
  });

  it("rejects through Clerk's reject endpoint", async () => {
    await alert();
    clerkReply = () => Response.json({ id: "waitlist_fixture", status: "rejected" });
    const url = actionUrl("Reject");
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect(calls.some(c => c.url.endsWith("/reject") && c.method === "POST")).toBe(true);
    expect(JSON.stringify(calls.find(c => c.method === "PATCH")!.body)).toContain("Rejected by Owner");
  });

  it("requires a signed session and the current owner allowlist on GET and POST", async () => {
    const url = await alert();
    for (const [cookie, status] of [[undefined, 401], ["forged", 401], [signE2ESession(102, secret), 403]] as const) {
      context.cookie = cookie;
      expect((await GET(request(url), params(url))).status).toBe(status);
      expect((await POST(request(url, "POST"), params(url))).status).toBe(status);
    }
    context.cookie = signE2ESession(101, secret);
    vi.stubEnv("OWNER_USER_IDS", "");
    expect((await POST(request(url, "POST"), params(url))).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("rejects changed, expired and cross-origin links before Clerk HTTP", async () => {
    const url = await alert();
    expect((await POST(request(url, "POST", "https://evil.example.test"), params(url))).status).toBe(403);
    const changed = new URL(url.href.replace(".approve.", ".reject."));
    expect((await POST(request(changed, "POST"), params(changed))).status).toBe(400);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    context.cookie = signE2ESession(101, secret);
    expect((await POST(request(url, "POST"), params(url))).status).toBe(410);
    expect(calls).toHaveLength(1);
  });

  it("excludes concurrent choices and reconciles an ambiguous invite without another invitation", async () => {
    const url = await alert();
    let release!: (reply: Response) => void;
    clerkReply = () => new Promise<Response>(resolve => { release = resolve; });
    const pending = POST(request(url, "POST"), params(url));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await POST(request(url, "POST"), params(url))).status).toBe(409);
    const opposite = actionUrl("Reject");
    expect((await POST(request(opposite, "POST"), params(opposite))).status).toBe(409);
    release(Response.json({ errors: [{ code: "upstream_unavailable" }] }, { status: 503 }));
    expect((await pending).status).toBe(503);
    clerkReply = () => Response.json({ errors: [{ code: "waitlist_entry_already_invited" }] }, { status: 409 });
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect(JSON.stringify(calls.find(c => c.method === "PATCH")!.body)).toContain("Approved by Owner");
  });

  it("binds the Clerk ID to an earlier local alert without a duplicate message", async () => {
    await notifyJoinRequest(db(), { email: "invitee@example.test", source: "marketing waitlist" });
    expect((await webhook(signedEvent())).status).toBe(200);
    const url = actionUrl();
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect(calls.filter(c => c.url.includes("discord") && c.method === "POST")).toHaveLength(1);
  });

  it("recovers a timeout after provider success, keeping one invitation and the first actor", async () => {
    const url = await alert();
    let invitations = 0;
    vi.useFakeTimers();
    clerkReply = options => {
      invitations++;
      return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("private provider detail"))));
    };
    const pending = POST(request(url, "POST"), params(url));
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(503);
    clerkReply = () => Response.json({ errors: [{ code: "waitlist_entry_already_invited" }] }, { status: 409 });
    db().prepare("update users set display_name='Changed owner' where id=101").run();
    expect((await POST(request(url, "POST"), params(url))).status).toBe(200);
    expect(invitations).toBe(1);
    expect(db().prepare("select actor_name from discord_waitlist_actions").get()).toEqual({ actor_name: "Owner" });
    db().prepare("update users set display_name='Owner' where id=101").run();
  });

  it("resumes a crashed processing lease but refuses an expired retry", async () => {
    const url = await alert();
    db().prepare("update discord_waitlist_actions set decision='approve',actor_user_id=101,actor_name='Owner',attempted_at=?").run(Date.now() - 31_000);
    clerkReply = () => Response.json({}, { status: 503 });
    expect((await POST(request(url, "POST"), params(url))).status).toBe(503);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(1);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    context.cookie = signE2ESession(101, secret);
    expect((await POST(request(url, "POST"), params(url))).status).toBe(410);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(1);
  });

  it("stores only allowlisted route templates, rates per user across calls and keeps no history", async () => {
    const beat = (route: string) => heartbeat(new NextRequest(`${origin}/api/presence`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ route }) }));
    expect((await beat("/decks/private?email=secret")).status).toBe(400);
    expect((await beat("https://example.test/decks/[id]")).status).toBe(400);
    expect((await beat("/decks/[id]")).status).toBe(204);
    expect((await beat("/dashboard")).status).toBe(429);
    expect(db().prepare("select last_route,last_seen_at from users where id=101").get()).toMatchObject({ last_route: "/decks/[id]", last_seen_at: expect.any(Number) });
    db().prepare("update users set last_seen_at=last_seen_at-60000 where id=101").run();
    expect((await beat("/dashboard")).status).toBe(204);
    expect(db().prepare("select last_route from users where id=101").get()).toEqual({ last_route: "/dashboard" });
    vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "0");
    expect((await beat("/draft/[slug]")).status).toBe(204);
    expect(db().prepare("select last_route from users where id=101").get()).toEqual({ last_route: "/dashboard" });
    context.cookie = undefined;
    expect((await beat("/dashboard")).status).toBe(401);
  });

  it("clears latest presence immediately when an account with shared history is anonymised", () => {
    db().prepare("insert into users(id,username,display_name,last_seen_at,last_route) values(103,'deleted','To delete',?,'/dashboard')").run(Date.now());
    db().prepare("insert into drafts(guild_id,name,status,created_by_user_id) values('community','History','completed',103)").run();
    const result = deleteUserAccount(db(), 103);
    expect(result.mode).toBe("anonymised");
    expect(db().prepare("select last_seen_at,last_route from users where id=103").get()).toEqual({ last_seen_at: null, last_route: null });
  });
});
