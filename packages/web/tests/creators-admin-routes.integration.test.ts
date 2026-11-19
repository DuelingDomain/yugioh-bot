import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Owner routes of the creator fast-track on a real in-memory SQLite. Clerk is a stubbed global fetch; the keys are fake.
const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/db", () => ({ getDb }));

const ORIGIN = "https://app.example.test";
let db: Database.Database;
let clerk: ReturnType<typeof vi.fn>;
let invitations: number;

beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Operator" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("WEB_URL", ORIGIN); vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake_value"); vi.stubEnv("CREATOR_ANSWER_FLOOR_MS", "0");
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("yugidraft.creatorSendLimit")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("yugidraft.adminConsole.waitlist")];
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec("insert into users(id,username,display_name) values(1,'op','Operator'),(2,'ann','Ann')");
  invitations = 0;
  clerk = vi.fn(async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? "GET";
    if (method === "POST" && pathname === "/v1/invitations") {
      invitations += 1;
      const sent = JSON.parse(String(init!.body));
      if (sent.email_address === "pending@example.test") return Response.json({ errors: [{ code: "duplicate_record" }] }, { status: 400 });
      if (sent.email_address === "member@example.test") return Response.json({ errors: [{ code: "form_identifier_exists" }] }, { status: 422 });
      if (sent.email_address === "unavailable@example.test") return Response.json({ errors: [{ code: "server_error" }] }, { status: 503 });
      return Response.json({ id: `inv_${invitations}`, email_address: sent.email_address, status: "pending", url: "https://clerk.example.test/v1/tickets/accept?ticket=x" });
    }
    if (method === "POST" && /^\/v1\/invitations\/[^/]+\/revoke$/.test(pathname)) return Response.json({ id: pathname.split("/")[3], status: "revoked" });
    if (method === "GET" && pathname === "/v1/waitlist_entries") {
      const rows = [
        { id: "wle_vip", email_address: "v.i.p@gmail.com", status: "pending", created_at: 2_000 },
        { id: "wle_new", email_address: "new@example.test", status: "pending", created_at: 1_000 },
      ].filter(row => !searchParams.get("status") || row.status === searchParams.get("status"));
      return Response.json({ data: rows, total_count: rows.length });
    }
    return Response.json({ errors: [{ code: "not_stubbed", message: pathname }] }, { status: 500 });
  });
  vi.stubGlobal("fetch", clerk);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function req(path: string, method: string, body?: unknown, origin: string | null = ORIGIN) {
  return new Request(`${ORIGIN}${path}`, {
    method, headers: { ...(origin ? { origin } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const routes = {
  list: () => import("../app/api/admin/console/creators/route"),
  detail: () => import("../app/api/admin/console/creators/[id]/route"),
  links: () => import("../app/api/admin/console/creators/[id]/links/route"),
  revoke: () => import("../app/api/admin/console/creators/[id]/links/[linkId]/revoke/route"),
  emails: () => import("../app/api/admin/console/creators/[id]/emails/route"),
};
async function createCreator(body: unknown, origin: string | null = ORIGIN) {
  return (await routes.list()).POST(req("/api/admin/console/creators", "POST", body, origin));
}
async function createLink(id: number, body: unknown, origin: string | null = ORIGIN) {
  return (await routes.links()).POST(req(`/api/admin/console/creators/${id}/links`, "POST", body, origin), { params: Promise.resolve({ id: String(id) }) });
}
async function detail(id: number) {
  return (await routes.detail()).GET(req(`/api/admin/console/creators/${id}`, "GET"), { params: Promise.resolve({ id: String(id) }) });
}

it("answers 404 to a non-owner on every creators route, and 401 signed out", async () => {
  auth.mockResolvedValue({ user: { id: "2", name: "Ann" } });
  expect((await (await routes.list()).GET(req("/api/admin/console/creators", "GET"))).status).toBe(404);
  expect((await createCreator({ name: "Sneaky" })).status).toBe(404);
  expect((await detail(1)).status).toBe(404);
  expect((await createLink(1, { maxUses: 5, expiresInDays: 7 })).status).toBe(404);
  expect((await (await routes.revoke()).POST(req("/api/admin/console/creators/1/links/1/revoke", "POST"), { params: Promise.resolve({ id: "1", linkId: "1" }) })).status).toBe(404);
  expect((await (await routes.emails()).POST(req("/api/admin/console/creators/1/emails", "POST", { emails: ["a@example.test"] }), { params: Promise.resolve({ id: "1" }) })).status).toBe(404);
  auth.mockResolvedValue(null);
  expect((await createCreator({ name: "Sneaky" })).status).toBe(401);
  expect(db.prepare("select count(*) as n from creators").get()).toEqual({ n: 0 });
  expect(clerk).not.toHaveBeenCalled();
});

it("refuses a bad or missing Origin with 403 on mutations", async () => {
  expect((await createCreator({ name: "Kaiba" }, "https://evil.example.test")).status).toBe(403);
  const missing = await createCreator({ name: "Kaiba" }, null);
  expect(missing.status).toBe(403);
  expect(await missing.json()).toEqual({ error: "invalid_origin" });
  expect(db.prepare("select count(*) as n from creators").get()).toEqual({ n: 0 });
});

it("lets only an owner send an audited tournament invitation within the shared Clerk budget", async () => {
  const { POST } = await import("../app/api/admin/console/tournament-invites/route");
  const invite = (email: string, origin = ORIGIN) => POST(req("/api/admin/console/tournament-invites", "POST", { email }, origin));
  vi.stubEnv("TOURNAMENT_URL", "");
  expect((await invite("organizer@example.test")).status).toBe(404);
  vi.stubEnv("TOURNAMENT_URL", "https://tournament.example.test");
  vi.stubEnv("TOURNAMENT_BRIDGE_SECRET", "x".repeat(32));
  auth.mockResolvedValueOnce({ user: { id: "2", name: "Ann" } });
  expect((await invite("organizer@example.test")).status).toBe(404);
  expect((await invite("organizer@example.test", "https://outside.example.test")).status).toBe(403);
  expect(clerk).not.toHaveBeenCalled();

  const sent = await invite(" Organizer@Example.test ");
  expect(sent.status).toBe(201);
  expect(await sent.json()).toEqual({ sent: true });
  const requestBody = JSON.parse(String(clerk.mock.calls[0]?.[1]?.body));
  expect(requestBody).toMatchObject({ email_address: "organizer@example.test", notify: true, ignore_existing: false });
  const signUp = new URL(requestBody.redirect_url);
  expect(signUp.origin + signUp.pathname).toBe(`${ORIGIN}/sign-up`);
  expect(signUp.searchParams.get("redirect_url")).toBe("/api/tournament-bridge/start");
  expect(db.prepare("select actor_user_id, action, result, params_json from mod_actions").get()).toMatchObject({
    actor_user_id: 1, action: "tournament.invite", result: "success", params_json: '{"invitationId":"inv_1"}',
  });

  const pending = await invite(" Pending@Example.test ");
  expect(pending.status).toBe(409);
  expect(await pending.json()).toEqual({ error: "invitation_pending" });
  const member = await invite("member@example.test");
  expect(member.status).toBe(409);
  expect(await member.json()).toEqual({ error: "existing_account" });
  const { reserveOwnerSends } = await import("@/lib/creator-send-limit");
  expect(reserveOwnerSends(79)).toBeNull();
  expect((await invite("another@example.test")).status).toBe(429);
  expect(clerk).toHaveBeenCalledTimes(3);
});

it("audits denied and failed tournament invites with a hash of the normalized email", async () => {
  const { POST } = await import("../app/api/admin/console/tournament-invites/route");
  vi.stubEnv("TOURNAMENT_URL", "https://tournament.example.test");
  vi.stubEnv("TOURNAMENT_BRIDGE_SECRET", "x".repeat(32));
  for (const [email, status, result, code] of [
    ["pending@example.test", 409, "denied", "invitation_pending"],
    ["member@example.test", 409, "denied", "existing_account"],
    ["unavailable@example.test", 503, "failure", "clerk_unavailable"],
  ] as const) {
    const response = await POST(req("/api/admin/console/tournament-invites", "POST", { email: ` ${email.toUpperCase()} ` }));
    expect(response.status).toBe(status);
    const row = db.prepare("select result, params_json from mod_actions where action = 'tournament.invite' order by id desc limit 1")
      .get() as { result: string; params_json: string };
    expect(row.result).toBe(result);
    expect(JSON.parse(row.params_json)).toEqual({ code, email_key: createHash("sha256").update(email).digest("hex") });
  }
});

it("creates a creator with an allowlist email, a link and more emails; the section and the sheet show them", async () => {
  const created = await createCreator({ name: "Kaiba Plays", channelUrl: "https://youtube.example.test/@kaiba", email: "Kaiba@Example.test" });
  expect(created.status).toBe(201);
  expect(created.headers.get("cache-control")).toBe("private, no-store");
  const { creator, email } = await created.json();
  expect(creator).toMatchObject({ name: "Kaiba Plays", channelUrl: "https://youtube.example.test/@kaiba" });
  expect(email).toEqual({ email: "kaiba@example.test", outcome: "sent" });

  const linkResponse = await createLink(creator.id, { label: "Community", maxUses: 50, expiresInDays: 30 });
  expect(linkResponse.status).toBe(201);
  const { link, url } = await linkResponse.json();
  expect(link).toMatchObject({ maxUses: 50, used: 0, state: "open", label: "Community" });
  expect(url).toBe(`${ORIGIN}/join/${link.code}`);
  expect(link.code).toMatch(/^[A-Za-z0-9]{12}$/);
  expect((await createLink(creator.id, { maxUses: 501, expiresInDays: 30 })).status).toBe(400);

  const emails = await (await routes.emails()).POST(req(`/api/admin/console/creators/${creator.id}/emails`, "POST", { emails: ["fan@example.test", "kaiba+2@example.test", "nope"] }), { params: Promise.resolve({ id: String(creator.id) }) });
  expect(emails.status).toBe(200);
  expect((await emails.json()).results.map((r: { outcome: string }) => r.outcome)).toEqual(["sent", "already", "invalid"]);
  const tooMany = await (await routes.emails()).POST(req(`/api/admin/console/creators/${creator.id}/emails`, "POST", { emails: Array.from({ length: 21 }, (_, i) => `m${i}@example.test`) }), { params: Promise.resolve({ id: String(creator.id) }) });
  expect(tooMany.status).toBe(400);

  const sheet = await (await detail(creator.id)).json();
  expect(sheet.linkUrls).toEqual({ [link.id]: `${ORIGIN}/join/${link.code}` });
  expect(sheet.grants.map((g: { email: string; status: string }) => [g.email, g.status]).sort()).toEqual([["fan@example.test", "sent"], ["kaiba@example.test", "sent"]]);
  expect((await detail(9999)).status).toBe(404);

  const section = await (await (await routes.list()).GET(req("/api/admin/console/creators?start=0", "GET"))).json();
  expect(section.state).toBe("ok");
  expect(section.data.creators).toEqual([expect.objectContaining({ id: creator.id, links: 1, openLinks: 1, sent: 2, signedUp: 0 })]);
  expect(section.data.sendBudgetLeft).toBe(78);
  expect(invitations).toBe(2);
});

it("revokes a link: 200 with the count, then the link reads revoked", async () => {
  const { creator } = await (await createCreator({ name: "Yugi" })).json();
  const { link } = await (await createLink(creator.id, { maxUses: 2, expiresInDays: 14 })).json();
  const revoke = (await routes.revoke()).POST;
  const params = (id: number, linkId: number) => ({ params: Promise.resolve({ id: String(id), linkId: String(linkId) }) });
  expect((await revoke(req(`/api/admin/console/creators/${creator.id}/links/${link.id}/revoke`, "POST", undefined, "https://evil.example.test"), params(creator.id, link.id))).status).toBe(403);
  const response = await revoke(req(`/api/admin/console/creators/${creator.id}/links/${link.id}/revoke`, "POST"), params(creator.id, link.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ revoked: true, invitationsRevoked: 0 });
  expect((await revoke(req(`/api/admin/console/creators/${creator.id + 1}/links/${link.id}/revoke`, "POST"), params(creator.id + 1, link.id))).status).toBe(404);
  const sheet = await (await detail(creator.id)).json();
  expect(sheet.links[0]).toMatchObject({ id: link.id, state: "revoked" });
});

it("creates and displays an owner-only email lock and rejects invalid locks", async () => {
  const { creator } = await (await createCreator({ name: "Yugi" })).json();
  const response = await createLink(creator.id, { maxUses: 1, expiresInDays: 90, lockedEmail: " A.B+creator@GoogleMail.com " });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const { link } = await response.json();
  expect(link.lockedEmail).toBe("a.b+creator@googlemail.com");
  expect((await (await detail(creator.id)).json()).links[0].lockedEmail).toBe(link.lockedEmail);
  for (const lockedEmail of ["invalid", "@example.test", 42, {}, false]) {
    const invalid = await createLink(creator.id, { maxUses: 1, expiresInDays: 14, lockedEmail });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_locked_email" });
  }
  const unlocked = await createLink(creator.id, { maxUses: 3, expiresInDays: 14, lockedEmail: null });
  expect(unlocked.status).toBe(201);
  expect((await unlocked.json()).link).toMatchObject({ maxUses: 3, lockedEmail: null });
});

it("the admin waitlist hides a pending entry whose inbox has a grant", async () => {
  const { creator } = await (await createCreator({ name: "Kaiba" })).json();
  await (await routes.emails()).POST(req(`/api/admin/console/creators/${creator.id}/emails`, "POST", { emails: ["vip+creator@gmail.com"] }), { params: Promise.resolve({ id: String(creator.id) }) });
  const { GET } = await import("../app/api/admin/console/waitlist/route");
  const body = await (await GET()).json();
  expect(body.state).toBe("ok");
  expect(body.data.entries.map((e: { id: string }) => e.id)).toEqual(["wle_new"]);
});
