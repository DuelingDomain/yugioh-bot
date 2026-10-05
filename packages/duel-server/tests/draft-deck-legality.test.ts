import { createHmac } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { normalizeDuelSettings, type DuelDeck } from "@yugidraft/shared/duels";
import { createDraftTournamentService, createDuelSeriesService, createDuelService, createTournamentService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";

const SECRET = "draft-copy-test";
const resources: Array<{ dir: string; db: Database.Database; host: DuelHost }> = [];
afterEach(async () => {
  for (const { dir, db, host } of resources.splice(0)) {
    await host.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(forced = 1, copyLimit = true) {
  const dir = mkdtempSync(join(tmpdir(), "draft-deck-legality-"));
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec(`
    create table datas (id integer primary key, ot integer, alias integer, setcode integer,
      type integer, atk integer, def integer, level integer, race integer, attribute integer, category integer);
    create table texts (id integer primary key, name text, desc text);
    insert into datas values (1, 3, 0, 0, 17, 1000, 1000, 4, 1, 1, 0),
      (2, 3, 1, 0, 17, 1000, 1000, 4, 1, 1, 0),
      (3, 3, 1, 0, 17, 1000, 1000, 4, 1, 1, 0),
      (4, 3, 0, 0, 17, 1000, 1000, 4, 1, 1, 0);
    insert into texts values (1, 'Card', ''), (2, 'Card', ''), (3, 'Another card', ''), (4, 'Filler', '');
  `);
  cdb.close();
  mkdirSync(join(dir, "scripts"));
  for (const code of [1, 2, 3, 4]) writeFileSync(join(dir, "scripts", `c${code}.lua`), "-- test");
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test" }));
  writeFileSync(join(dir, "strings.conf"), "");
  const db = new Database(":memory:");
  migrate(db);
  db.exec(`
    insert into players (id, guild_id, discord_user_id, display_name) values (1, 'g', 'a', 'A'), (2, 'g', 'b', 'B');
    insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
      values (1, 'Card', 'Normal Monster', 'normal', '', '', '[]', 't'),
      (2, 'Card', 'Normal Monster', 'normal', '', '', '[]', 't'),
      (3, 'Another card', 'Normal Monster', 'normal', '', '', '[]', 't'),
      (4, 'Filler', 'Normal Monster', 'normal', '', '', '[]', 't');
    insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json)
      values (1, 'g', 'c', 'Draft', 'completed', 'a', '{}');
    insert into draft_players (draft_id, player_id) values (1, 1);
  `);
  db.prepare("update drafts set config_json = ?").run(JSON.stringify({ copyLimit }));
  for (let index = 0; index < 5; index++) {
    const card = db.prepare("insert into draft_cards (draft_id, wave_number, catalog_card_id, picked_by_player_id) values (1, 1, ?, 1)")
      .run(index < 3 ? 1 : 2);
    db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, forced, picked_at) values (1, 1, ?, 1, ?, ?, 't')")
      .run(card.lastInsertRowid, index + 1, index >= 3 && index < 3 + forced ? 1 : 0);
  }
  const host = createDuelHost({ db, dataDirectory: dir, secret: SECRET, searchCards: () => [], pollIntervalMs: 3600000, openingRps: true });
  resources.push({ dir, db, host });
  const settings = normalizeDuelSettings("normal", { validateDeck: false, startingHand: 1, banlist: "none" });
  async function post(body: Record<string, unknown>, playerId = 1) {
    const raw = JSON.stringify({ guildId: "g", playerId, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") },
    }));
    return { status: response.status, body: await response.json() };
  }
  const check = (deck: DuelDeck, context: Record<string, unknown> = { draftId: 1 }, playerId = 1) =>
    post({ op: "check-deck", mode: "normal", settings, deck, ...context }, playerId);
  return { db, check, post };
}

const four = { main: [1, 1, 1, 2], extra: [], side: [] };
describe("draft deck host validation", () => {
  it("uses forced limits for a tournament lobby and rechecks them before game start", async () => {
    const app = fixture();
    app.db.prepare("insert into draft_players (draft_id, player_id) values (1, 2)").run();
    for (const [player, codes] of [[1, [4]], [2, [1, 1, 1, 2, 4]]] as const) {
      for (const [index, code] of codes.entries()) {
        const card = app.db.prepare("insert into draft_cards (draft_id, wave_number, catalog_card_id, picked_by_player_id) values (1, 1, ?, ?)").run(code, player);
        app.db.prepare("insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, forced, picked_at) values (1, ?, ?, 1, ?, ?, 't')")
          .run(player, card.lastInsertRowid, index + 10, player === 2 && index === 3 ? 1 : 0);
      }
    }
    const { tournamentId } = createDraftTournamentService(app.db).createTournamentFromDraft({
      draftId: 1, format: "round_robin", createdByUserId: "a",
    });
    createTournamentService(app.db).start(tournamentId);
    const slot = app.db.prepare("select id from tournament_matches where tournament_id = ? and player_two_id is not null").get(tournamentId) as { id: number };
    const { duel } = createDuelSeriesService(app.db).startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: 1 });
    const deck = { ...four, main: [...four.main, 4] };
    expect((await app.post({ op: "validate-deck", slug: duel.slug, deck })).body.issues).toEqual([]);
    expect((await app.post({ op: "validate-deck", slug: duel.slug, deck: { ...deck, side: [2] } })).body.issues)
      .toEqual([expect.objectContaining({ message: expect.stringMatching(/4.*draft/i) })]);
    const duels = createDuelService(app.db);
    duels.markReady(duel.slug, "g", 1);
    duels.markReady(duel.slug, "g", 2);
    // Stored registered decks are checked again at Start, before an engine worker can start.
    app.db.prepare("update duel_seats set deck_json = ? where duel_id = ? and player_id = 1")
      .run(JSON.stringify({ ...deck, side: [2] }), duel.id);
    expect((await app.post({ op: "start", slug: duel.slug })).status).toBe(400);
    app.db.prepare("update duel_seats set deck_json = ? where duel_id = ? and player_id = 1")
      .run(JSON.stringify(deck), duel.id);
    expect((await app.post({ op: "start", slug: duel.slug })).status).toBe(200);
    expect(duels.openingState(duel.slug, "g")).not.toBeNull();
  });

  it("still rejects a main-deck card placed in Extra with a forced allowance", async () => {
    const app = fixture();
    const result = await app.check({ main: [1, 1, 1], extra: [2], side: [] });
    expect(result.body.report.issues.length).toBeGreaterThan(0);
    expect(result.body.report.issues).toEqual([expect.objectContaining({ message: "Card belongs in the Main Deck" })]);
  });

  it("accepts a forced fourth artwork copy and rejects a fifth without a second forced pick", async () => {
    const app = fixture();
    expect((await app.check(four)).body.report.issues).toEqual([]);
    const result = await app.check({ ...four, side: [2] });
    expect(result.status).toBe(200);
    expect(result.body.report.issues).toEqual([expect.objectContaining({ message: expect.stringMatching(/4.*draft/i) })]);
  });
  it("accepts a fifth copy with two forced picks", async () => {
    const app = fixture(2);
    expect((await app.check({ ...four, side: [2] })).body.report.issues).toEqual([]);
  });
  it("keeps normal fourth picks capped when the pick limit is OFF", async () => {
    const app = fixture(0, false);
    expect((await app.check(four)).body.report.issues).toEqual([expect.objectContaining({ message: expect.stringMatching(/3.*draft/i) })]);
  });
  it("does not apply a forced allowance to a different-named alias", async () => {
    const app = fixture();
    expect((await app.check({ ...four, side: [3] })).body.report.issues).toEqual([expect.objectContaining({ message: expect.stringMatching(/0.*draft/i) })]);
  });
  it("keeps the standard limit outside a draft, with the same forced picks in storage", async () => {
    const app = fixture();
    const deck = { ...four, main: [...four.main, ...Array(36).fill(4)] };
    const result = await app.check(deck, { settings: normalizeDuelSettings("normal", { banlist: "none" }) });
    expect(result.body.report.issues.some((issue: { message: string }) => /more than 3.*Card/i.test(issue.message))).toBe(true);
  });
  it("refuses another player's draft context", async () => {
    const app = fixture();
    expect((await app.check(four, { draftId: 1 }, 2)).status).toBeGreaterThanOrEqual(400);
  });
});
