import Database from "better-sqlite3";
import { rmSync, writeFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelEngineView, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { createDuelSeriesService, createDuelService, createTournamentDuelService, createTournamentService, publishGenesysPointsSnapshot } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { GENESYS_ART, GENESYS_LINK, GENESYS_MASTER, GENESYS_PENDULUM, genesysDeck, genesysFixture, seedGenesysPoints } from "./helpers/genesys-fixture.js";

const SECRET = "genesys-admission-test";
const cleanups: Array<{ host: DuelHost; db: Database.Database; directory: string }> = [];
afterEach(async () => {
  for (const { host, db, directory } of cleanups.splice(0)) {
    await host.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

function room(mode: DuelMode, format: DuelFormat, pointCap = 100, passcodeRemaps?: Record<number, number>, createWorker?: () => DuelGameWorker) {
  const fixture = genesysFixture();
  if (createWorker) {
    // Only the resource identity reader opens these; the injected worker never loads a core.
    for (const file of ["ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.domain.legacy.wasm"]) {
      writeFileSync(join(fixture.directory, file), "fixture");
    }
    for (const file of ["domain.lua", "domain.legacy.lua"]) writeFileSync(join(fixture.directory, "card-scripts", file), "-- fixture");
  }
  if (passcodeRemaps) {
    const artifact = JSON.stringify({ version: 1, remaps: passcodeRemaps });
    writeFileSync(join(fixture.directory, "card-remaps.json"), artifact);
    writeFileSync(join(fixture.directory, "manifest.json"), JSON.stringify({ bundleVersion: "genesys-test",
      integrity: { cardRemaps: createHash("sha256").update(artifact).digest("hex") } }));
  }
  const db = new Database(":memory:");
  migrate(db);
  seedGenesysPoints(db, fixture);
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) => {
    const user = seedUser(db, `genesys-${seat}`);
    return seedIdentity(db, { guildId: "g", name: `P${seat}`, userId: user.userId, discordUserId: user.discordUserId }).playerId;
  });
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Genesys", mode, format,
    settings: { genesys: { pointCap }, validateDeck: false } });
  players.slice(1).forEach(player => duels.takeSeat(session.slug, "g", player));
  const host = createDuelHost({ db, dataDirectory: fixture.directory, secret: SECRET, searchCards: () => [],
    pollIntervalMs: 60_000, createWorker: createWorker ?? (() => { throw new Error("No engine should start"); }) });
  cleanups.push({ host, db, directory: fixture.directory });
  async function post(body: Record<string, unknown>, playerId = players[0]!) {
    const raw = JSON.stringify({ slug: session.slug, guildId: "g", playerId, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST",
      headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") }, body: raw }));
    return { status: response.status, data: await response.json() as Record<string, any> };
  }
  const points = (code: number, value: number | null, revision = "tcg-2026-10-05") => {
    db.prepare("update card_catalog set genesys_points = ?, genesys_revision = ? where ygoprodeck_id = ?").run(value, revision, code);
  };
  return { db, duels, session, players, post, points, fixture };
}

async function matchRoom(mode: DuelMode, kind: "challenge" | "tournament") {
  const workers: Array<DuelGameWorker & { result: DuelEngineView["result"] }> = [];
  const t = room(mode, "1v1", 100, undefined, () => {
    const worker = {
      running: true, result: null as DuelEngineView["result"],
      async create() {}, async answer() {}, async search() { return []; },
      async close() { this.running = false; },
      async view(): Promise<DuelEngineView> {
        return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", prompt: null, chain: [], events: [], log: [], result: this.result,
          seats: [0, 1].map(seat => ({ seat, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })) };
      },
    };
    workers.push(worker);
    return worker;
  });
  const series = createDuelSeriesService(t.db);
  const deck = { ...genesysDeck(mode), side: mode === "normal" ? [1041] : [] };
  let started;
  if (kind === "tournament") {
    const tournaments = createTournamentService(t.db);
    const registrations = createTournamentDuelService(t.db);
    const tournament = tournaments.create("g", "Genesys cup", "single_elim", seedUser(t.db, "organizer").userId,
      { bestOf: 3, duelRules: { mode, settings: t.session.settings } });
    for (const playerId of t.players) {
      tournaments.join(tournament.id, playerId);
      expect((await t.post({ op: "check-deck", mode, deck, settings: t.session.settings }, playerId)).data.report.issues).toEqual([]);
      registrations.registerDeck({ tournamentId: tournament.id, playerId, savedDeckId: null, deck });
    }
    tournaments.start(tournament.id);
    const slot = t.db.prepare("select id from tournament_matches where tournament_id = ?").get(tournament.id) as { id: number };
    started = series.startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: t.players[0]! });
    for (const playerId of t.players) expect((await t.post({ op: "ready", slug: started.duel.slug }, playerId)).status).toBe(200);
  } else {
    started = series.createChallenge({ guildId: "g", challengerPlayerId: t.players[0]!, opponentPlayerId: t.players[1]!,
      bestOf: 3, ranked: false, mode, settings: t.session.settings });
    for (const playerId of t.players) expect((await t.post({ op: "deck", slug: started.duel.slug, deck }, playerId)).status).toBe(200);
  }
  expect(t.duels.get(started.duel.slug, "g").status).toBe("active");
  workers[0]!.result = { winnerSeat: 0, reason: "test" };
  expect((await t.post({ op: "view", slug: started.duel.slug })).data.session.status).toBe("completed");
  const publish = (points: number | null) => publishGenesysPointsSnapshot(t.db, {
    revision: "new-list", effectiveDate: "2027-01-01",
    cards: t.fixture.cards.filter(card => points !== null || card.id !== 1001).map(card => ({
      id: card.id, name: card.name, points: card.id === 1001 ? points! : 0, artworkIds: [card.id],
    })),
  }, { cacheCards: () => {}, canonicalId: code => code });
  return { ...t, series, started, deck, workers, publish };
}

