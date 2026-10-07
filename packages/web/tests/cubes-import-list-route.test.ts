import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const { auth, getDb } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/db", () => ({ getDb }));
let db: Database.Database;
let discord: ReturnType<typeof mockDiscordAccess>;
let upstream: Mock<typeof globalThis.fetch>;
const json = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const create = async (body: object) => (await import("../app/api/cubes/route")).POST(json(body));
const mutate = async (body: object, id = "1") => (await import("../app/api/cubes/[id]/cards/route")).POST(json(body), { params: Promise.resolve({ id }) });
const rows = () => db.prepare("select catalog_card_id id, pool, max_copies copies from cube_cards order by 1").all();

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "guild-1");
  auth.mockResolvedValue({ user: { id: "owner", name: "Owner" } });
  discord = mockDiscordAccess(); discord.permissions = "0";
  const discordFetch = globalThis.fetch;
  upstream = vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("ygoprodeck") ? upstream(input, init) : discordFetch(input, init)));
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  const insert = db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,?,?, 'i','i','[]','t')`);
  insert.run(1, "Dark Hole", "Spell Card", "spell");
  insert.run(2, "Shooting Star Dragon", "Synchro Monster", "synchro");
  insert.run(3, "Artifact Moralltach", "Effect Monster", "effect");
  db.exec("insert into cubes (guild_id,name,created_by_user_id) values ('guild-1','Existing','owner')");
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("cube editor list import", () => {
  it("accepts digit-leading printed names as one copy when the counted interpretation does not resolve", async () => {
    db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (4,'7 Colored Fish','Normal Monster','normal','i','i','[]','t'), (5,'7 Completed','Spell Card','spell','i','i','[]','t')`);
    upstream.mockImplementation(async () => Response.json({}, { status: 503 }));
    const result = await mutate({ op: "importList", text: "7 Colored Fish\n7 Completed\n3 7 Colored Fish\n7 Colored Fish x3\nDark Hole" });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ added: 3, copies: 9, unknown: [], corrected: [] });
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 1 }, { id: 4, pool: "main", copies: 7 }, { id: 5, pool: "main", copies: 1 }]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("reports blank-separated duplicate section labels as headings, while preserving bare name copies", async () => {
    const result = await mutate({ op: "importList", text: "Last updated: Oct 4th, 2026\nCurrent Size: 4\nDark Hole\n2 Dark Hole\n\n\nArtifact Moralltach\n1 Artifact Moralltach" });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ added: 2, copies: 4, unknown: ["Last updated: Oct 4th, 2026", "Current Size: 4", "Artifact Moralltach"] });
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 3 }, { id: 3, pool: "main", copies: 1 }]);
  });

  it("ignores leading/interstitial blank lines in ordinary bare/count lists", async () => {
    const result = await mutate({ op: "importList", text: "\n\nDark Hole\n2 Dark Hole\n\n\nArtifact Moralltach\n1 Artifact Moralltach" });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ added: 2, copies: 5, unknown: [] });
  });

  it("adds names and passcodes, returns diagnostics and pools, and caps summed copies", async () => {
    db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',97)");
    const result = await mutate({ op: "importList", text: "3 Dark Hole\n2 1\nShooting Star Dragon\n2 Artifact Moraltech\nGlue\nFlip.dek" });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ added: 3, copies: 5, unknown: ["Glue", "Flip.dek"], corrected: [{ from: "Artifact Moraltech", to: "Artifact Moralltach" }] });
    expect(body.cards).toHaveLength(3);
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 99 }, { id: 2, pool: "extra", copies: 1 }, { id: 3, pool: "main", copies: 2 }]);
  });

  it("honors name section headers and frame detection, including cards in both sections", async () => {
    const result = await mutate({ op: "importList", text: "Dark Hole\n#extra\n2 Dark Hole\n#main\nShooting Star Dragon" });
    expect(result.status).toBe(200);
    expect(rows()).toEqual([{ id: 1, pool: "extra", copies: 3 }, { id: 2, pool: "extra", copies: 1 }]);
  });

  it("accepts YDK and reports unknown names with their original count/notes", async () => {
    expect((await mutate({ op: "importList", text: "#created by owner\n#main\n1\n1\n#extra\n2\n!side\n3" })).status).toBe(200);
    const unknown = await (await mutate({ op: "importList", text: "3 Imaginary Card (note)\n999" })).json();
    expect(unknown).toMatchObject({ added: 0, copies: 0, unknown: ["3 Imaginary Card (note)", "999"], corrected: [] });
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 2 }, { id: 2, pool: "extra", copies: 1 }, { id: 3, pool: "main", copies: 1 }]);
  });

  it("returns zero results for comment-only input without touching the cube", async () => {
    const before = db.prepare("select updated_at from cubes where id = 1").get();
    expect(await (await mutate({ op: "importList", text: "#comment\n//comment" })).json()).toMatchObject({ added: 0, copies: 0, unknown: [], corrected: [] });
    expect(db.prepare("select updated_at from cubes where id = 1").get()).toEqual(before);
  });

  it.each([undefined, "", 7, "x".repeat(65537), Array.from({ length: 1001 }, (_, i) => `Card ${i}`).join("\n"), "0 Dark Hole", "#deckmaster\n1\n#deckmaster\n2"])("rejects invalid/oversized text before fetching: %#", async (text) => {
    const result = await mutate({ op: "importList", text });
    expect(result.status).toBe(400);
    expect(rows()).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["names", "passcodes"])("preserves every cube row when %s resolution fails", async (mode) => {
    db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',2)");
    upstream.mockImplementation(async () => Response.json({}, { status: 503 }));
    const result = await mutate({ op: "importList", text: mode === "names" ? "3 Dark Hole\nMissing" : "3 Dark Hole\n999" });
    expect(result.status).toBe(503);
    expect(result.headers.get("Retry-After")).toBe("1");
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 2 }]);
  });

  it("merges against copies written while a lookup was in progress", async () => {
    upstream.mockImplementationOnce(async () => {
      db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',4)");
      return Response.json({ error: "No card matching your query was found" }, { status: 400 });
    });
    expect((await mutate({ op: "importList", text: "2 Dark Hole\nUnknown" })).status).toBe(200);
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 6 }]);
  });

  it("retains membership, guild and owner/admin checks before any lookup", async () => {
    auth.mockResolvedValue(null);
    expect((await mutate({ op: "importList", text: "Dark Hole" })).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "stranger", name: "Stranger" } });
    expect((await mutate({ op: "importList", text: "Dark Hole" })).status).toBe(403);
    db.exec("update cubes set guild_id = 'other' where id = 1");
    expect((await mutate({ op: "importList", text: "Dark Hole" })).status).toBe(404);
    db.exec("update cubes set guild_id = 'guild-1' where id = 1");
    discord.permissions = "32"; vi.resetModules();
    expect((await mutate({ op: "importList", text: "Dark Hole" })).status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("create cube from list", () => {
  it("creates a populated cube, saves the draft type and returns the same import diagnostics", async () => {
    const result = await create({ name: "Imported", importText: "3 Dark Hole\nExtra Deck:\nArtifact Moraltech\nGlue", draftType: "booster" });
    expect(result.status).toBe(201);
    const body = await result.json();
    expect(body).toMatchObject({ cube: { name: "Imported", guildId: "guild-1", createdByUserId: "owner", draftType: "booster" }, added: 2, copies: 4,
      unknown: ["Glue"], corrected: [{ from: "Artifact Moraltech", to: "Artifact Moralltach" }] });
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 3 }, { id: 3, pool: "extra", copies: 1 }]);
    expect(JSON.parse((db.prepare("select config_json from cubes where id = ?").get(body.cube.id) as { config_json: string }).config_json).draftType).toBe("booster");
  });

  it.each([undefined, "list", "blank"])("supports optional import text with kind=%s", async (kind) => {
    expect((await create({ kind, name: "Imported", importText: "Dark Hole" })).status).toBe(201);
  });

  it.each(["Glue", "#comment\n//comment"])("creates nothing when no cards resolve: %s", async (importText) => {
    const result = await create({ name: "Empty", importText });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: "No cards found in that list.", added: 0, copies: 0, corrected: [] });
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
  });

  it.each(["", 7, "x".repeat(65537), Array.from({ length: 1001 }, (_, i) => `Card ${i}`).join("\n")])("rejects invalid text before creating or fetching: %#", async (importText) => {
    expect((await create({ name: "Invalid", importText })).status).toBe(400);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a missing list, conflicting sources, missing name and invalid draft type", async () => {
    for (const body of [
      { kind: "list", name: "Invalid" }, { kind: "pool", name: "Invalid", importText: "Dark Hole" },
      { kind: "archetype", name: "Invalid", importText: "Dark Hole" }, { name: "Invalid", importText: "Dark Hole", config: {} },
      { importText: "Dark Hole" }, { name: "Invalid", importText: "Dark Hole", draftType: "other" },
    ]) expect((await create(body)).status).toBe(400);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
  });

  it("rejects duplicate names case-insensitively, including a name taken during resolution", async () => {
    expect((await create({ name: "EXISTING", importText: "Dark Hole" })).status).toBe(409);
    upstream.mockImplementationOnce(async () => {
      db.exec("insert into cubes (guild_id,name,created_by_user_id) values ('guild-1','RACE','other')");
      return Response.json({ error: "No card matching your query was found" }, { status: 400 });
    });
    expect((await create({ name: "Race", importText: "Dark Hole\nMissing" })).status).toBe(409);
    expect(db.prepare("select count(*) n from cubes where lower(name) = 'race'").get()).toEqual({ n: 1 });
    expect(rows()).toEqual([]);
  });

  it("creates nothing on upstream failure or a later card write failure", async () => {
    upstream.mockImplementation(async () => Response.json({}, { status: 503 }));
    expect((await create({ name: "Offline", importText: "Dark Hole\nMissing" })).status).toBe(503);
    db.exec("create trigger fail_card before insert on cube_cards when NEW.catalog_card_id = 3 begin select raise(ABORT, 'write failed'); end;");
    expect((await create({ name: "Rollback", importText: "Dark Hole\nArtifact Moralltach" })).status).toBe(400);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
    expect(rows()).toEqual([]);
  });

  it("requires authentication and server configuration", async () => {
    auth.mockResolvedValue(null);
    expect((await create({ name: "Unauthed", importText: "Dark Hole" })).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "owner" } });
    vi.stubEnv("DISCORD_GUILD_ID", ""); vi.resetModules();
    expect((await create({ name: "NoServer", importText: "Dark Hole" })).status).toBe(500);
    expect(db.prepare("select count(*) n from cubes").get()).toEqual({ n: 1 });
  });
});


