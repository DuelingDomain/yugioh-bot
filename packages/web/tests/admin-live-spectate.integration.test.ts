import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { createDraftService, createCubeService, createCardCatalogService } from "@yugidraft/shared/services";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { auth, getDb, callHost } = vi.hoisted(() => ({ auth: vi.fn(), getDb: vi.fn(), callHost: vi.fn() }));
vi.mock("@/lib/session-identity", async () => { const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(auth); });
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost: callHost }));
let db: Database.Database;
beforeEach(() => {
  vi.resetModules(); auth.mockReset(); getDb.mockReset(); callHost.mockReset();
  auth.mockResolvedValue({ user: { id: "1", name: "Owner" } });
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_GUILD_ID", "g"); vi.stubEnv("WS_INTERNAL_SECRET", "watch-test");
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  db.exec(`insert into users(id,username,display_name) values (1,'owner','Owner'),(2,'a','Alice'),(3,'b','Bob');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values (12,'g','a','Alice',2),(13,'g','b','Bob',3);`);
  callHost.mockImplementation(async input => input.op === "card-details" ? { ok: true, data: { cards: [], missing: input.codes ?? [] } } : { ok: true, data: { session: { slug: "table" }, engine: { prompt: { title: "Choose" } } } });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const request = (kind: string, slug: string, query = "") => new Request(`http://localhost/api/admin/${kind}/${slug}/spectate${query}`);
async function duel(query = "") { const { GET } = await import("../app/api/admin/duels/[slug]/spectate/route"); return GET(request("duels", "table", query), ctx("table")); }
async function draft(slug: string, query = "") { const { GET } = await import("../app/api/admin/drafts/[slug]/spectate/route"); return GET(request("drafts", slug, query), ctx(slug)); }
function table(guild = "g") { db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,settings_json) values (?,'table','Private',12,'normal','active','ffa3','{"visibility":"private"}')`).run(guild); }
function seedDraft(mode: "booster" | "theme", active = true) {
  const cubes = createCubeService(db, createCardCatalogService(db));
  const cube = cubes.createBlank("g", "Theme", 2);
  for (let id = 1; id <= 12; id++) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(?,?,'Normal Monster','normal','https://img/1','https://img/1','[]','t')").run(id, `Card ${id}`);
    cubes.addCard(cube.id, id, "main", 1);
  }
  const drafts = createDraftService(db, { random: () => 0.5 });
  const d = drafts.create("g", "c", mode, mode === "theme"
    ? { mode, allowedCubeIds: [cube.id], themeSelection: "random", uniqueThemes: false, extraDeckEnabled: false, cardsPerPlayer: 4, themePackSize: 3 }
    : { mode, customCardIds: Array.from({ length: 12 }, (_, i) => i + 1), cardsPerPlayer: 4, packSize: 2, packsPerPlayer: 2 }, 2, 12);
  drafts.join(d.id, 13); if (active) drafts.start(d.id);
  db.prepare("update drafts set visibility='private',pick_deadline_at='2000-01-01T00:00:00Z' where id=?").run(d.id); return d;
}
const rows = () => db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((r: any) => [r.name, db.prepare(`select * from "${r.name}"`).all()]);
it("owner duel reads use session identity and a dedicated host operation, never create a player", async () => {
  table(); const before = rows(); const res = await duel("?seat=2&userId=2&playerId=12");
  expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toContain("no-store");
  expect(callHost).toHaveBeenCalledWith({ op: "admin-spectate", guildId: "g", userId: 1, slug: "table", seat: 2 });
  expect(await res.json()).toMatchObject({ readOnly: true, pov: 2, room: { engine: { prompt: { title: "Choose" } } } }); expect(rows()).toEqual(before);
});
it("rejects non-owners, missing sessions, cross-guild targets and malformed seats before host access", async () => {
  table("other"); expect((await duel()).status).toBe(404); db.prepare("update duels set guild_id='g'").run();
  for (const q of ["?seat=-1", "?seat=3", "?seat=0&seat=1", "?seat=1.0", "?seat=all"]) expect((await duel(q)).status).toBe(400);
  auth.mockResolvedValue({ user: { id: "2" } }); expect((await duel()).status).toBe(404);
  auth.mockResolvedValue(null); expect((await duel()).status).toBe(401); expect(callHost).not.toHaveBeenCalled();
});
it.each(["booster", "theme"] as const)("projects each private %s player's actual draft page without expiring overdue picks", async mode => {
  const d = seedDraft(mode); const before = rows();
  for (const playerId of [12, 13]) {
    const res = await draft(d.webSlug!, `?seat=${playerId}`); expect(res.status).toBe(200);
    const body = await res.json(); expect(body).toMatchObject({ readOnly: true, pov: playerId, draft: { status: "active", isMyTurn: true } });
    expect(body.draft.currentPack.length).toBeGreaterThan(0); expect(body.draft.myPool).toEqual([]);
    expect(body.draft.seats.find((s: any) => s.isCurrentPlayer).playerId).toBe(playerId);
  }
  expect(rows()).toEqual(before); expect((await draft(d.webSlug!, "?seat=1")).status).toBe(400);
  auth.mockResolvedValue({ user: { id: "2" } }); expect((await draft(d.webSlug!, "?seat=13")).status).toBe(404);
});
it("minted tokens are admin spectators and cannot be used as normal player tokens", async () => {
  table(); const { GET } = await import("../app/api/admin/duels/[slug]/spectate/connection/route");
  const res = await GET(request("duels", "table"), ctx("table")); expect(res.status).toBe(200);
  const { token } = await res.json(); const { verifyAdminSpectateToken, verifyDuelConnectionToken } = await import("@yugidraft/shared/ws");
  expect(verifyAdminSpectateToken(token, "watch-test")).toMatchObject({ kind: "duel", role: "admin-spectator", userId: 1, guildId: "g", slug: "table" });
  expect(verifyDuelConnectionToken(token, "watch-test")).toBeNull();
});

it("watching an all-capped booster pack does not exchange cards with the undealt remainder", async () => {
  const d = seedDraft("booster"); const drafts = createDraftService(db);
  const pack = drafts.currentPackOptions(d.id, 12);
  const packId = (db.prepare("select draft_pack_id as id from draft_cards where id=?").get(pack[0].id) as { id: number }).id;
  let step = -1;
  for (const held of pack) for (let copy = 0; copy < 3; copy++) {
    const id = db.prepare("insert into draft_cards(draft_id,wave_number,draft_pack_id,catalog_card_id,position,picked_by_player_id,picked_at) values(?,1,?,?,99,12,'t')").run(d.id, packId, held.catalogCardId).lastInsertRowid;
    db.prepare("insert into draft_picks(draft_id,player_id,draft_card_id,wave_number,pick_step,pick_method,picked_at) values(?,12,?,1,?,'manual','t')").run(d.id, id, step--);
  }
  db.prepare("insert into draft_undealt(draft_id,catalog_card_id,position) values(?,12,999)").run(d.id);
  const before = rows(); const response = await draft(d.webSlug!, "?seat=12"); expect(response.status).toBe(200);
  expect(rows()).toEqual(before);
});

it("returns chronological picks, the selected pool and the selected saved draft deck", async () => {
  const d = seedDraft("booster"); const drafts = createDraftService(db);
  const card = drafts.currentPackOptions(d.id, 12)[0];
  drafts.pickCard(d.id, 12, card.id);
  db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json,draft_id) values('g',2,'Draft deck','normal',?,?)")
    .run(JSON.stringify({ main: [card.catalogCardId], extra: [], side: [] }), d.id);
  const before = rows(); const body = await (await draft(d.webSlug!, "?seat=12")).json();
  expect(body.picks).toMatchObject([{ playerId: 12, draftCardId: card.id, waveNumber: 1 }]);
  expect(body.draft.myPool).toMatchObject([{ id: card.id, passcode: card.catalogCardId }]);
  expect(body.deck).toEqual({ main: [card.catalogCardId], extra: [], side: [] });
  const other = await (await draft(d.webSlug!, "?seat=13")).json(); expect(other.deck).toBeNull(); expect(other.draft.myPool).toEqual([]);
  expect(rows()).toEqual(before);
});
it("does not tick an overdue auto-start lobby while watching", async () => {
  const d = seedDraft("booster", false);
  db.prepare("update drafts set lobby_auto_start=1,lobby_auto_held=0,lobby_start_at='2000-01-01T00:00:00Z' where id=?").run(d.id);
  const before = rows(); const response = await draft(d.webSlug!, "?seat=12");
  expect(response.status).toBe(200); expect((await response.json()).draft.status).toBe("pending"); expect(rows()).toEqual(before);
});

it("does not return a private host response after owner access is revoked in flight", async () => {
  table(); callHost.mockImplementationOnce(async () => { vi.stubEnv("OWNER_USER_IDS", ""); return { ok: true, data: { privateHand: "secret" } }; });
  const response = await duel("?seat=0"); expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("secret"); expect(response.headers.get("cache-control")).toContain("no-store");
});