const variants = (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "tag", "ffa3", "ffa4"] as const).map(format => ({ mode, format })));

describe("host Genesys admission", () => {
  it.each(variants)("checks $mode $format decks through check-deck, validate-deck and writes", async ({ mode, format }) => {
    const t = room(mode, format);
    const deck = genesysDeck(mode);
    t.points(1001, 101);
    const checked = await t.post({ op: "check-deck", deck, mode, format, settings: t.session.settings });
    expect(checked.status).toBe(200);
    expect(checked.data.report.issues[0].message).toMatch(/101.*points; the cap is 100/);
    // Session checks must ignore attempts to raise the cap or disable Genesys in the request body.
    const validated = await t.post({ op: "validate-deck", deck, settings: { genesys: null } });
    expect(validated.data.issues).toEqual(checked.data.report.issues);
    const refused = await t.post({ op: "deck", deck, settings: { genesys: { pointCap: 1000 } } });
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/101.*points; the cap is 100/);
    expect(t.duels.room(t.session.slug, "g", t.players[0]!).myDeck).toBeNull();
    t.points(1001, 100);
    expect((await t.post({ op: "deck", deck })).status).toBe(200);
  });

  it.each(["tag", "ffa3", "ffa4"] as const)("does not combine players' points at %s", async format => {
    const t = room("normal", format);
    t.points(1001, 100);
    for (const playerId of t.players.slice(0, -1)) {
      expect((await t.post({ op: "deck", deck: genesysDeck("normal") }, playerId)).status).toBe(200);
    }
    expect(t.duels.get(t.session.slug, "g").seats.filter(seat => seat.ready)).toHaveLength(t.players.length - 1);
  });

  it("fails closed on null/stale/missing points and observes subsequent list updates", async () => {
    const t = room("domain", "1v1");
    const deck = genesysDeck("domain");
    for (const [value, revision] of [[null, "tcg-2026-10-05"], [0, "old-list"]] as const) {
      t.points(GENESYS_MASTER, value, revision);
      expect((await t.post({ op: "deck", deck })).data.error).toMatch(/Genesys points are unknown/);
    }
    t.points(GENESYS_MASTER, 0);
    expect((await t.post({ op: "validate-deck", deck })).data.issues).toEqual([]);
    t.db.prepare("update genesys_points_meta set revision = 'new-list'").run();
    expect((await t.post({ op: "deck", deck })).data.error).toMatch(/Genesys points are unknown/);
    t.db.prepare("delete from genesys_points_meta").run();
    expect((await t.post({ op: "deck", deck })).data.error).toMatch(/Genesys points are unknown/);
  });

  it("counts canonical artwork points and the Domain Master", async () => {
    const t = room("domain", "1v1");
    const deck = genesysDeck("domain");
    deck.deckMaster = GENESYS_ART;
    t.points(1001, 100);
    t.points(GENESYS_MASTER, 1);
    t.points(GENESYS_ART, 0);
    expect((await t.post({ op: "deck", deck })).data.error).toMatch(/101.*points; the cap is 100/);
  });

  it("bridges current points when an imported catalog ID resolves to an engine ID by name", async () => {
    const t = room("domain", "1v1");
    // A newly released card can have a different API passcode than the installed engine.
    t.db.prepare("update card_catalog set ygoprodeck_id = 9999, genesys_points = 20 where ygoprodeck_id = ?").run(GENESYS_MASTER);
    const deck = { ...genesysDeck("domain"), deckMaster: 9999 };
    t.points(1001, 80);
    const checked = await t.post({ op: "check-deck", mode: "domain", deck, settings: t.session.settings });
    expect(checked.data.deck.deckMaster).toBe(GENESYS_MASTER);
    expect(checked.data.report.issues).toEqual([]);
    t.points(1001, 81);
    expect((await t.post({ op: "deck", deck })).data.error).toMatch(/101.*points; the cap is 100/);
    // Persisted normalized passcodes must retain the same points on later checks.
    expect((await t.post({ op: "validate-deck", deck: genesysDeck("domain") })).data.issues[0].message)
      .toMatch(/101.*points; the cap is 100/);
  });

  it("does not use an artwork's points to fill in unknown canonical points", async () => {
    const t = room("domain", "1v1");
    t.points(GENESYS_MASTER, null);
    t.points(GENESYS_ART, 0);
    const deck = { ...genesysDeck("domain"), deckMaster: GENESYS_ART };
    expect((await t.post({ op: "deck", deck })).data.error).toMatch(/Genesys points are unknown/);
  });

  it("preserves unknown canonical points when an old passcode remaps to it", async () => {
    const t = room("domain", "1v1", 100, { 9999: GENESYS_MASTER });
    t.db.prepare(`insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small,
      card_sets_json, cached_at, genesys_points, genesys_revision)
      select 9999, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at, 0, genesys_revision
      from card_catalog where ygoprodeck_id = ?`).run(GENESYS_MASTER);
    t.points(GENESYS_MASTER, null);
    expect((await t.post({ op: "deck", deck: genesysDeck("domain") })).data.error).toMatch(/Genesys points are unknown/);
  });

  it.each([GENESYS_LINK, GENESYS_PENDULUM])("rejects forbidden Master %s with competitive validation disabled", async deckMaster => {
    const t = room("domain", "1v1");
    const result = await t.post({ op: "deck", deck: { ...genesysDeck("domain"), deckMaster } });
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/Genesys.*Link or Pendulum/);
  });

  it("rechecks a previously stored deck before starting", async () => {
    const t = room("normal", "1v1");
    for (const player of t.players) t.duels.setDeck(t.session.slug, "g", player, genesysDeck("normal"));
    t.points(1001, 101);
    const started = await t.post({ op: "start" });
    expect(started.status).toBe(400);
    expect(started.data.error).toMatch(/101.*points; the cap is 100/);
    expect(t.duels.get(t.session.slug, "g").status).toBe("lobby");
  });

  it.each((["normal", "domain"] as const).flatMap(mode =>
    (["challenge", "tournament"] as const).flatMap(kind => [101, null].map(points => ({ mode, kind, points })))))(
    "starts game 2 of a $mode $kind after points become $points in a new revision", async ({ mode, kind, points }) => {
      const t = await matchRoom(mode, kind);
      if (points === null) {
        // Keep the source count stable while replacing a card, as a new list can do.
        t.fixture.cards.push({ id: 2001, name: "New card", type: 17 });
      }
      t.publish(points);
      const next = t.series.createNextGame(t.started.series.id, "g");
      const response = await t.post({ op: "start", slug: next.slug });
      expect(response.status).toBe(200);
      expect(response.data.session).toMatchObject({ status: "active", gameNumber: 2 });
      expect(t.workers).toHaveLength(2);
    });

  it("allows side swaps after a list update but checks new card identities and copies", async () => {
    const t = await matchRoom("normal", "challenge");
    t.publish(101);
    const sided = { ...t.deck, main: [1041, ...t.deck.main.slice(1)], side: [1001] };
    expect((await t.post({ op: "series-side", slug: t.started.duel.slug, deck: sided })).status).toBe(200);
    for (const changed of [
      { ...sided, side: [1001, 1001] },
      { ...sided, main: [1042, ...sided.main.slice(1)] },
      { ...sided, deckMaster: GENESYS_MASTER },
    ]) {
      const checked = await t.post({ op: "series-side", slug: t.started.duel.slug, deck: changed });
      expect(checked.status).toBe(400);
      expect(checked.data.error).toMatch(/Genesys points/);
    }
    const next = t.series.createNextGame(t.started.series.id, "g");
    expect((await t.post({ op: "start", slug: next.slug })).data.session.status).toBe("active");
  });

  it("returns a player-fixable error for invalid check-deck caps", async () => {
    const t = room("normal", "1v1");
    const result = await t.post({ op: "check-deck", mode: "normal", deck: genesysDeck("normal"),
      settings: { genesys: { pointCap: 1001 } } });
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/pointCap/);
  });
});


