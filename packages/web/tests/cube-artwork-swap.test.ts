import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
