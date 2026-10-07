import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
const tempDirs: string[] = [];
let discord: ReturnType<typeof mockDiscordAccess>;

vi.mock("@/lib/auth", () => ({ auth }));

async function setupDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-cubes-pool-"));
  const dbPath = join(tempDir, "cubes.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_DEFAULT_CHANNEL_ID = "channel-1";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const ins = db.prepare(
    `insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
     values (?,?,?,?,?,?,?,?)`,
  );
  ins.run(1, "Main A", "Normal Monster", "normal", "i", "i", "[]", "t");
  ins.run(2, "Xyz B", "XYZ Monster", "xyz", "i", "i", "[]", "t");
  ins.run(3, "Main C", "Effect Monster", "effect", "i", "i", "[]", "t");
  db.exec(`insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main)
    select ygoprodeck_id,ygoprodeck_id,image_url,image_url_small,1 from card_catalog`);
  db.close();
}

async function rawDb() {
  const Database = (await import("better-sqlite3")).default;
  return new Database(process.env.DATABASE_PATH!);
}

const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as any;

describe("cube pool routes", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("creator")), discordUserId: fixtureDiscordId("creator"), name: "Yugi" } });
    discord = mockDiscordAccess();
    discord.permissions = "0";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    delete process.env.DISCORD_DEFAULT_CHANNEL_ID;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createPool(body: object) {
    const { POST } = await import("../app/api/cubes/route");
    return POST(json({ kind: "pool", ...body }));
  }

  it.each(["network", "timeout", "429", "503", "json"])("saves a legacy cube during %s failures and returns 503 for missing data", async (failure) => {
    await setupDb();
    const db = await rawDb(); db.exec("delete from card_artworks"); db.close();
    const discordFetch = globalThis.fetch;
    const upstream = vi.fn(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("bad JSON", { status: failure === "json" ? 200 : Number(failure), headers: { "Retry-After": "2" } });
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("ygoprodeck") ? upstream() : discordFetch(input, init)));
    const cached = await createPool({ name: "Cached", cards: [{ id: 1, copies: 3 }, { id: 2, copies: 1 }] });
    expect(cached.status).toBe(201);
    expect(upstream).not.toHaveBeenCalled();
    const missing = await createPool({ name: "Missing", cards: [{ id: 99999999, copies: 1 }] });
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toContain("Try again");
    const verify = await rawDb();
    expect(verify.prepare("select count(*) as n from cubes where name = 'Missing'").get()).toEqual({ n: 0 });
    verify.close();
  });

  it("bounds catalog warming to 50 fetches and reports skipped ids", async () => {
    await setupDb();
    const discordFetch = globalThis.fetch;
    const upstream = vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("ygoprodeck") ? upstream() : discordFetch(input, init)));
    const ids = Array.from({ length: 1000 }, (_, i) => 900000 + i);
    const result = await (await createPool({ name: "Limited", cards: [
      { id: 1, copies: 2 }, ...ids.map((id) => ({ id, copies: 1 })),
    ].slice(0, 1000) })).json();
    expect(result).toMatchObject({ lookupLimited: true, unknownIds: ids.slice(0, 999) });
    expect(upstream).toHaveBeenCalledTimes(50);
  }, 40000);

  it("saves a pool as a real cube, splitting extra frames, summing duplicates and reporting unknown ids", async () => {
    await setupDb();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    const res = await createPool({
      name: "  Pool  ",
      cards: [{ id: 1, copies: 2 }, { id: 1, copies: 3 }, { id: 2, copies: 1 }, { id: 777, copies: 1 }],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.unknownIds).toEqual([777]);
    expect(body.cube).toMatchObject({ name: "Pool", draftType: "any" });
    const db = await rawDb();
    expect(
      db.prepare("select catalog_card_id id, pool, max_copies copies from cube_cards where cube_id = ? order by 1").all(body.cube.id),
    ).toEqual([
      { id: 1, pool: "main", copies: 5 },
      { id: 2, pool: "extra", copies: 1 },
    ]);
    db.close();
  });

  it("answers 409 when another save takes the name while the card list is being fetched", async () => {
    await setupDb();
    // The early name check has passed; the clashing cube lands during the card database request.
    let taken = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!taken) {
        taken = true;
        const db = await rawDb();
        db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'RACE', ${fixtureUserId("other")})`).run();
        db.close();
      }
      return Response.json({ data: [] });
    }));
    const res = await createPool({ name: "Race", cards: [{ id: 1, copies: 1 }, { id: 777, copies: 1 }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A cube named "Race" already exists');
    const db = await rawDb();
    expect(db.prepare("select count(*) n from cubes where lower(name) = 'race'").get()).toEqual({ n: 1 });
    db.close();
  });

  it("rejects a taken name case-insensitively and bad input", async () => {
    await setupDb();
    expect((await createPool({ name: "Pool", cards: [{ id: 1, copies: 1 }] })).status).toBe(201);
    const dupe = await createPool({ name: "pOOL", cards: [{ id: 1, copies: 1 }] });
    expect(dupe.status).toBe(409);
    expect((await dupe.json()).error).toBe('A cube named "pOOL" already exists');
    expect((await createPool({ name: " ", cards: [] })).status).toBe(400);
    for (const cards of [[{ id: 1, copies: 0 }], [{ id: 1, copies: 100 }], [{ id: 1, copies: 1.5 }], "x"]) {
      expect((await createPool({ name: "Other", cards })).status).toBe(400);
    }
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: 5_000 + i, copies: 1 }));
    expect((await createPool({ name: "Big", cards: many })).status).toBe(400);
  });

  it("copies the extra pool of another cube in the guild only", async () => {
    await setupDb();
    const db = await rawDb();
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Src', ${fixtureUserId("x")})`).run();
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('other', 'Foreign', ${fixtureUserId("x")})`).run();
    db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1,2,'extra',3)").run();
    db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (2,2,'extra',3)").run();
    db.close();
    const ok = await (await createPool({ name: "Copy", cards: [{ id: 1, copies: 1 }], copyExtraFromCubeId: 1 })).json();
    const foreign = await (await createPool({ name: "Copy2", cards: [{ id: 1, copies: 1 }], copyExtraFromCubeId: 2 })).json();
    const check = await rawDb();
    const extra = (id: number) =>
      check.prepare("select catalog_card_id id, max_copies copies from cube_cards where cube_id = ? and pool = 'extra'").all(id);
    expect(extra(ok.cube.id)).toEqual([{ id: 2, copies: 3 }]);
    expect(extra(foreign.cube.id)).toEqual([]);
    check.close();
  });

  describe("replaceMain", () => {
    async function seededCube() {
      await setupDb();
      const db = await rawDb();
      db.prepare(
        `insert into cubes (guild_id, name, created_by_user_id, config_json) values ('guild-1', 'Legacy', ${fixtureUserId("creator")}, ?)`,
      ).run(JSON.stringify({ setNames: ["S"], customCardIds: [1], draftType: "theme" }));
      db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1,1,'main',2)").run();
      db.prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1,2,'extra',4)").run();
      db.close();
      const { POST } = await import("../app/api/cubes/[id]/cards/route");
      return (body: object) => POST(json(body), { params: Promise.resolve({ id: "1" }) });
    }

    it("replaces main, leaves extra, strips customCardIds and setNames and counts skipped extra cards", async () => {
      const post = await seededCube();
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
      const res = await post({ op: "replaceMain", cards: [{ id: 3, copies: 2 }, { id: 2, copies: 1 }, { id: 888, copies: 1 }] });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ skippedExtra: 1, unknownIds: [888] });
      expect(body.pools.main.map((c: any) => [c.catalogCardId, c.maxCopies])).toEqual([[3, 2]]);
      expect(body.pools.extra.map((c: any) => [c.catalogCardId, c.maxCopies])).toEqual([[2, 4]]);
      const db = await rawDb();
      expect(JSON.parse((db.prepare("select config_json from cubes where id = 1").get() as any).config_json)).toEqual({
        draftType: "theme",
      });
      db.close();
    });

    it("is 403 for a non-owner non-admin and 400 for bad cards", async () => {
      const post = await seededCube();
      expect((await post({ op: "replaceMain", cards: [{ id: 3, copies: 0 }] })).status).toBe(400);
      auth.mockResolvedValue({ user: { id: String(fixtureUserId("stranger")), discordUserId: fixtureDiscordId("stranger"), name: "Joey" } });
      expect((await post({ op: "replaceMain", cards: [{ id: 3, copies: 1 }] })).status).toBe(403);
      discord.permissions = "32";
      vi.resetModules();
      const { POST } = await import("../app/api/cubes/[id]/cards/route");
      const res = await POST(json({ op: "replaceMain", cards: [{ id: 3, copies: 1 }] }), { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(200);
    });
  });

  it("GET returns creator, creator name and canEdit", async () => {
    await setupDb();
    const db = await rawDb();
    db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('guild-1', ${fixtureUserId("creator")}, '${fixtureDiscordId("creator")}', 'Yugi')`).run();
    db.prepare("update users set display_name = ? where id = ?").run("Yugi", fixtureUserId("creator"));
    db.prepare("update users set display_name = ? where id = ?").run("Seto", fixtureUserId("someone"));
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Mine', ${fixtureUserId("creator")})`).run();
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Theirs', ${fixtureUserId("someone")})`).run();
    db.close();
    const { GET } = await import("../app/api/cubes/route");
    const cubes = (await (await GET()).json()).cubes;
    expect(cubes.map((c: any) => [c.name, c.createdByUserId, c.createdByName, c.canEdit])).toEqual([
      ["Mine", fixtureUserId("creator"), "Yugi", true],
      ["Theirs", fixtureUserId("someone"), "Seto", false],
    ]);
    discord.permissions = "32";
    vi.resetModules();
    const again = (await (await (await import("../app/api/cubes/route")).GET()).json()).cubes;
    expect(again.map((c: any) => c.canEdit)).toEqual([true, true]);
    // Membership succeeds; only the non-owner admin lookup is unavailable.
    discord.guildStatus = 500;
    vi.resetModules();
    const failed = await (await import("../app/api/cubes/route")).GET();
    expect(failed.status).toBe(200);
  });

  it("validates poolSource on draft create and keeps the cube name from the database", async () => {
    await setupDb();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    const db = await rawDb();
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('guild-1', 'Real Name', ${fixtureUserId("x")})`).run();
    db.prepare(`insert into cubes (guild_id, name, created_by_user_id) values ('other', 'Foreign', ${fixtureUserId("x")})`).run();
    db.close();
    const { POST } = await import("../app/api/drafts/route");
    const make = (name: string, poolSource: unknown) =>
      POST(json({ name, config: { setNames: [], customCardIds: [1, 3], packSize: 8, packsPerPlayer: 5, poolSource } }));
    expect((await make("D1", { cubeId: 1, cubeName: "Fake" })).status).toBe(201);
    expect((await make("D2", { cubeId: 2, cubeName: "Foreign" })).status).toBe(201);
    expect((await make("D3", { cubeId: "x" })).status).toBe(201);
    const check = await rawDb();
    const cfg = (name: string) =>
      JSON.parse((check.prepare("select config_json from drafts where name = ?").get(name) as any).config_json);
    expect(cfg("D1").poolSource).toEqual({ cubeId: 1, cubeName: "Real Name" });
    expect(cfg("D2").poolSource).toBeUndefined();
    expect(cfg("D3").poolSource).toBeUndefined();
    check.close();
  });
});

const FIXTURE_KEYS = ["creator", "other", "x", "stranger", "someone"] as const;
