import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";

const { actor, database, broadcast, environment } = vi.hoisted(() => ({
  actor: { userId: 101 as number | null }, database: { current: null as Database.Database | null }, broadcast: vi.fn(),
  environment: { discordGuildId: "g", webUrl: "https://tournament.example", discordBotEnabled: false },
}));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: async () => actor.userId === null
  ? { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  : { ok: true, userId: actor.userId, userName: "Guest", discordUserId: null } }));
vi.mock("@/lib/db", () => ({ getDb: () => database.current! }));
vi.mock("@/lib/env", () => ({ env: environment }));
vi.mock("@/lib/notify", () => ({ broadcaster: { tournament: broadcast, draft: vi.fn() }, announcer: { announce: vi.fn() } }));

function request(method: string, body?: unknown) {
  return new Request("https://tournament.example/api/tournaments/tournament/invite", {
    method, headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as NextRequest;
}
function context(slug = "tournament") { return { params: Promise.resolve({ slug }) }; }
async function invite(method: "GET" | "POST", body?: unknown, slug = "tournament") {
  const route = await import("../app/api/tournaments/[slug]/invite/route");
  return route[method](request(method, body), context(slug));
}
async function reset(slug = "tournament") {
  return (await import("../app/api/tournaments/[slug]/invite/reset/route")).POST(request("POST"), context(slug));
}
async function visibility(value: unknown, slug = "tournament") {
  return (await import("../app/api/tournaments/[slug]/visibility/route")).PATCH(request("PATCH", { visibility: value }), context(slug));
}
async function join() {
  return (await import("../app/api/tournaments/[slug]/join/route")).POST(request("POST"), context());
}
async function detail() {
  return (await import("../app/api/tournaments/[slug]/route")).GET(request("GET"), context());
}

beforeEach(() => {
  vi.resetModules(); broadcast.mockReset(); broadcast.mockResolvedValue(undefined); actor.userId = 101;
  environment.discordBotEnabled = false;
  // These routes must stay offline, including creation from already-cached cards.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  database.current = new Database(":memory:"); migrate(database.current); database.current.pragma("foreign_keys=on");
  database.current.exec(`insert into users(id,username,display_name) values(101,'creator','Creator'),(102,'participant','Participant'),(103,'grant','Grant'),(104,'stranger','Stranger');
    insert into players(id,guild_id,user_id,display_name) values(1,'g',102,'Participant');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug) values(1,'g','Tournament','round_robin','pending',101,'tournament');
    insert into tournament_participants(tournament_id,player_id) values(1,1);`);
  database.current.exec("insert into tournament_invite_grants(tournament_id,user_id) values(1,103)");
});
afterEach(() => { database.current?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("tournament invites", () => {
  it("rate limits redemption across tournament slugs before code comparison", async () => {
    actor.userId = 104;
    for (let i = 0; i < 10; i++) expect((await invite("POST", { code: "wrong" }, `unknown-${i}`)).status).toBe(404);
    const limited = await invite("POST", { code: "wrong" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("lazily creates and reuses the host link without exposing it to guests", async () => {
    expect(database.current!.prepare("select invite_code from tournaments").get()).toEqual({ invite_code: null });
    const response = await invite("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const first = await response.json();
    expect(first.inviteCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.inviteUrl).toBe(`https://tournament.example/tournament/tournament?invite=${first.inviteCode}`);
    expect(await (await invite("GET")).json()).toEqual(first);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("records an application-user grant on a matching link, retains grants on reset and rejects the old code", async () => {
    const old = await (await invite("GET")).json();
    actor.userId = 104;
    expect((await detail()).status).toBe(404);
    expect((await invite("POST", { code: old.inviteCode })).status).toBe(200);
    expect(await (await invite("POST", { code: old.inviteCode })).json()).toEqual({ ok: true });
    expect(database.current!.prepare("select user_id from tournament_invite_grants order by user_id").all()).toEqual([{ user_id: 103 }, { user_id: 104 }]);
    expect(database.current!.prepare("select id from players where user_id=104").get()).toBeUndefined();
    expect(await (await detail()).json()).toMatchObject({ visibility: "private", canJoin: true });
    actor.userId = 101;
    const rotated = await (await reset()).json();
    expect(rotated.inviteCode).not.toBe(old.inviteCode);
    expect(rotated.inviteUrl).toBe(`https://tournament.example/tournament/tournament?invite=${rotated.inviteCode}`);
    actor.userId = 104;
    expect((await invite("POST", { code: old.inviteCode })).status).toBe(404);
    expect((await detail()).status).toBe(200);
    expect((await join()).status).toBe(200);
    expect((await invite("POST", { code: rotated.inviteCode })).status).toBe(200);
    expect(broadcast.mock.calls).toEqual([[{ kind: "participant-joined", slug: "tournament", playerId: 2, displayName: "Guest" }]]);
  });

  it.each(["wrong", "x".repeat(43), "", null, 123, {}, undefined])("hides a mismatched or invalid invite (%j)", async (code) => {
    await invite("GET"); actor.userId = 104;
    const response = await invite("POST", { code });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Tournament not found" });
    expect(database.current!.prepare("select user_id from tournament_invite_grants where user_id=104").get()).toBeUndefined();
  });

  it("does not admit an uninitialized, missing or other-guild tournament", async () => {
    actor.userId = 104;
    expect((await invite("POST", { code: "unknown" })).status).toBe(404);
    expect((await invite("POST", { code: "unknown" }, "missing")).status).toBe(404);
    database.current!.exec("update tournaments set guild_id='other',invite_code='known'");
    expect((await invite("POST", { code: "known" })).status).toBe(404);
  });

  it("returns the same 404 for malformed JSON", async () => {
    actor.userId = 104;
    const route = await import("../app/api/tournaments/[slug]/invite/route");
    expect((await route.POST(new Request("http://localhost", { method: "POST", body: "{" }), context())).status).toBe(404);
  });
});

describe("creator endpoints", () => {
  for (const [name, call] of [["read link", () => invite("GET")], ["reset link", () => reset()], ["visibility", () => visibility("open")]] as const) {
    it.each([102, 103, 104])(`${name} returns 404 for noncreator %s`, async (userId) => {
      actor.userId = userId;
      expect((await call()).status).toBe(404);
      expect(database.current!.prepare("select visibility,invite_code from tournaments").get()).toEqual({ visibility: "private", invite_code: null });
    });
    it(`${name} requires a session and hides another guild`, async () => {
      actor.userId = null; expect((await call()).status).toBe(401);
      actor.userId = 101; database.current!.exec("update tournaments set guild_id='other'");
      expect((await call()).status).toBe(404);
    });
  }
  it("invite redemption requires a session", async () => { actor.userId = null; expect((await invite("POST", { code: "a" })).status).toBe(401); });
});

describe("visibility", () => {
  it("changes pending visibility and sends only a lobby invalidation", async () => {
    expect((await visibility("open")).status).toBe(200);
    expect(await (await visibility("private")).json()).toEqual({ visibility: "private" });
    expect(broadcast.mock.calls).toEqual([[{ kind: "match-updated", slug: "tournament" }], [{ kind: "match-updated", slug: "tournament" }]]);
    expect(database.current!.prepare("select invite_code from tournaments").get()).toEqual({ invite_code: null });
  });
  it.each(["public", "", null, 123, {}])("validates the visibility value (%j)", async (value) => {
    expect((await visibility(value)).status).toBe(400);
    expect(database.current!.prepare("select visibility from tournaments").get()).toEqual({ visibility: "private" });
  });
  it.each(["active", "completed", "cancelled"])("keeps the access policy fixed after start (%s)", async (status) => {
    database.current!.prepare("update tournaments set status=?").run(status);
    expect((await visibility("open")).status).toBe(409);
    expect(broadcast).not.toHaveBeenCalled();
  });
});


const mutationRoutes = [
  ["DELETE", ""], ["PUT", ""], ["PATCH", ""], ["POST", ""],
  ["POST", "/join"], ["POST", "/leave"], ["POST", "/kick"], ["POST", "/reopen"],
  ["POST", "/complete"], ["POST", "/announce"], ["POST", "/join-bot"],
  ["GET", "/deck"], ["PUT", "/deck"], ["POST", "/report"],
  ["POST", "/matches/[tmId]/result"], ["POST", "/matches/[tmId]/duel"],
] as const;
async function mutation(method: string, suffix: string, body: string = "{") {
  const route = await import(/* @vite-ignore */ `../app/api/tournaments/[slug]${suffix}/route.ts`);
  return route[method](new Request("https://tournament.example", { method, ...(method === "GET" ? {} : { body }) }),
    { params: Promise.resolve({ slug: "tournament", tmId: "bad" }) });
}
describe("private tournament route boundary", () => {
  it.each(mutationRoutes)("%s %s hides strangers before validation, roles, statuses or feature checks", async (method, suffix) => {
    actor.userId = 104;
    const services = await import("@yugidraft/shared/services");
    vi.spyOn(services, "findTournamentReadAccess").mockReturnValue({ id: 1, status: "pending", visibility: "private", isParticipant: false, canRead: false, canJoin: false });
    const response = await mutation(method, suffix);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Tournament not found" });
    expect(database.current!.prepare("select id from players where user_id=104").get()).toBeUndefined();
  });
  it("shows capability fields without an invite code", async () => {
    expect(await (await detail()).json()).toMatchObject({ visibility: "private", canJoin: true, canManageInvite: true });
    actor.userId = 103;
    const body = await (await detail()).json();
    expect(body).toMatchObject({ visibility: "private", canJoin: true });
    expect(body).not.toHaveProperty("canManageInvite");
    expect(body).not.toHaveProperty("inviteCode");
  });
  it("allows grant holders and creators to join but not a private stranger", async () => {
    actor.userId = 104; expect((await join()).status).toBe(404);
    expect(database.current!.prepare("select id from players where user_id=104").get()).toBeUndefined();
    actor.userId = 103; expect((await join()).status).toBe(200);
    expect((await join()).status).toBe(400);
    actor.userId = 101; expect((await join()).status).toBe(200);
  });
  it("keeps the started-tournament error for existing participants", async () => {
    actor.userId = 102; database.current!.exec("update tournaments set status='active'");
    const response = await join(); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Tournament has already started" });
  });
  it("checks access and inserts a participant inside the same immediate transaction", async () => {
    const original = database.current!.transaction.bind(database.current!);
    let immediate = false;
    vi.spyOn(database.current!, "transaction").mockImplementation(((work: (...args: unknown[]) => unknown) => {
      const transaction = original(work);
      const wrapped = ((...args: unknown[]) => transaction(...args)) as typeof transaction;
      Object.assign(wrapped, { immediate: (...args: unknown[]) => { immediate = true; return transaction.immediate(...args); },
        deferred: transaction.deferred, exclusive: transaction.exclusive });
      return wrapped;
    }) as Database.Database["transaction"]);
    const services = await import("@yugidraft/shared/services");
    const policy = services.findTournamentReadAccess;
    const access = vi.spyOn(services, "findTournamentReadAccess").mockImplementation((...args) => {
      expect(immediate).toBe(true); expect(database.current!.inTransaction).toBe(true); return policy(...args);
    });
    expect((await join()).status).toBe(200);
    expect(access).toHaveBeenCalledWith(database.current, "tournament", "g", 101);
  });
});
describe("creation visibility", () => {
  async function create(value?: unknown) {
    return (await import("../app/api/tournaments/route")).POST(request("POST", { name: "New Cup", format: "round_robin", ...(value === undefined ? {} : { visibility: value }) }));
  }
  it.each(["open", "private"])("accepts explicit %s", async (value) => {
    const response = await create(value); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ visibility: value });
    expect(database.current!.prepare("select visibility from tournaments where name='New Cup'").get()).toEqual({ visibility: value });
  });
  it("defaults a new tournament to private", async () => {
    const response = await create(); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ visibility: "private" });
  });
  it.each(["public", null, 1, {}])("rejects invalid visibility %j", async (value) => {
    expect((await create(value)).status).toBe(400);
    expect(database.current!.prepare("select 1 from tournaments where name='New Cup'").get()).toBeUndefined();
  });
});

describe("source draft privacy", () => {
  beforeEach(() => {
    database.current!.exec("insert into drafts(id,guild_id,name,status,created_by_user_id,web_slug,tournament_id) values(1,'g','Source','completed',101,'secret-draft',1)");
  });
  it("hides a private source draft slug from a tournament grant holder", async () => {
    actor.userId = 103;
    const body = await (await detail()).json();
    expect(body.draftId).toBe(1); expect(body.draftSlug).toBeNull();
  });
  it("hides a private source draft link in the participant deck response", async () => {
    database.current!.exec("insert into players(id,guild_id,user_id,display_name) values(2,'g',103,'Grant'); insert into tournament_participants(tournament_id,player_id) values(1,2)");
    actor.userId = 103;
    const response = await mutation("GET", "/deck"); expect(response.status).toBe(200);
    expect((await response.json()).draft).toBeNull();
  });
  it("keeps a readable source draft link", async () => {
    expect((await (await detail()).json()).draftSlug).toBe("secret-draft");
  });
});

describe("draft tournament conversion", () => {
  async function convert() {
    return (await import("../app/api/drafts/[slug]/tournament/route")).POST(request("POST", { format: "round_robin" }), context("source"));
  }
  function seed(visibility: "open" | "private") {
    database.current!.prepare("insert into drafts(id,guild_id,name,status,created_by_user_id,web_slug,visibility,config_json) values(1,'g','Source','completed',101,'source',?,'{}')").run(visibility);
    database.current!.exec("insert into players(id,guild_id,user_id,display_name) values(2,'g',101,'Creator'); insert into draft_players(draft_id,player_id) values(1,1),(1,2); insert into draft_invite_grants(draft_id,user_id) values(1,104)");
  }
  it.each(["open", "private"] as const)("inherits %s and seats players without copying draft grants", async (visibility) => {
    seed(visibility); const response = await convert(); expect(response.status).toBe(201);
    const body = await response.json(); expect(body.visibility).toBe(visibility);
    expect(database.current!.prepare("select visibility from tournaments where id=?").get(body.id)).toEqual({ visibility });
    expect(database.current!.prepare("select p.user_id from tournament_participants tp join players p on p.id=tp.player_id where tp.tournament_id=? order by p.user_id").all(body.id)).toEqual([{ user_id: 101 }, { user_id: 102 }]);
    expect(database.current!.prepare("select user_id from tournament_invite_grants where tournament_id=?").all(body.id)).toEqual([]);
  });
  it("hides an unreadable existing linked tournament from the draft creator", async () => {
    seed("private"); database.current!.exec("update drafts set tournament_id=1; update tournaments set created_by_user_id=104");
    const response = await convert(); expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Tournament not found" });
  });
});
