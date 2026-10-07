import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { finishTestLobbyStart } from "./drafts-lobby-routes.test";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { NextRequest } from "next/server";

const getDb = vi.fn();
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture((() => ({ auth: async () => ({ user: { id: String(fixtureUserId("user")), discordUserId: fixtureDiscordId("user"), name: "Test" } }) }))().auth);
});
vi.mock("@/lib/notify", () => ({ announcer: { announce: async () => {} }, broadcaster: { draft: async () => {} } }));
let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); db = new Database(":memory:"); migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS); getDb.mockReturnValue(db);
  vi.stubEnv("DISCORD_GUILD_ID", "guild"); vi.stubEnv("DISCORD_DEFAULT_CHANNEL_ID", "channel");
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(["network", "timeout", "429", "503", "json"])("card API %s failures", (failure) => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network") throw new Error("secret network detail");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("bad JSON", { status: failure === "json" ? 200 : Number(failure), headers: { "Retry-After": "2" } });
    }));
  });
  it.each([
    { cardName: "Missing" }, { fuzzyName: "missing" }, { archetype: "Missing" },
    { setNames: ["Missing"] }, { customCardIds: [12345678] },
  ])("returns 503 for resolve %j without cache", async (body) => {
    const { POST } = await import("../app/api/cards/resolve/route");
    const response = await POST(new Request("http://localhost/api/cards/resolve", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Card database is unavailable. Try again shortly." });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
  it.each(["sets", "archetypes", "preview"])("returns 503 for %s without cache", async (path) => {
    let response: Response;
    if (path === "sets") response = await (await import("../app/api/sets/route")).POST();
    else if (path === "archetypes") response = await (await import("../app/api/archetypes/route")).GET(new Request("http://localhost/api/archetypes"));
    else response = await (await import("../app/api/sets/[name]/route")).GET(new NextRequest("http://localhost/api/sets/Missing"), { params: Promise.resolve({ name: "Missing" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Try again");
  });
  it("returns 503 for a draft with only part of its set cached", async () => {
    db.exec(`insert into card_sets (set_name,set_code,card_count,synced_at) values ('Partial Set','PS',2,'old');
      insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (10000000,'Legacy','Effect Monster','effect','full','small','[{"set_name":"Partial Set"}]','old');`);
    const { POST } = await import("../app/api/drafts/route");
    const response = await POST(new NextRequest("http://localhost/api/drafts", { method: "POST", body: JSON.stringify({
      name: "Partial Set", config: { setNames: ["Partial Set"], packSize: 8, packsPerPlayer: 5, pickSeconds: 60 },
    }) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Try again");
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 0 });
  });
  it("creates and starts a cached legacy draft, and returns 503 for an uncached draft", async () => {
    db.exec("insert into card_sets (set_name,set_code,card_count,synced_at) values ('Legacy Set','LS',100,'old')");
    const insert = db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (?, ?, ?, ?, 'full','small',?,'old')`);
    for (let i = 0; i < 100; i++) {
      const frame = i % 10 < 6 ? "effect" : i % 10 < 8 ? "spell" : "trap";
      insert.run(10000000 + i, `Legacy ${i}`, frame === "effect" ? "Effect Monster" : frame === "spell" ? "Spell Card" : "Trap Card",
        frame, JSON.stringify([{ set_name: "Legacy Set" }]));
    }
    const { POST } = await import("../app/api/drafts/route");
    const create = (set: string) => POST(new NextRequest("http://localhost/api/drafts", { method: "POST", body: JSON.stringify({ name: set,
      config: { setNames: [set], packSize: 8, packsPerPlayer: 5, pickSeconds: 60 } }) }));
    const cached = await create("Legacy Set");
    expect(cached.status).toBe(201);
    const draft = await cached.json();
    const { createDraftService, createPlayerService } = await import("@yugidraft/shared/services");
    const opponent = createPlayerService(db).findOrCreate("guild", fixtureUserId("opponent"), "Opponent");
    createDraftService(db).join(draft.id, opponent.id);
    const started = await (await import("../app/api/drafts/[slug]/route")).POST(new Request("http://localhost/start", { method: "POST", body: JSON.stringify({ force: true }) }), { params: Promise.resolve({ slug: draft.webSlug }) });
    expect(started.status).toBe(202);
    expect((await finishTestLobbyStart(started, db)).status).toBe("active");
    const missing = await create("Missing Set");
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toContain("Try again");
  });
});

describe.each([400, 401, 403, 404, 422])("permanent card API HTTP %s failures", (status) => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/ for syntax usage.",
    }), { status })));
  });
  it.each(["resolve", "preview", "draft"])("returns 400 Unknown set for %s with an invalid set name", async (path) => {
    const name = "Pendulum Domination Structure Decc";
    let response: Response;
    if (path === "resolve") {
      const { POST } = await import("../app/api/cards/resolve/route");
      response = await POST(new Request("http://localhost/api/cards/resolve", {
        method: "POST", body: JSON.stringify({ setNames: [name] }),
      }));
    } else if (path === "preview") {
      const { GET } = await import("../app/api/sets/[name]/route");
      response = await GET(new NextRequest("http://localhost/api/sets/invalid"), { params: Promise.resolve({ name }) });
    } else {
      const { POST } = await import("../app/api/drafts/route");
      response = await POST(new NextRequest("http://localhost/api/drafts", { method: "POST", body: JSON.stringify({
        name, config: { setNames: [name], packSize: 8, packsPerPlayer: 5, pickSeconds: 60 },
      }) }));
    }
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown set" });
    expect(response.headers.get("Retry-After")).toBeNull();
  });
});

const FIXTURE_KEYS = ["user", "opponent"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
