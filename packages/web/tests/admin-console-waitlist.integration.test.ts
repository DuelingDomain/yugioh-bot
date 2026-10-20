import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { prepareWaitlistAction } from "@yugidraft/shared/services/waitlist-decisions";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

const ORIGIN = "https://app.example.test";
let db: Database.Database;
let clerk: ReturnType<typeof vi.fn>;
let entries: { id: string; email_address: string; status: string; created_at: number }[];
/** Clerk edge: GET list, POST invite/reject. `conflict` makes the next action answer 409 with that code. */
let conflict: string | null;

beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("WEB_URL", ORIGIN); vi.stubEnv("CLERK_SECRET_KEY", "sk_test_secret");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec("insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann')");
  // The list cache lives on globalThis so route bundles share it; start each test cold.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("yugidraft.adminConsole.waitlist")];
  conflict = null;
  entries = [
    { id: "wle_old", email_address: "old@example.test", status: "pending", created_at: 1_000 },
    { id: "wle_new", email_address: "new@example.test", status: "pending", created_at: 5_000 },
  ];
  clerk = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && pathname === "/v1/waitlist_entries") {
      const status = new URL(url).searchParams.get("status");
      const rows = entries.filter((e) => !status || e.status === status);
      return Response.json({ data: rows, total_count: rows.length });
    }
    const action = /^\/v1\/waitlist_entries\/([^/]+)\/(invite|reject)$/.exec(pathname);
    if (method === "POST" && action) {
      if (conflict) return Response.json({ errors: [{ code: conflict, message: "done" }] }, { status: 409 });
      const entry = entries.find((e) => e.id === action[1]);
      if (!entry) return Response.json({ errors: [{ code: "resource_not_found", message: "no" }] }, { status: 404 });
      entry.status = action[2] === "invite" ? "invited" : "rejected";
      return Response.json(entry);
    }
    return new Response("{}", { status: 500 });
  });
  vi.stubGlobal("fetch", clerk);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function list() { const { GET } = await import("../app/api/admin/console/waitlist/route"); return GET(); }
async function act(id: string, body: unknown, origin: string | null = ORIGIN) {
  const { POST } = await import("../app/api/admin/console/waitlist/[id]/route");
  return POST(new Request(`https://internal/api/admin/console/waitlist/${id}`, {
    method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}
const posts = () => clerk.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

it("lists pending entries newest first with the pending count", async () => {
  const body = await (await list()).json();
  expect(body.state).toBe("ok");
  expect(body.data.pending).toBe(2);
  expect(body.data.entries.map((e: { id: string; createdAt: number }) => [e.id, e.createdAt])).toEqual([["wle_new", 5_000], ["wle_old", 1_000]]);
  const url = new URL(clerk.mock.calls[0][0] as string);
  expect(url.searchParams.get("status")).toBe("pending");
  expect(url.searchParams.get("order_by")).toBe("-created_at");
});
it("says not-configured without CLERK_SECRET_KEY", async () => {
  vi.stubEnv("CLERK_SECRET_KEY", "");
  const body = await (await list()).json();
  expect(body.state).toBe("not-configured");
  expect(body.message).toContain("CLERK_SECRET_KEY");
  expect(clerk).not.toHaveBeenCalled();
});
it("shows a safe error when Clerk fails and never leaks the key", async () => {
  clerk.mockRejectedValue(new Error("boom sk_test_secret"));
  const text = await (await list()).text();
  expect(JSON.parse(text).state).toBe("error");
  expect(text).not.toContain("sk_test_secret");
});
it("approves, busts the cache, and the entry moves to the recent decisions", async () => {
  const before = await (await list()).json();
  expect(before.data.pending).toBe(2);
  expect(before.data.decided).toEqual([]);
  await list(); // second read is served from cache
  // One load = the pending list plus the latest entries for the decisions.
  expect(clerk.mock.calls.filter(([, i]) => i?.method === "GET")).toHaveLength(2);
  const response = await act("wle_new", { action: "approve" });
  expect(response.status).toBe(200);
  expect(posts()[0][0]).toBe("https://api.clerk.com/v1/waitlist_entries/wle_new/invite");
  expect(JSON.parse(posts()[0][1].body)).toEqual({});
  const after = await (await list()).json();
  expect(after.data.entries.map((e: { id: string }) => e.id)).toEqual(["wle_old"]);
  expect(after.data.pending).toBe(1);
  expect(after.data.decided).toEqual([{ id: "wle_new", email: "new@example.test", status: "invited", at: 5_000 }]);
});
it("still lists pending entries when the decisions call fails", async () => {
  const pendingOnly = clerk.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  clerk.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!new URL(url).searchParams.get("status")) return new Response("{}", { status: 500 });
    return pendingOnly(url, init);
  });
  const body = await (await list()).json();
  expect(body.state).toBe("ok");
  expect(body.data.pending).toBe(2);
  expect(body.data).not.toHaveProperty("decided");
});
it("rejects an entry", async () => {
  expect((await act("wle_old", { action: "reject" })).status).toBe(200);
  expect(posts()[0][0]).toBe("https://api.clerk.com/v1/waitlist_entries/wle_old/reject");
  expect(entries.find((e) => e.id === "wle_old")?.status).toBe("rejected");
});
it("repeating an action is not an error", async () => {
  expect((await act("wle_new", { action: "approve" })).status).toBe(200);
  expect((await act("wle_new", { action: "approve" })).status).toBe(200);
});
it.each([["approve", "waitlist_entry_already_invited"], ["reject", "waitlist_entry_already_rejected"]])("treats 409 %s (%s) as success", async (action, code) => {
  conflict = code;
  expect((await act("wle_new", { action })).status).toBe(200);
});
it("fails on a 409 with another code and on an unknown entry", async () => {
  conflict = "something_else";
  expect((await act("wle_new", { action: "approve" })).status).toBe(502);
  conflict = null;
  expect((await act("wle_missing", { action: "approve" })).status).toBe(404);
});
it("refuses a bad action, a bad id and a missing secret", async () => {
  expect((await act("wle_new", { action: "delete" })).status).toBe(400);
  expect((await act("wle_new", null)).status).toBe(400);
  expect((await act("../users", { action: "approve" })).status).toBe(400);
  vi.stubEnv("CLERK_SECRET_KEY", "");
  expect((await act("wle_new", { action: "approve" })).status).toBe(503);
  expect(posts()).toHaveLength(0);
});
it("answers 404 to a non-owner, 401 signed out, and refuses a bad Origin", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await act("wle_new", { action: "approve" })).status).toBe(404);
  expect((await list()).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await act("wle_new", { action: "approve" })).status).toBe(401);
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  expect((await act("wle_new", { action: "approve" }, "https://evil.test")).status).toBe(403);
  expect((await act("wle_new", { action: "approve" }, null)).status).toBe(403);
  expect(posts()).toHaveLength(0);
});

