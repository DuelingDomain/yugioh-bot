import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDraftService, createCubeService, createCardCatalogService } from "@yugidraft/shared/services";
import { migrate } from "@yugidraft/shared/db";
const { getDb, requireWebAccess, cubeWriteAccess, callDuelHost } = vi.hoisted(() => ({ getDb: vi.fn(), requireWebAccess: vi.fn(), cubeWriteAccess: vi.fn(), callDuelHost: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess }));
vi.mock("@/lib/cube-access", () => ({ cubeWriteAccess }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
let db: Database.Database;
beforeEach(() => {
  vi.clearAllMocks(); db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  requireWebAccess.mockResolvedValue({ ok: true, userId: "u", userName: "Yugi" }); cubeWriteAccess.mockResolvedValue(null);
  db.exec(`insert into cubes (id,guild_id,name,created_by_user_id) values (1,'g','Cube','u');
    insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (10,'Dragon','Normal Monster','normal','full','small','[]','now');
    insert into cube_cards (cube_id,catalog_card_id,pool,max_copies,source) values (1,10,'main',2,'custom');`);
  callDuelHost.mockResolvedValue({ ok: true, data: { passcode: 10, artworks: [{ passcode: 10, isMain: true }, { passcode: 11, isMain: false }] } });
});
afterEach(() => db.close());
async function swap(to = 11) {
  const { POST } = await import("../app/api/cubes/[id]/cards/route");
  return POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ op: "setArtwork", catalogCardId: 10, artworkPasscode: to }) }), { params: Promise.resolve({ id: "1" }) });
}
it("retains pool, copies and source while materializing an engine-only display art", async () => {
  const response = await swap(); expect(response.status).toBe(200);
  expect((await response.json()).pools.main).toEqual([{ catalogCardId: 11, pool: "main", maxCopies: 2, source: "custom" }]);
  expect(db.prepare("select source from card_artworks where artwork_id = 11").get()).toEqual({ source: "engine" });
  expect(db.prepare("select name from card_catalog where ygoprodeck_id = 11").get()).toEqual({ name: "Dragon" });
});
it("rejects unrelated artwork without changing the cube", async () => {
  expect((await swap(99)).status).toBe(400);
  expect(db.prepare("select catalog_card_id from cube_cards").all()).toEqual([{ catalog_card_id: 10 }]);
});
it("does not overwrite a target art already present in the cube", async () => {
  await swap();
  db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,10,'main',1)");
  expect((await swap()).status).toBe(400);
  expect(db.prepare("select sum(max_copies) as n from cube_cards").get()).toEqual({ n: 3 });
});
it("enforces cube write access before contacting the engine", async () => {
  cubeWriteAccess.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }));
  expect((await swap()).status).toBe(403); expect(callDuelHost).not.toHaveBeenCalled();
});

