import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createCreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Public POST /api/join/[code] on a real in-memory SQLite. Clerk is a stubbed global fetch; the keys are fake.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb }));

const ORIGIN = "https://app.example.test";
const SEND_LIMIT_KEY = Symbol.for("yugidraft.creatorSendLimit");
let db: Database.Database;
let clerk: ReturnType<typeof vi.fn>;
/** What the Clerk stub answers to POST /v1/invitations. */
let clerkMode: "ok" | "5xx" | "422";
let invitations: number;
/** Every response text of the test, for the "no ticket" check. */
let bodies: string[];

function seedLink(maxUses: number, code: string) {
  const service = createCreatorAccessService(db, { webUrl: ORIGIN, newCode: () => code });
  const creator = service.createCreator({ name: "Kaiba Plays", actorUserId: 1 });
  return service.createLink(creator.id, { label: "Video", maxUses, expiresInDays: 30, actorUserId: 1 })!;
}

async function join(code: string, body: unknown, opts: { origin?: string | null; ip?: string; type?: string } = {}) {
  const { POST } = await import("../app/api/join/[code]/route");
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  const response = await POST(new Request(`${ORIGIN}/api/join/${code}`, {
    method: "POST",
    headers: { "content-type": opts.type ?? "application/json", "x-forwarded-for": opts.ip ?? "192.0.2.1", ...(origin ? { origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ code }) });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
}

const grants = () => db.prepare("select email, status from creator_grants order by id").all();
const invitationPosts = () => clerk.mock.calls.filter(([url, init]) => String(url).endsWith("/v1/invitations") && init?.method === "POST");

beforeEach(() => {
  vi.resetModules(); getDb.mockReset();
  delete (globalThis as Record<symbol, unknown>)[SEND_LIMIT_KEY];
  vi.stubEnv("WEB_URL", ORIGIN); vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake_value");
  // No answer floor in tests (one case below proves it with a small floor).
  vi.stubEnv("CREATOR_ANSWER_FLOOR_MS", "0");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec("insert into users(id, username, display_name, email, email_verified) values (1, 'op', 'Operator', 'member@example.test', 1)");
  clerkMode = "ok"; invitations = 0; bodies = [];
  clerk = vi.fn(async (url: string, init?: RequestInit) => {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "api.clerk.com") throw new Error(`unexpected fetch ${hostname}`);
    if (pathname === "/v1/invitations" && init?.method === "POST") {
      if (clerkMode === "5xx") return Response.json({ errors: [{ code: "internal", message: "down" }] }, { status: 502 });
      if (clerkMode === "422") return Response.json({ errors: [{ code: "form_identifier_exists", message: "taken" }] }, { status: 422 });
      const sent = JSON.parse(String(init.body));
      invitations += 1;
      return Response.json({
        id: `inv_${invitations}`, email_address: sent.email_address, status: "pending",
        url: `https://clerk.example.test/v1/tickets/accept?__clerk_ticket=tk_${invitations}&ticket=e2e`,
        public_metadata: sent.public_metadata,
      });
    }
    return Response.json({ errors: [{ code: "not_stubbed", message: pathname }] }, { status: 500 });
  });
  vi.stubGlobal("fetch", clerk);
});
afterEach(() => {
  // No answer of a public join may carry a ticket, an invitation URL, an invitation id or a grant id.
  for (const text of bodies) {
    for (const secret of ["ticket", "invitation", "inv_", "ddGrant", "clerk.example.test", "grantId"]) expect(text).not.toContain(secret);
  }
  db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  delete (globalThis as Record<symbol, unknown>)[SEND_LIMIT_KEY];
});

describe("POST /api/join/[code]", () => {
  it("claims a use, sends one Clerk invitation and answers sent", async () => {
    const link = seedLink(5, "JoinCode0001");
    const answer = await join(link.code, { email: " Fan@Example.TEST " });
    expect(answer).toMatchObject({ status: 200, json: { status: "sent" } });
    expect(answer.headers.get("cache-control")).toContain("no-store");
    expect(grants()).toEqual([{ email: "fan@example.test", status: "sent" }]);
    expect(invitationPosts()).toHaveLength(1);
    const [url, init] = invitationPosts()[0]!;
    expect(url).toBe("https://api.clerk.com/v1/invitations");
    expect(JSON.parse(String(init.body))).toMatchObject({
      email_address: "fan@example.test", notify: true, redirect_url: `${ORIGIN}/sign-up?via=creator`, public_metadata: { ddGrant: expect.any(Number) },
    });
  });

  it("refuses a missing or foreign Origin with 403 and claims nothing", async () => {
    const link = seedLink(5, "JoinCode0002");
    expect(await join(link.code, { email: "a@example.test" }, { origin: "https://evil.example.test" })).toMatchObject({ status: 403, json: { error: "invalid_origin" } });
    expect(await join(link.code, { email: "a@example.test" }, { origin: null })).toMatchObject({ status: 403 });
    expect(grants()).toEqual([]);
    expect(clerk).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON with 415", async () => {
    const link = seedLink(5, "JoinCode0003");
    expect((await join(link.code, "email=a%40example.test", { type: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await join(link.code, "a@example.test", { type: "text/plain" })).status).toBe(415);
    expect(grants()).toEqual([]);
  });

  it("answers the honeypot like a send and writes nothing", async () => {
    const link = seedLink(5, "JoinCode0004");
    expect(await join(link.code, { email: "bot@example.test", company: "Acme" })).toMatchObject({ status: 200, json: { status: "sent" } });
    expect(grants()).toEqual([]);
    expect(clerk).not.toHaveBeenCalled();
  });

  it.each(["", "missing-at", "a@@b.test", "a@localhost", "x@example.test/path", "player​@example.test"])("rejects the invalid email %j with 400", async (email) => {
    const link = seedLink(5, "JoinCode0005");
    expect(await join(link.code, { email })).toMatchObject({ status: 400, json: { error: "invalid_email" } });
    expect(grants()).toEqual([]);
  });

  it("rejects a body over 2 KB as invalid", async () => {
    const link = seedLink(5, "JoinCode0006");
    expect((await join(link.code, { email: "big@example.test", pad: "x".repeat(2100) })).status).toBe(400);
    expect(grants()).toEqual([]);
  });

  it("limits one IP to 5 posts in 10 minutes with 429 busy and claims no use", async () => {
    const link = seedLink(50, "JoinCode0007");
    for (let i = 0; i < 5; i++) expect((await join(link.code, { email: `ip${i}@example.test` })).status).toBe(200);
    const limited = await join(link.code, { email: "ip5@example.test" });
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: "busy", retryAfterSeconds: expect.any(Number) });
    expect(limited.json.retryAfterSeconds).toBeGreaterThan(0);
    expect(grants()).toHaveLength(5);
    expect(invitationPosts()).toHaveLength(5);
    // Another IP still gets through.
    expect((await join(link.code, { email: "ip5@example.test" }, { ip: "192.0.2.99" })).status).toBe(200);
  });

  it("limits one link to 20 sends per hour, and a busy answer claims no use", async () => {
    const link = seedLink(50, "JoinCode0008");
    for (let i = 0; i < 20; i++) expect((await join(link.code, { email: `l${i}@example.test` }, { ip: `198.51.100.${i}` })).status).toBe(200);
    const busy = await join(link.code, { email: "l20@example.test" }, { ip: "198.51.100.200" });
    expect(busy).toMatchObject({ status: 429, json: { error: "busy" } });
    expect(grants()).toHaveLength(20);
    expect(invitationPosts()).toHaveLength(20);
  });

  it("answers sent for an email with an account and for the same inbox again, with no new grant or invitation", async () => {
    const link = seedLink(5, "JoinCode0009");
    expect(await join(link.code, { email: "member@example.test" })).toMatchObject({ status: 200, json: { status: "sent" } });
    expect(grants()).toEqual([]);
    expect(invitationPosts()).toHaveLength(0);
    expect((await join(link.code, { email: "ab@gmail.com" })).json).toEqual({ status: "sent" });
    expect((await join(link.code, { email: "a.b+again@gmail.com" })).json).toEqual({ status: "sent" });
    expect(grants()).toHaveLength(1);
    expect(invitationPosts()).toHaveLength(1);
    // Clerk says the email has an account: same generic answer, the use is freed.
    clerkMode = "422";
    expect(await join(link.code, { email: "clerkonly@example.test" })).toMatchObject({ status: 200, json: { status: "sent" } });
    expect(grants()).toHaveLength(1);
  });

  it("answers 409 full on a full link and 404 for an unknown or malformed code", async () => {
    const link = seedLink(1, "JoinCode0010");
    expect((await join(link.code, { email: "one@example.test" })).status).toBe(200);
    expect(await join(link.code, { email: "two@example.test" })).toMatchObject({ status: 409, json: { status: "full" } });
    expect(await join("Unknown00000", { email: "two@example.test" })).toMatchObject({ status: 404, json: { status: "revoked" } });
    expect(await join("bad-code", { email: "two@example.test" })).toMatchObject({ status: 404, json: { status: "revoked" } });
    expect(grants()).toEqual([{ email: "one@example.test", status: "sent" }]);
  });

  it("answers 409 revoked after the owner revokes the link", async () => {
    const link = seedLink(5, "JoinCode0011");
    await createCreatorAccessService(db, { webUrl: ORIGIN, clerk: { revokeInvitation: async () => {} } as never }).revokeLink(link.creatorId, link.id);
    expect(await join(link.code, { email: "late@example.test" })).toMatchObject({ status: 409, json: { status: "revoked" } });
    expect(grants()).toEqual([]);
  });

  it("Clerk 5xx: 503 retry_later, the grant is failed and no use is counted", async () => {
    const link = seedLink(1, "JoinCode0012");
    clerkMode = "5xx";
    expect(await join(link.code, { email: "unlucky@example.test" })).toMatchObject({ status: 503, json: { error: "retry_later" } });
    expect(grants()).toEqual([{ email: "unlucky@example.test", status: "failed" }]);
    expect(createCreatorAccessService(db).publicLink(link.code)).toMatchObject({ state: "open", spotsLeft: 1 });
    clerkMode = "ok";
    expect(await join(link.code, { email: "lucky@example.test" })).toMatchObject({ status: 200, json: { status: "sent" } });
  });

  it("holds a fast 200 (existing account, honeypot) to the answer floor, so it reads like a Clerk send", async () => {
    vi.stubEnv("CREATOR_ANSWER_FLOOR_MS", "50");
    const link = seedLink(5, "JoinCode0013");
    for (const body of [{ email: "member@example.test" }, { email: "bot@example.test", company: "Acme" }]) {
      const started = Date.now();
      expect(await join(link.code, body)).toMatchObject({ status: 200, json: { status: "sent" } });
      expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    }
    expect(invitationPosts()).toHaveLength(0);
  });
});