it.each(["approve", "reject"] as const)("%s through /admin queues an edit for the existing local alert using the server email", async (action) => {
  const alert = prepareWaitlistAction(db, { email: "new@example.test" });
  db.prepare("update discord_waitlist_actions set channel_id='alerts',message_id='message-1' where id=?").run(alert.id);
  await list();
  const reads = clerk.mock.calls.filter(([, init]) => init?.method === "GET").length;
  const response = await act("wle_new", { action, email: "attacker@example.test", siteUserId: 2, source: "discord" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", decision: action });
  expect(clerk.mock.calls.filter(([, init]) => init?.method === "GET")).toHaveLength(reads);
  expect(db.prepare("select id,clerk_entry_id,decision,actor_user_id,source from discord_waitlist_actions").all())
    .toEqual([{ id: alert.id, clerk_entry_id: "wle_new", decision: action, actor_user_id: 1, source: "admin" }]);
  const edit = db.prepare("select operation,channel_id,message_id,payload_json from discord_outbox where kind='waitlist_decision'").get();
  expect(edit).toMatchObject({ operation: "edit", channel_id: "alerts", message_id: "message-1" });
  expect(JSON.parse((edit as { payload_json: string }).payload_json)).toMatchObject({ components: [], embeds: [], allowed_mentions: { parse: [] } });
  expect(JSON.stringify(edit)).not.toContain("@example.test");
  expect(JSON.stringify(edit)).toContain("Operator");
  expect(JSON.stringify(edit)).toContain("(admin)");
  expect(db.prepare("select result,params_json from mod_actions").get()).toMatchObject({ result: "success", params_json: expect.stringContaining('"source":"admin"') });
});

it("records an admin decision but queues no Discord edit when there is no alert", async () => {
  vi.stubEnv("DISCORD_WAITLIST_CHANNEL_ID", "alerts");
  const response = await act("wle_new", { action: "approve" });
  expect(await response.json()).toEqual({ status: "ok", decision: "approve" });
  expect(db.prepare("select source,actor_user_id,subject_hash from discord_waitlist_actions").get())
    .toMatchObject({ source: "admin", actor_user_id: 1, subject_hash: expect.any(String) });
  expect(db.prepare("select * from discord_outbox where kind='waitlist_decision'").all()).toEqual([]);
});

it("returns already_decided without a second Clerk call and keeps the first decision", async () => {
  await act("wle_new", { action: "approve" });
  const response = await act("wle_new", { action: "reject" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "already_decided", decision: "approve" });
  expect(posts()).toHaveLength(1);
});

it("returns in_progress or conflict for a leased decision without another Clerk call", async () => {
  const row = prepareWaitlistAction(db, { email: "new@example.test", clerkEntryId: "wle_new" });
  db.prepare("update discord_waitlist_actions set decision='approve',source='discord',actor_user_id=1,lease_token='held',lease_expires_at=? where id=?")
    .run(Date.now() + 30_000, row.id);
  const pending = await act("wle_new", { action: "approve" });
  expect(pending.status).toBe(202);
  expect(await pending.json()).toEqual({ status: "in_progress", decision: "approve" });
  const opposite = await act("wle_new", { action: "reject" });
  expect(opposite.status).toBe(409);
  expect(await opposite.json()).toEqual({ status: "conflict", decision: "approve" });
  expect(posts()).toHaveLength(0);
});

it("does not decide an entry missing from the cached Clerk list, even with a client email", async () => {
  expect((await act("wle_missing", { action: "approve", email: "new@example.test" })).status).toBe(404);
  expect(posts()).toHaveLength(0);
  expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
});

it("refuses a decision when the server cannot load its email from Clerk", async () => {
  clerk.mockRejectedValue(new Error("private sk_test_secret"));
  const response = await act("wle_new", { action: "approve", email: "new@example.test" });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("sk_test_secret");
  expect(posts()).toHaveLength(0);
  expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
});