function themeDraft() {
  db.exec("insert into card_catalog select 20,'Other',type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype from card_catalog where ygoprodeck_id = 10");
  db.exec("insert into cube_cards (cube_id,catalog_card_id,pool,max_copies) values (1,20,'main',3)");
  const players = ["p1", "p2"].map(user => Number(db.prepare("insert into players (guild_id,discord_user_id,display_name) values ('g',?,?)").run(user, user).lastInsertRowid));
  const drafts = createDraftService(db);
  const draft = drafts.create("g", "c", "Theme", { mode: "theme", allowedCubeIds: [1], themeSelection: "random",
    uniqueThemes: false, cardsPerPlayer: 4, themePackSize: 2, extraDeckEnabled: false, copyLimit: false }, "u", players[0]);
  drafts.join(draft.id, players[1]);
  return { drafts, draft, players };
}
it("blocks pending drafts whose allowed cubes include this cube and names the draft", async () => {
  const { draft } = themeDraft();
  db.prepare("update drafts set web_slug = 'abc123' where id = ?").run(draft.id);
  const response = await swap();
  expect(response.status).toBe(409);
  const { error } = await response.json();
  expect(error).toContain('"Theme" (abc123)');
  expect(error).toContain("pending draft");
  expect(error).toMatch(/finish or cancel/i);
  expect(db.prepare("select catalog_card_id from cube_cards where catalog_card_id != 20").all()).toEqual([{ catalog_card_id: 10 }]);
});
it("blocks an assigned active cube after a pick, even without allowedCubeIds", async () => {
  const { drafts, draft, players } = themeDraft(); drafts.start(draft.id);
  drafts.pickCard(draft.id, players[0], drafts.currentPackOptions(draft.id, players[0]).find(c => c.catalogCardId === 10)!.id, "manual");
  db.prepare("update drafts set config_json = json_remove(config_json, '$.allowedCubeIds') where id = ?").run(draft.id);
  expect((await swap()).status).toBe(409);
  expect(db.prepare("select catalog_card_id from cube_cards where catalog_card_id != 20").all()).toEqual([{ catalog_card_id: 10 }]);
});
it("demonstrates that bypassing the guard over-deals the same family", () => {
  const { drafts, draft, players } = themeDraft(); drafts.start(draft.id);
  drafts.pickCard(draft.id, players[0], drafts.currentPackOptions(draft.id, players[0]).find(c => c.catalogCardId === 10)!.id, "manual");
  db.exec("insert into card_catalog select 11,name,type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype from card_catalog where ygoprodeck_id = 10");
  db.exec("update cube_cards set catalog_card_id = 11 where cube_id = 1 and catalog_card_id = 10");
  for (let round = 0; round < 4; round++) for (const player of players) {
    const options = drafts.currentPackOptions(draft.id, player);
    if (options.length) drafts.pickCard(draft.id, player, (options.find(c => c.catalogCardId === 11) ?? options[0]).id, "manual");
  }
  const picked = db.prepare("select dc.catalog_card_id from draft_picks p join draft_cards dc on dc.id = p.draft_card_id where p.player_id = ? and dc.catalog_card_id in (10,11) order by p.id").all(players[0]);
  expect(picked).toEqual([{ catalog_card_id: 10 }, { catalog_card_id: 11 }, { catalog_card_id: 11 }]); // max_copies is only 2
});
it.each(["completed", "cancelled"])("allows a cube used only by a %s draft", async status => {
  const { draft } = themeDraft(); db.prepare("update drafts set status = ? where id = ?").run(status, draft.id);
  expect((await swap()).status).toBe(200);
});
it("maps an engine-unknown cube source to 400, preserving host failures", async () => {
  for (const [hostStatus, expected] of [[404, 400], [503, 503]]) {
    callDuelHost.mockResolvedValue({ ok: false, response: Response.json({ error: "Unknown source" }, { status: hostStatus }) });
    expect((await swap()).status).toBe(expected);
  }
});

it("keeps engine-only artwork in the existing local API family", async () => {
  db.exec("insert into card_catalog select 12,name,type,frame_type,effect_text,atk,def,attribute,level,image_url,image_url_small,card_sets_json,cached_at,archetype from card_catalog where ygoprodeck_id = 10");
  db.exec("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main) values (12,12,'full','small',1),(12,10,'full','small',0)");
  expect((await swap()).status).toBe(200);
  expect(db.prepare("select card_id,is_main from card_artworks where artwork_id = 11").get()).toEqual({ card_id: 12, is_main: 0 });
});


it("dedupes legacy config membership against the swapped row without losing authored copies", async () => {
  const config = { customCardIds: [20, 10, 10, 11, 20], setNames: ["Legacy set"], cardsPerPlayer: 8 };
  db.prepare("update cubes set config_json = ? where id = 1").run(JSON.stringify(config));
  expect((await swap()).status).toBe(200);
  const cubes = createCubeService(db, createCardCatalogService(db));
  expect(cubes.findCube(1)?.config).toEqual({ ...config, customCardIds: [20, 20] });
  expect(cubes.applyCubeToConfig(1).customCardIds).toEqual([20, 20, 11, 11]);
});

it("rolls back artwork rows and config together when the cube update fails", async () => {
  const config = JSON.stringify({ customCardIds: [10, 11] });
  db.prepare("update cubes set config_json = ? where id = 1").run(config);
  db.exec("create trigger reject_cube_update before update on cubes begin select raise(abort, 'cube update failed'); end");
  expect((await swap()).status).toBe(400);
  expect(db.prepare("select catalog_card_id from cube_cards").all()).toEqual([{ catalog_card_id: 10 }]);
  expect(db.prepare("select config_json from cubes where id = 1").get()).toEqual({ config_json: config });
  expect(db.prepare("select 1 from card_catalog where ygoprodeck_id = 11").get()).toBeUndefined();
  expect(db.prepare("select 1 from card_artworks where artwork_id = 11").get()).toBeUndefined();
});