describe("Genesys card transport", () => {
  it("returns fresh canonical points through details and paginated queries", async () => {
    const t = room("normal", "1v1");
    t.points(GENESYS_MASTER, 30);
    t.points(GENESYS_ART, 999);
    for (const op of ["card-details", "card-query"]) {
      const body = op === "card-details" ? { codes: [GENESYS_ART] } : { cardQuery: { text: String(GENESYS_ART) } };
      const result = await t.post({ op, ...body });
      expect(result.status).toBe(200);
      expect(result.data.cards[0]).toMatchObject({ code: GENESYS_ART, genesysPoints: 30 });
      t.points(GENESYS_MASTER, 0, "stale");
      expect((await t.post({ op, ...body })).data.cards[0].genesysPoints).toBeNull();
      t.points(GENESYS_MASTER, 30);
    }
  });

  it("filters points and forbidden types before pagination, including exact passcodes", async () => {
    const t = room("normal", "1v1");
    t.points(GENESYS_MASTER, 30);
    t.points(1001, null);
    const result = await t.post({ op: "card-query", cardQuery: {
      genesysPoints: { min: 0, max: 0 }, excludeGenesysForbidden: true, limit: 120,
    } });
    expect(result.data.cards.every((card: any) => card.genesysPoints === 0)).toBe(true);
    expect(result.data.cards.map((card: any) => card.code)).not.toContain(GENESYS_MASTER);
    expect(result.data.cards.map((card: any) => card.code)).not.toContain(1001);
    expect(result.data.cards.map((card: any) => card.code)).not.toContain(GENESYS_LINK);
    const exact = await t.post({ op: "card-query", cardQuery: { text: String(GENESYS_LINK), excludeGenesysForbidden: true } });
    expect(exact.data.cards.map((card: any) => card.code)).not.toContain(GENESYS_LINK);
  });
});
