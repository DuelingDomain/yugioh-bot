import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createDraftTournamentService } from "../../src/services/draft-tournament.js";
import { createCubeService } from "../../src/services/cubes.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";

const databases: Database.Database[] = [];
const now = new Date("2030-01-01T00:00:00Z");
function setup(mode: "booster" | "theme" = "booster", verbose?: (sql: unknown) => void) {
  const db = new Database(":memory:", { verbose });
  databases.push(db);
  migrate(db);
  const host = seedUser(db, "host");
  const players = [host, seedUser(db, "guest")].map(user => seedIdentity(db, {
    guildId: "g", userId: user.userId, discordUserId: user.discordUserId,
  }).playerId);
  const main = Array.from({ length: 16 }, (_, i) => i + 1);
  const extra = Array.from({ length: 8 }, (_, i) => i + 101);
  const insert = db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,?,?,'i','i','[]','t')`);
  for (const id of main) insert.run(id, `Main ${id}`, "Normal Monster", "normal");
  for (const id of extra) insert.run(id, `Extra ${id}`, "Fusion Monster", "fusion");
  const cubes = createCubeService(db, createCardCatalogService(db));
  const cube = cubes.createBlank("g", "Cube", host.userId);
  for (const id of main) cubes.addCard(cube.id, id, "main", 1);
  for (const id of extra) cubes.addCard(cube.id, id, "extra", 1);
  const drafts = createDraftService(db, { seedSource: () => 7 });
  const draft = drafts.create("g", "c", "Emergency", {
    customCardIds: main, customExtraCardIds: extra, packSize: 2, packsPerPlayer: 1,
    cardsPerPlayer: 2, extraDeckEnabled: true, extraDeckSize: 2,
    ...(mode === "theme" ? { mode, allowedCubeIds: [cube.id], uniqueThemes: false,
      themeSelection: "random", themePackSize: 2 } : {}),
  }, host.userId, players[0]);
  drafts.join(draft.id, players[1]);
  const pick = (playerId = players[0], method: "manual" | "auto" = "manual") =>
    drafts.pickCard(draft.id, playerId, drafts.pickOptions(draft.id, playerId)[0].id, method, now);
  return { db, drafts, draft, players, host, pick };
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("emergency draft termination", () => {
  it("clears the deadline on ordinary completion and preserves the completed result on end retry", () => {
    const ctx = setup(); ctx.drafts.start(ctx.draft.id, now);
    for (let step = 0; step < 10 && ctx.drafts.findById(ctx.draft.id).status === "active"; step++) {
      for (const player of ctx.players) ctx.pick(player);
    }
    const completed = ctx.drafts.findById(ctx.draft.id);
    expect(completed).toMatchObject({ status: "completed", pickDeadlineAt: null });
    const stored = ctx.db.prepare("select ended_at, lobby_revision from drafts where id = ?").get(ctx.draft.id);
    expect(ctx.drafts.endNow(ctx.draft.id)).toEqual(completed);
    expect(ctx.db.prepare("select ended_at, lobby_revision from drafts where id = ?").get(ctx.draft.id)).toEqual(stored);
  });
  it.each(["booster", "theme"] as const)("ends %s with uneven picks without inventing cards", mode => {
    const { db, drafts, draft, players, pick } = setup(mode);
    drafts.start(draft.id, now);
    pick();
    const picks = drafts.picks(draft.id);
    expect(drafts.endNow(draft.id, now)).toMatchObject({ status: "completed", pickDeadlineAt: null });
    expect(drafts.picks(draft.id)).toEqual(picks);
    expect(drafts.pool(draft.id, players[0])).toHaveLength(1);
    expect(drafts.pool(draft.id, players[1])).toEqual([]);
    expect(drafts.exportYdk(draft.id, players[0])).toContain(String(drafts.pool(draft.id, players[0])[0].catalogCardId));
    expect(drafts.exportYdk(draft.id, players[1])).toContain("#main");
    const deck = db.prepare("select deck_json from saved_decks where draft_id = ?").all(draft.id) as { deck_json: string }[];
    expect(deck).toHaveLength(1);
    expect(JSON.parse(deck[0].deck_json).main).toHaveLength(1);
    expect(drafts.endNow(draft.id, new Date("2031-01-01"))).toMatchObject({ status: "completed" });
    expect(drafts.picks(draft.id)).toEqual(picks);
    expect(() => drafts.cancel(draft.id)).toThrow(/finished/);
  });

  it("ends an unstarted lobby without dealing cards and disarms scheduled start", () => {
    const { db, drafts, draft } = setup();
    db.prepare("update drafts set lobby_auto_start = 1, lobby_start_at = ?, lobby_start_token = 'token' where id = ?")
      .run(now.toISOString(), draft.id);
    drafts.endNow(draft.id, now);
    expect(drafts.picks(draft.id)).toEqual([]);
    expect(db.prepare("select status, lobby_auto_start, lobby_start_at, lobby_start_token from drafts where id = ?").get(draft.id))
      .toEqual({ status: "completed", lobby_auto_start: 0, lobby_start_at: null, lobby_start_token: null });
    expect(() => drafts.start(draft.id)).toThrow();
  });

  it.each(["booster", "theme"] as const)("ends %s during Extra rounds", mode => {
    const ctx = setup(mode);
    ctx.drafts.start(ctx.draft.id, now);
    while (ctx.drafts.findById(ctx.draft.id).currentPackRound <= (mode === "theme" ? 2 : 1)) {
      for (const player of ctx.players) ctx.pick(player);
    }
    ctx.pick();
    const before = ctx.drafts.picks(ctx.draft.id);
    ctx.drafts.endNow(ctx.draft.id);
    expect(ctx.drafts.picks(ctx.draft.id)).toEqual(before);
    expect(ctx.drafts.pool(ctx.draft.id, ctx.players[0])).toHaveLength(3);
    expect(ctx.drafts.pool(ctx.draft.id, ctx.players[1])).toHaveLength(2);
  });

  it.each(["pending", "active"])("cancels %s and discards picks and deal data, retaining a tombstone and roster", status => {
    const { db, drafts, draft, pick } = setup();
    if (status === "active") { drafts.start(draft.id, now); pick(); }
    expect(drafts.cancel(draft.id)).toMatchObject({ status: "cancelled", pickDeadlineAt: null });
    const ended = db.prepare("select ended_at from drafts where id = ?").get(draft.id);
    expect(drafts.cancel(draft.id).status).toBe("cancelled");
    expect(db.prepare("select ended_at from drafts where id = ?").get(draft.id)).toEqual(ended);
    expect(drafts.players(draft.id)).toHaveLength(2);
    for (const table of ["draft_picks", "draft_cards", "draft_packs", "draft_undealt", "draft_deal", "draft_passes", "saved_decks"]) {
      expect(db.prepare(`select count(*) as n from ${table} where draft_id = ?`).get(draft.id)).toEqual({ n: 0 });
    }
    expect(() => drafts.endNow(draft.id)).toThrow(/finished/);
    expect(() => drafts.exportYdk(draft.id, 1)).toThrow(/not complete/);
  });

  it.each(["end", "cancel"])("uses an immediate write transaction for %s", action => {
    const statements: string[] = [];
    const { drafts, draft } = setup("booster", sql => statements.push(String(sql)));
    statements.length = 0;
    if (action === "end") drafts.endNow(draft.id); else drafts.cancel(draft.id);
    expect(statements.find(sql => sql.startsWith("BEGIN"))).toBe("BEGIN IMMEDIATE");
  });

  it.each(["end", "cancel"])("rolls back all state when %s fails mid-transition", action => {
    const { db, drafts, draft, pick } = setup();
    drafts.start(draft.id, now); pick();
    const before = drafts.findById(draft.id);
    const picks = drafts.picks(draft.id);
    db.exec(`create trigger fail_terminal before update of lobby_revision on drafts begin select raise(abort, 'injected failure'); end`);
    expect(() => action === "end" ? drafts.endNow(draft.id) : drafts.cancel(draft.id)).toThrow("injected failure");
    expect(drafts.findById(draft.id)).toEqual(before);
    expect(drafts.picks(draft.id)).toEqual(picks);
    expect(db.prepare("select count(*) as n from saved_decks").get()).toEqual({ n: 0 });
  });

  it("supports tournament creation after end and preserves a linked tournament on retries", () => {
    const { db, drafts, draft, host, pick } = setup();
    drafts.start(draft.id, now); pick(); drafts.endNow(draft.id);
    const tournament = createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, createdByUserId: host.userId, format: "round_robin",
    });
    expect(drafts.endNow(draft.id).tournamentId).toBe(tournament.tournamentId);
    expect(() => drafts.cancel(draft.id)).toThrow(/finished/);
    expect(db.prepare("select status from tournaments where id = ?").get(tournament.tournamentId)).toEqual({ status: "pending" });
  });

  it("does not allow a cancelled draft to create tournament participation or season awards", () => {
    const { db, drafts, draft, host } = setup();
    drafts.start(draft.id, now); drafts.cancel(draft.id);
    expect(() => createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, createdByUserId: host.userId, format: "round_robin",
    })).toThrow(/completed/);
    expect(db.prepare("select count(*) as n from tournament_participants").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from point_awards").get()).toEqual({ n: 0 });
    expect(drafts.listByStatus("g", ["completed"])).toEqual([]);
  });

  it("protects a legacy linked live draft from cancellation", () => {
    const { db, drafts, draft, host } = setup();
    const result = db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id) values ('g','Legacy','round_robin','pending',?)").run(host.userId);
    db.prepare("update drafts set tournament_id = ? where id = ?").run(result.lastInsertRowid, draft.id);
    expect(() => drafts.cancel(draft.id)).toThrow(/linked tournament/);
    expect(drafts.findById(draft.id).status).toBe("pending");
    expect(db.prepare("select status from tournaments where id = ?").get(result.lastInsertRowid)).toEqual({ status: "pending" });
  });

  it.each(["end", "cancel"])("rejects manual and bot picks and ignores expiry after %s", action => {
    const { drafts, draft, players } = setup();
    drafts.start(draft.id, now);
    const card = drafts.pickOptions(draft.id, players[0])[0].id;
    if (action === "end") drafts.endNow(draft.id); else drafts.cancel(draft.id);
    for (const method of ["manual", "auto"] as const) expect(() => drafts.pickCard(draft.id, players[0], card, method)).toThrow(/active/);
    expect(drafts.expireCurrentPickStep(draft.id, new Date("2031-01-01"))).toEqual({ autoPickedPlayerIds: [] });
    expect(drafts.listActive()).toEqual([]);
    expect(drafts.picks(draft.id)).toEqual([]);
  });
});
