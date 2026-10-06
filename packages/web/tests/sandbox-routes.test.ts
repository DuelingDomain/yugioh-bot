import type Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { createDuelService, createPlayerService, createSandboxScenarioService } from "@yugidraft/shared/services";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), membership: vi.fn(), post: vi.fn(), db: null as Database.Database | null }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/discord-web-access", () => ({
  checkDiscordWebAccess: mocks.access,
  webAccessError: (status: number) => status === 403 ? "Forbidden" : "Access unavailable",
}));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: mocks.membership }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild", duelInternalUrl: "http://host", duelInternalSecret: "test" } }));
vi.mock("@yugidraft/shared/notify", () => ({ httpTransport: () => ({ post: mocks.post }) }));

const board = { p0: { hand: [46986414] } };
const run = { bots: { "1": "pass", "2": "pass", "3": "pass" } };
const write = { name: " Board ", board, run };
const slugParams = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idParams = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path: string, body?: unknown, method = "POST") => new NextRequest(`http://local${path}`, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const payloads = () => mocks.post.mock.calls.map((call) => JSON.parse(call[1]));
let owner: number;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = openDatabase(":memory:");
  owner = createPlayerService(mocks.db).findOrCreate("guild", "admin", "Admin").id;
  mocks.auth.mockResolvedValue({ user: { id: "admin", name: "Admin" } });
  mocks.access.mockResolvedValue({ ok: true });
  mocks.membership.mockResolvedValue({ ok: true });
  mocks.post.mockImplementation(async (_path: string, raw: string) => {
    const { op } = JSON.parse(raw);
    const data = op === "validate-board" ? { ok: true, errors: [], codes: [46986414] }
      : op === "start-sandbox" || op === "sandbox-restart" ? { slug: "started" }
      : op === "sandbox-info" ? { board, run, scenarioId: 1 }
      : { session: { slug: "room" }, mySeat: 1 };
    return { ok: true, status: 200, text: JSON.stringify(data) };
  });
});
afterEach(() => { mocks.db?.close(); vi.unstubAllEnvs(); });

function scenario(guildId = "guild", ownerPlayerId = owner) {
  return createSandboxScenarioService(mocks.db!).create(guildId, ownerPlayerId, write);
}
function duel(sandbox = true) {
  return createDuelService(mocks.db!).create({ guildId: "guild", organizerPlayerId: owner, name: "Test", mode: "normal", masterRule: 5, sandbox });
}

// Exercise the real guard; only Discord and the signed host transport are stubbed.
describe("sandbox admin gate", () => {
  it.each(["production", "development", "test"])("denies members in %s through the shared admin entry point", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    mocks.access.mockResolvedValue({ ok: false, status: 403 });
    const { requireDuelActor } = await import("@/lib/duel-host");
    const actor = await requireDuelActor("admin");
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith("admin", "admin");
    expect(mocks.membership).not.toHaveBeenCalled();
  });
  it("allows an admin with only the shared access entry point", async () => {
    mocks.membership.mockRejectedValue(new Error("Do not use the direct membership guard"));
    const { requireSandboxActor } = await import("@/lib/sandbox-access");
    expect(await requireSandboxActor()).toMatchObject({ ok: true, guildId: "guild", playerId: owner });
  });
  it.each([401, 403, 503])("returns %i before any host call", async (status) => {
    if (status === 401) mocks.auth.mockResolvedValue(null);
    else mocks.access.mockResolvedValue({ ok: false, status });
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(request("/api/sandbox/start", { board, run }))).status).toBe(status);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("route access coverage", () => {
  it.each(["production", "development"])("requires admin on every endpoint in %s", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    mocks.access.mockResolvedValue({ ok: false, status: 403 });
    const collection = await import("../app/api/sandbox/scenarios/route");
    const item = await import("../app/api/sandbox/scenarios/[id]/route");
    const validate = await import("../app/api/sandbox/validate/route");
    const start = await import("../app/api/sandbox/start/route");
    const sandbox = await import("../app/api/duels/[slug]/sandbox/route");
    const view = await import("../app/api/duels/[slug]/route");
    const actions = await import("../app/api/duels/[slug]/actions/route");
    const responses = [
      await collection.GET(), await collection.POST(request("/", write)),
      await item.GET(request("/", undefined, "GET"), idParams(1)),
      await item.PUT(request("/", write, "PUT"), idParams(1)),
      await item.DELETE(request("/", undefined, "DELETE"), idParams(1)),
      await validate.POST(request("/", { board })), await start.POST(request("/", { board, run })),
      await sandbox.GET(request("/", undefined, "GET"), slugParams("s")),
      ...await Promise.all(["control", "restart", "go-to-phase", "next-turn"].map((action) =>
        sandbox.POST(request("/", { action }), slugParams("s")))),
      await view.GET(request("/?as=0", undefined, "GET"), slugParams("s")),
      await actions.POST(request("/?reveal=false", {}), slugParams("s")),
    ];
    expect(responses.map((response) => response.status)).toEqual(responses.map(() => 403));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(createSandboxScenarioService(mocks.db!).list("guild")).toEqual([]);
  });
  it("allows admin requests in production with no scenario env flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUEL_SCENARIOS", "0");
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(request("/", { board, run }))).status).toBe(200);
  });
});