describe("cube subtract op", () => {
  it("returns the complete editor payload after subtracting duplicates and deleting exhausted rows", async () => {
    db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',5),(1,2,'extra',2),(1,3,'main',3)");
    const response = await mutate({ op: "subtract", entries: [
      { id: 1, copies: 1, pool: "main" }, { id: 1, copies: 2, pool: "main" },
      { id: 2, copies: 99, pool: "extra" }, { id: 3, copies: 99, pool: "extra" },
      { id: 999, copies: 1, pool: "main" },
    ] });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(Object.keys(result).sort()).toEqual(["cards", "pools"]);
    expect(result.pools).toMatchObject({ main: [{ catalogCardId: 1, maxCopies: 2 }, { catalogCardId: 3, maxCopies: 3 }], extra: [] });
    expect(result.cards.map((c: { id: number }) => c.id)).toEqual([1, 3]);
    expect(upstream).not.toHaveBeenCalled();
    expect((await mutate({ op: "subtract", entries: [] })).status).toBe(200);
  });

  it.each([null, {}, [null], [{ id: 0, copies: 1, pool: "main" }],
    [{ id: 1.5, copies: 1, pool: "main" }], [{ id: 1, copies: 0, pool: "main" }],
    [{ id: 1, copies: 100, pool: "main" }], [{ id: 1, copies: 1.5, pool: "main" }],
    [{ id: 1, copies: 1 }], [{ id: 1, copies: 1, pool: "side" }],
    Array.from({ length: 1001 }, () => ({ id: 1, copies: 1, pool: "main" }))])("rejects malformed entries without writes: %#", async (entries) => {
    db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,1,'main',5)");
    expect((await mutate({ op: "subtract", entries })).status).toBe(400);
    expect(rows()).toEqual([{ id: 1, pool: "main", copies: 5 }]);
  });

  it("accepts exactly 1000 entries and retains the existing access checks", async () => {
    const body = { op: "subtract", entries: Array.from({ length: 1000 }, () => ({ id: 1, copies: 1, pool: "main" })) };
    auth.mockResolvedValue(null);
    expect((await mutate(body)).status).toBe(401);
    auth.mockResolvedValue({ user: { id: "stranger", name: "Stranger" } });
    expect((await mutate(body)).status).toBe(403);
    db.exec("update cubes set guild_id = 'other' where id = 1");
    expect((await mutate(body)).status).toBe(404);
    db.exec("update cubes set guild_id = 'guild-1' where id = 1");
    discord.permissions = "32"; vi.resetModules();
    expect((await mutate(body)).status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });
});


it("bounds passcode list fetches and includes lookupLimited on editor/create responses", async () => {
  const codes = Array.from({ length: 999 }, (_, i) => String(900000 + i));
  const result = await (await mutate({ op: "importList", text: [...codes, "Dark Hole"].join("\n") })).json();
  expect(result).toMatchObject({ lookupLimited: true, added: 1, copies: 1, unknown: codes });
  expect(upstream).toHaveBeenCalledTimes(50);
  upstream.mockClear();
  const created = await (await create({ name: "Limited", importText: [...codes, "Dark Hole"].join("\n") })).json();
  expect(created).toMatchObject({ lookupLimited: true, unknown: codes });
  expect(upstream).toHaveBeenCalledTimes(50);
}, 40000);
