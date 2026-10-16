import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { createDuelService } from "../../src/services/duels.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { resolveTournamentDuelRules, serializeTournamentDuelRules } from "../../src/services/tournament-duels.js";
import { seedIdentity } from "../helpers/identity.js";

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const deck = { main: [], extra: [], side: [] };

function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

describe("Genesys storage contract", () => {
  it("adds nullable points to a legacy catalog and preserves values on repeated migration", () => {
    const db = new Database(":memory:");
    databases.push(db);
    db.exec(`create table card_catalog (
      ygoprodeck_id integer primary key, name text not null, type text not null, frame_type text not null,
      image_url text not null, image_url_small text not null, card_sets_json text not null, cached_at text not null
    ); insert into card_catalog values (1, 'Old card', 'Effect Monster', 'effect', '', '', '[]', 'old');`);
    migrate(db);
    expect(db.prepare("select genesys_points, genesys_revision from card_catalog").get()).toEqual({ genesys_points: null, genesys_revision: null });
    expect(db.prepare("select * from genesys_points_meta").all()).toEqual([]);
    db.exec(`insert into genesys_points_meta(id, revision, effective_date, source_url, synced_at)
      values(1, 'tcg-2026-10-05', '2026-10-05', 'https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes', '2026-10-15T00:00:00Z');
      update card_catalog set genesys_points = 0, genesys_revision = 'tcg-2026-10-05';`);
    migrate(db);
    migrate(db);
    expect(db.prepare("select genesys_points, genesys_revision, cached_at from card_catalog").get()).toEqual({
      genesys_points: 0, genesys_revision: "tcg-2026-10-05", cached_at: "old",
    });
    expect(db.prepare("select revision from genesys_points_meta").get()).toEqual({ revision: "tcg-2026-10-05" });
    for (const points of [-1, 0.5, "unknown"]) {
      expect(() => db.prepare("update card_catalog set genesys_points = ?").run(points)).toThrow();
    }
  });

  it("exposes nullable points on catalog results and normalizes artwork lookups", () => {
    const db = setup();
    const insert = db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (?, 'Same', 'Effect Monster', 'effect', '', '', '[]', 'old')`);
    insert.run(1); insert.run(2); insert.run(3);
    db.exec(`update card_catalog set genesys_points = 25, genesys_revision = 'test-list' where ygoprodeck_id = 1`);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map([
      [1, { name: "Same", type: 0x21 }], [2, { name: "Same", type: 0x21, alias: 1 }],
    ]) });
    expect(catalog.findByIds([1, 2, 3])).toMatchObject([
      { ygoprodeckId: 1, genesysPoints: 25, genesysRevision: "test-list" },
      { ygoprodeckId: 2, genesysPoints: 25, genesysRevision: "test-list" },
      { ygoprodeckId: 3, genesysPoints: null, genesysRevision: null },
    ]);
  });

  it.each(["normal", "domain"] as const)("saves an advisory Genesys tag on incomplete %s decks", mode => {
    const db = setup();
    const { userId } = seedIdentity(db);
    const decks = createSavedDeckService(db, new Map());
    const saved = decks.create("g", userId, { name: "Genesys", mode, deck, genesys: {} });
    expect(saved.genesys).toEqual({ pointCap: 100 });
    expect(decks.list("g", userId)[0]?.genesys).toEqual({ pointCap: 100 });
    const updated = decks.update(saved.id, "g", userId, { name: "Zero", mode, deck, genesys: { pointCap: 0 } });
    expect(updated.genesys).toEqual({ pointCap: 0 });
    expect(decks.update(saved.id, "g", userId, { name: "Keep", mode, deck }).genesys).toEqual({ pointCap: 0 });
    migrate(db);
    expect(decks.get(saved.id, "g", userId).genesys).toEqual({ pointCap: 0 });
    expect(decks.update(saved.id, "g", userId, { name: "Off", mode, deck, genesys: null }).genesys).toBeNull();
    for (const genesys of [true, { pointCap: -1 }, { pointCap: 1001 }, { pointCap: 0.1 }]) {
      expect(() => decks.update(saved.id, "g", userId, { name: "Invalid", mode, deck, genesys })).toThrow(/genesys/i);
    }
  });

  it("reads legacy saved decks as off and fails closed on corrupt stored tags", () => {
    const db = setup();
    const { userId } = seedIdentity(db);
    const decks = createSavedDeckService(db, new Map());
    const id = Number(db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('g',?,'Old','normal',?)")
      .run(userId, JSON.stringify(deck)).lastInsertRowid);
    expect(decks.get(id, "g", userId).genesys).toBeNull();
    db.prepare("update saved_decks set genesys_json = ? where id = ?").run('{"pointCap":-1}', id);
    expect(() => decks.get(id, "g", userId)).toThrow(/corrupt/);
    db.prepare("update saved_decks set genesys_json = ? where id = ?").run('not-json', id);
    expect(() => decks.get(id, "g", userId)).toThrow(/corrupt/);
  });

  it.each(["normal", "domain"] as const)("persists Genesys on %s duels and duel series", mode => {
    const db = setup();
    const p1 = seedIdentity(db);
    const p2 = seedIdentity(db);
    const duels = createDuelService(db);
    for (const format of ["1v1", "tag", "ffa3", "ffa4"] as const) {
      const created = duels.create({ guildId: "g", organizerPlayerId: p1.playerId, name: "Genesys", mode, format,
        settings: { genesys: { pointCap: 0 }, banlist: "tcg-2026-09" } });
      expect(duels.get(created.slug, "g").settings).toMatchObject({ genesys: { pointCap: 0 }, banlist: "none" });
    }
    const created = createDuelSeriesService(db).createChallenge({ guildId: "g", challengerPlayerId: p1.playerId,
      opponentPlayerId: p2.playerId, mode, bestOf: 3, ranked: false, settings: { genesys: { pointCap: 1000 } } });
    const stored = db.prepare("select settings_json from duel_series where id = ?").get(created.series.id) as { settings_json: string };
    expect(JSON.parse(stored.settings_json)).toMatchObject({ genesys: { pointCap: 1000 }, banlist: "none" });
    expect(duels.get(created.duel.slug, "g").settings.genesys).toEqual({ pointCap: 1000 });
  });

  it.each(["normal", "domain"] as const)("round-trips %s tournament duel rules", mode => {
    const raw = serializeTournamentDuelRules({ mode, settings: { genesys: {}, banlist: "tcg-2026-09" } });
    expect(resolveTournamentDuelRules({ best_of: 3, duel_rules_json: raw, draft_id: null }).settings)
      .toMatchObject({ genesys: { pointCap: 100 }, banlist: "none" });
    expect(resolveTournamentDuelRules({ best_of: 3, duel_rules_json: null, draft_id: null }).settings.genesys).toBeNull();
    expect(resolveTournamentDuelRules({ best_of: 3, duel_rules_json: raw, draft_id: 1 }).settings.genesys).toBeNull();
    expect(() => serializeTournamentDuelRules({ mode, settings: { genesys: { pointCap: 1001 } } })).toThrow(/genesys/i);
  });

  it("does not silently disable Genesys when stored tournament settings are corrupt", () => {
    for (const settings of [{ genesys: { pointCap: -1 } }, { genesys: {}, turnSeconds: -1 }]) {
      expect(() => resolveTournamentDuelRules({ best_of: 3, draft_id: null,
        duel_rules_json: JSON.stringify({ mode: "normal", settings }) })).toThrow(/corrupt/);
    }
  });
});