describe("scenario routes", () => {
  it("creates, lists, loads, updates and deletes a guild scenario", async () => {
    const collection = await import("../app/api/sandbox/scenarios/route");
    const item = await import("../app/api/sandbox/scenarios/[id]/route");
    const created = await collection.POST(request("/api/sandbox/scenarios", write));
    expect(created.status).toBe(201);
    const { scenario: saved } = await created.json();
    expect(saved).toMatchObject({ name: "Board", ownerPlayerId: owner, board: { startAt: "draw" } });
    expect(await (await collection.GET()).json()).toEqual({ scenarios: [saved] });
    expect(await (await item.GET(request("/", undefined, "GET"), idParams(saved.id))).json()).toEqual({ scenario: saved });
    const updated = await item.PUT(request("/", { ...write, name: "New" }, "PUT"), idParams(saved.id));
    expect(updated.status).toBe(200);
    expect((await updated.json()).scenario.name).toBe("New");
    expect((await item.DELETE(request("/", undefined, "DELETE"), idParams(saved.id))).status).toBe(200);
    expect((await item.GET(request("/", undefined, "GET"), idParams(saved.id))).status).toBe(404);
  });
  it("lets another admin read and copy, but not update or delete", async () => {
    const saved = scenario();
    mocks.auth.mockResolvedValue({ user: { id: "other", name: "Other" } });
    const item = await import("../app/api/sandbox/scenarios/[id]/route");
    const collection = await import("../app/api/sandbox/scenarios/route");
    expect((await item.GET(request("/", undefined, "GET"), idParams(saved.id))).status).toBe(200);
    expect((await item.PUT(request("/", write, "PUT"), idParams(saved.id))).status).toBe(403);
    expect((await item.DELETE(request("/", undefined, "DELETE"), idParams(saved.id))).status).toBe(403);
    expect((await collection.POST(request("/", write))).status).toBe(201);
  });
  it("does not expose a scenario from another guild", async () => {
    const other = createPlayerService(mocks.db!).findOrCreate("elsewhere", "other", "Other");
    const saved = scenario("elsewhere", other.id);
    const collection = await import("../app/api/sandbox/scenarios/route");
    const item = await import("../app/api/sandbox/scenarios/[id]/route");
    expect(await (await collection.GET()).json()).toEqual({ scenarios: [] });
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      expect((await item[method](request("/", method === "PUT" ? write : undefined, method), idParams(saved.id))).status).toBe(404);
    }
  });
  it.each(["0", "1x", "-1", "9007199254740992"])("rejects invalid id %s", async (id) => {
    const { GET } = await import("../app/api/sandbox/scenarios/[id]/route");
    expect((await GET(request("/", undefined, "GET"), idParams(id))).status).toBe(400);
  });
  it("returns the service limit status", async () => {
    const service = createSandboxScenarioService(mocks.db!);
    for (let i = 0; i < 200; i++) service.create("guild", owner, write);
    const { POST } = await import("../app/api/sandbox/scenarios/route");
    expect((await POST(request("/", write))).status).toBe(409);
  });
  it("rejects a bad board before saving or calling the host", async () => {
    const { POST } = await import("../app/api/sandbox/scenarios/route");
    const response = await POST(request("/", { ...write, board: { teams: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ path: "teams" });
    expect(createSandboxScenarioService(mocks.db!).list("guild")).toEqual([]);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("validation and start", () => {
  it("uses the parser defaults and forwards validate results", async () => {
    const { POST } = await import("../app/api/sandbox/validate/route");
    const response = await POST(request("/", { board }));
    expect(await response.json()).toEqual({ ok: true, errors: [], codes: [46986414] });
    expect(payloads()[0]).toMatchObject({ op: "validate-board", guildId: "guild", playerId: owner, board: { startAt: "draw", p0: board.p0 } });
  });
  it("starts with board, run and a guild-scoped scenario id", async () => {
    const saved = scenario();
    const { POST } = await import("../app/api/sandbox/start/route");
    expect(await (await POST(request("/", { board, run, scenarioId: saved.id }))).json()).toEqual({ slug: "started" });
    expect(payloads().at(-1)).toMatchObject({ op: "start-sandbox", board: { startAt: "draw" }, run, scenarioId: saved.id });
  });
  it("rejects an unknown scenario id", async () => {
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(request("/", { board, run, scenarioId: 123 }))).status).toBe(404);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([{ board: { p0: { hand: ["Blue-Eyes"] } }, run }, { board, run: { bots: {} } }, { board, run, scenarioId: "1" }])("rejects invalid start data", async (body) => {
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(request("/", body))).status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("preserves host errors", async () => {
    mocks.post.mockResolvedValue({ ok: false, status: 429, text: JSON.stringify({ error: "Too many starts", code: "rate-limit" }) });
    const { POST } = await import("../app/api/sandbox/start/route");
    const response = await POST(request("/", { board, run }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many starts", code: "rate-limit" });
  });
  it.each(["null", "[]", "bad json"])("rejects body %s", async (body) => {
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(new Request("http://local", { method: "POST", body }))).status).toBe(400);
  });
  it("limits UTF-8 body bytes even without a content-length header", async () => {
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(request("/", { ...write, name: "é".repeat(33000) }))).status).toBe(413);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("duel sandbox operations", () => {
  it.each([
    [{ action: "control", seat: 1, control: "manual" }, "sandbox-control"],
    [{ action: "restart" }, "sandbox-restart"],
    [{ action: "go-to-phase", phase: "main2", as: 0, reveal: false }, "sandbox-go-to-phase"],
    [{ action: "next-turn", as: 1, reveal: true }, "sandbox-next-turn"],
  ] as const)("forwards %j", async (body, op) => {
    const session = duel();
    const { POST } = await import("../app/api/duels/[slug]/sandbox/route");
    const response = await POST(request("/", body), slugParams(session.slug));
    expect(response.status).toBe(200);
    const { action: _action, ...fields } = body;
    expect(payloads()[0]).toEqual({ op, slug: session.slug, guildId: "guild", playerId: owner, ...fields });
  });
  it("forwards sandbox info", async () => {
    const session = duel();
    const { GET } = await import("../app/api/duels/[slug]/sandbox/route");
    expect(await (await GET(request("/", undefined, "GET"), slugParams(session.slug))).json()).toEqual({ board, run, scenarioId: 1 });
    expect(payloads()[0].op).toBe("sandbox-info");
  });
  it("leaves organizer and sandbox-only checks to the host", async () => {
    mocks.post.mockResolvedValue({ ok: false, status: 403, text: '{"error":"Organizer only"}' });
    const { POST } = await import("../app/api/duels/[slug]/sandbox/route");
    expect((await POST(request("/", { action: "restart" }), slugParams("foreign"))).status).toBe(403);
  });
  it.each([{ action: "invalid" }, { action: "control", seat: "1", control: "manual" }, { action: "control", seat: 1, control: "bad" }, { action: "go-to-phase" }])("rejects malformed control %j", async (body) => {
    const { POST } = await import("../app/api/duels/[slug]/sandbox/route");
    expect((await POST(request("/", body), slugParams("room"))).status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("passes view query options, including false and zero, to the host in a lobby", async () => {
    const session = duel();
    const { GET } = await import("../app/api/duels/[slug]/route");
    const response = await GET(request("/?as=0&reveal=false", undefined, "GET"), slugParams(session.slug));
    expect(response.status).toBe(200);
    expect(payloads()[0]).toMatchObject({ op: "view", as: 0, reveal: false });
    expect(mocks.access).toHaveBeenCalledWith("admin", "admin");
  });
  it("passes action query options without changing the command", async () => {
    const session = duel();
    const { POST } = await import("../app/api/duels/[slug]/actions/route");
    const command = { promptId: "p", revision: 0, answer: { choice: "opt:0" } };
    expect((await POST(request("/?as=1&reveal=1", command), slugParams(session.slug))).status).toBe(200);
    expect(payloads()[0]).toMatchObject({ op: "respond", as: 1, reveal: true, command });
  });
  it.each(["as=-1", "as=1.5", "as=x", "as=4", "as=", "reveal=x"])("rejects malformed query %s", async (query) => {
    const session = duel();
    const { GET } = await import("../app/api/duels/[slug]/route");
    expect((await GET(request(`/?${query}`, undefined, "GET"), slugParams(session.slug))).status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(["view", "actions"])("requires admin on sandbox %s without query options", async (route) => {
    const session = duel();
    mocks.access.mockResolvedValue({ ok: false, status: 403 });
    const view = await import("../app/api/duels/[slug]/route");
    const actions = await import("../app/api/duels/[slug]/actions/route");
    const response = route === "view" ? await view.GET(request("/", undefined, "GET"), slugParams(session.slug))
      : await actions.POST(request("/", {}), slugParams(session.slug));
    expect(response.status).toBe(403);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("keeps ordinary lobby views available to members", async () => {
    const session = duel(false);
    mocks.access.mockResolvedValue({ ok: false, status: 403 });
    const { GET } = await import("../app/api/duels/[slug]/route");
    expect((await GET(request("/", undefined, "GET"), slugParams(session.slug))).status).toBe(200);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe("request boundaries", () => {
  it("stops and cancels an oversized stream before reading more chunks", async () => {
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(65537)); },
      cancel,
    }, { highWaterMark: 0 });
    const input = new Request("http://local", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const { POST } = await import("../app/api/sandbox/start/route");
    expect((await POST(input)).status).toBe(413);
    expect(reads).toBe(1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("enforces the same body limit on scenario writes and sandbox actions", async () => {
    const saved = scenario();
    const session = duel();
    const body = { ...write, padding: "x".repeat(65536) };
    const collection = await import("../app/api/sandbox/scenarios/route");
    const item = await import("../app/api/sandbox/scenarios/[id]/route");
    const validate = await import("../app/api/sandbox/validate/route");
    const sandbox = await import("../app/api/duels/[slug]/sandbox/route");
    const actions = await import("../app/api/duels/[slug]/actions/route");
    const responses = [
      await collection.POST(request("/", body)),
      await item.PUT(request("/", body, "PUT"), idParams(saved.id)),
      await validate.POST(request("/", body)),
      await sandbox.POST(request("/", body), slugParams(session.slug)),
      await actions.POST(request("/?as=0", body), slugParams(session.slug)),
    ];
    expect(responses.map((response) => response.status)).toEqual([413, 413, 413, 413, 413]);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("passes validation errors from the compiler back to the builder", async () => {
    const errors = { ok: false, errors: [{ path: "p0.hand[0]", message: "Unknown card" }], codes: [] };
    mocks.post.mockResolvedValue({ ok: true, status: 200, text: JSON.stringify(errors) });
    const { POST } = await import("../app/api/sandbox/validate/route");
    expect(await (await POST(request("/", { board }))).json()).toEqual(errors);
  });
  it("forwards ordinary commands without sandbox options", async () => {
    const session = duel(false);
    const command = { promptId: "p", revision: 0, answer: { choice: "opt:0" } };
    const { POST } = await import("../app/api/duels/[slug]/actions/route");
    expect((await POST(request("/", command), slugParams(session.slug))).status).toBe(200);
    expect(payloads()[0]).toEqual({ op: "respond", slug: session.slug, guildId: "guild", playerId: owner, command });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("forwards false reveal and seat zero for surrender through the host adapter", async () => {
    const { callDuelHost } = await import("@/lib/duel-host");
    await callDuelHost({ op: "surrender", slug: "s", guildId: "guild", playerId: owner, as: 0, reveal: false });
    expect(payloads()[0]).toMatchObject({ op: "surrender", as: 0, reveal: false });
  });
});
