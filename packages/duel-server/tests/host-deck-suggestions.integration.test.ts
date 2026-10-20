import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { createCardInsightService, parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardDatabase } from "../src/cards.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";
import { createHmac } from "node:crypto";

const SECRET = "deck-suggestions-signed-integration";
const BLUE = 89631139, SILVER = 87025064, LINK = 990003, PENDULUM = 990004;
const deck = { main: [BLUE, BLUE, BLUE], extra: [], side: [] };
let directory: string, db: Database.Database, host: DuelHost, playerId: number, userId: string;

beforeAll(() => {
  directory = createHostDataFixture([
    { code: BLUE, name: "Blue-Eyes White Dragon", type: 0x11 },
    { code: SILVER, name: "Silver's Cry", type: 0x10002 },
    { code: LINK, name: "Link Master", type: 0x4000021 },
    { code: PENDULUM, name: "Pendulum Master", type: 0x1000021 },
  ]);
  const engine = new Database(join(directory, "cards.cdb"));
  try { engine.prepare("UPDATE datas SET race=?,attribute=?,level=? WHERE id=?").run(0x2000, 0x10, 8, BLUE); }
  finally { engine.close(); }
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  vi.stubEnv("EFFECT_SEARCH", "1"); vi.stubEnv("DECK_SUGGESTIONS", "1"); vi.stubEnv("DUEL_STANDARD_1V1_ENGINE", "pinned");
  db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db);
  ({ playerId, userId } = seedIdentity(db));
  const insert = db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,?,?,?,?,?,?,'fixture','fixture','[]','now')`);
  insert.run(BLUE, "Blue-Eyes White Dragon", "Dragon / Normal Monster", "normal", "A powerful dragon.", "LIGHT", 8, "Blue-Eyes");
  insert.run(SILVER, "Silver's Cry", "Quick-Play Spell Card", "spell", "Target 1 Dragon Normal Monster in your GY; Special Summon that target.", null, null, null);
  for (let n = 0; n < 100; n++) insert.run(500000000 + n, `Unrelated catalog card ${n}`, "Spell Card", "spell", "", null, null, null);
  host = createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [],
    createWorker: vi.fn(() => { throw new Error("Suggestions must not create an engine worker"); }) });
});
afterEach(async () => { await host.close(); db.close(); vi.unstubAllEnvs(); });

function signedHeaders(raw: string, secret: string): Record<string, string> {
  return { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") };
}

async function post(suggestionQuery: unknown, extra: Record<string, unknown> = {}, secret = SECRET) {
  const raw = JSON.stringify({ guildId: "g", playerId, userId, op: "deck-suggestions", suggestionQuery, ...extra });
  const response = await host.handle(new Request("http://local/internal/duel", { method: "POST", body: raw,
    headers: signedHeaders(raw, secret) }));
  return { status: response.status, data: await response.json() as any };
}

describe("signed deterministic deck suggestion computation", () => {
  it("returns exact service rows and the same Outside row without retaining host result entries", async () => {
    const rows = await post({ op: "suggestRows", deck });
    expect(rows.status).toBe(200);
    expect(rows.data.contextVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(rows.data.result.rows[1].cards.map((card: { passcode: number }) => card.passcode)).toEqual([SILVER]);
    const legality = deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] });
    const service = createCardInsightService(db, { dataDirectory: directory });
    expect(rows.data.result).toEqual(service.suggestRows(deck, { format: "normal", legality, cache: false }));
    const outside = await post({ op: "effectSearch", text: "non Blue-Eyes cards that synergize with Blue-Eyes", deck });
    expect(outside.status).toBe(200);
    expect(outside.data.result.cards).toEqual(rows.data.result.rows[1].cards);
    expect(outside.data.result.reading.query.intent).toEqual({ kind: "outside", archetype: "Blue-Eyes" });
    const registry = (globalThis as unknown as Record<symbol, WeakMap<Database.Database, Map<string, string>>>)[Symbol.for("yugidraft.deck-suggestions.caches.v1")];
    expect(registry?.get(db)?.size ?? 0).toBe(0);
    expect((await post({ op: "effectSearch", text: "outside Blue-Eyes", deck, exclude: [SILVER] })).data.result.cards).toEqual([]);
  });

  it("returns a conditional response only for the entire unchanged query and live metadata", async () => {
    const query = { op: "suggestRows", deck };
    const first = await post(query);
    const suggestionVersion = first.data.contextVersion;
    expect((await post({ ...query, format: "normal" }, { suggestionVersion })).data).toEqual({ contextVersion: suggestionVersion, notModified: true });
    const orderedQuery = { ...query, deck: { main: [BLUE, BLUE, SILVER], extra: [LINK, PENDULUM], side: [] }, pool: [BLUE, SILVER] };
    const ordered = await post(orderedQuery);
    expect((await post({ ...orderedQuery, deck: { main: [SILVER, BLUE, BLUE], extra: [PENDULUM, LINK], side: [] }, pool: [SILVER, BLUE] },
      { suggestionVersion: ordered.data.contextVersion })).data).toEqual({ contextVersion: ordered.data.contextVersion, notModified: true });
    for (const change of [{ exclude: [SILVER] }, { pool: [BLUE] }, { genesysRemaining: 0 }, { banlist: "none" },
      { deck: { ...deck, side: [SILVER] } }, { released: { from: "2020-01" } }]) {
      const changed = await post({ ...query, ...change }, { suggestionVersion });
      expect(changed.status).toBe(200); expect(changed.data.contextVersion).not.toBe(suggestionVersion); expect(changed.data).toHaveProperty("result");
    }
    db.prepare("UPDATE card_catalog SET effect_text='Updated printed metadata' WHERE ygoprodeck_id=?").run(SILVER);
    const catalogChanged = await post(query, { suggestionVersion });
    expect(catalogChanged.data.contextVersion).not.toBe(suggestionVersion);
    db.prepare("INSERT INTO genesys_points_meta(id,revision,effective_date,source_url,synced_at) VALUES(1,'new-points','2026-10-01','fixture',CURRENT_TIMESTAMP)").run();
    const pointsChanged = await post(query, { suggestionVersion: catalogChanged.data.contextVersion });
    expect(pointsChanged.data.contextVersion).not.toBe(catalogChanged.data.contextVersion);
  });

  it("invalidates conditional results when operational admission blocks change", async () => {
    const query = { op: "effectSearch", text: "outside Blue-Eyes", deck };
    const first = await post(query);
    expect(first.data.result.cards.map((card: { passcode: number }) => card.passcode)).toEqual([SILVER]);
    db.prepare(`INSERT INTO card_script_auto_blocks
      (code,reason,blocked_at,distinct_duels,error_count,threshold,window_days,bundle_version,script_hash,engine_kind)
      VALUES(?,'fixture block',CURRENT_TIMESTAMP,3,3,3,7,'fixture',?,'pinned-normal')`)
      .run(SILVER, cardScriptHash(loadCardDatabase(directory), SILVER, "pinned-normal"));
    const blocked = await post(query, { suggestionVersion: first.data.contextVersion });
    expect(blocked.status).toBe(200); expect(blocked.data.contextVersion).not.toBe(first.data.contextVersion);
    expect(blocked.data.result.cards).toEqual([]);
  });

  it("rechecks signatures, live guild membership and session assertions before conditional replies", async () => {
    const query = { op: "suggestRows", deck }, first = await post(query);
    expect((await post(query, {}, "wrong-secret")).status).toBe(401);
    for (const actor of [{ guildId: "other" }, { playerId: 999999 }, { userId: `${userId}9` }, { userId: "1" }]) {
      expect((await post(query, { suggestionVersion: first.data.contextVersion, ...actor })).status).toBe(403);
    }
    db.prepare("DELETE FROM players WHERE id=?").run(playerId);
    expect((await post(query, { suggestionVersion: first.data.contextVersion })).status).toBe(403);
  });

  it("requires both runtime flags and validates Domain masters even on conditional requests", async () => {
    const query = { op: "suggestRows", deck }, version = (await post(query)).data.contextVersion;
    vi.stubEnv("EFFECT_SEARCH", "0"); expect((await post(query, { suggestionVersion: version })).status).toBe(404);
    vi.stubEnv("EFFECT_SEARCH", "1"); vi.stubEnv("DECK_SUGGESTIONS", "0"); expect((await post(query)).status).toBe(404);
    vi.stubEnv("DECK_SUGGESTIONS", "1");
    for (const deckMaster of [999999, SILVER]) expect((await post({ ...query, format: "domain", deckMaster })).status).toBe(400);
    for (const deckMaster of [LINK, PENDULUM]) expect((await post({ ...query, format: "genesys-domain", deckMaster })).status).toBe(400);
    const missing = await post({ ...query, format: "domain" });
    expect(missing.status).toBe(200); expect(missing.data.result.rows.every((row: { cards: unknown[] }) => !row.cards.length)).toBe(true);
  });

  it("rejects unsupported authority, cache controls, malformed bounds and non-Outside searches", async () => {
    const query = { op: "suggestRows", deck };
    for (const invalid of [null, { ...query, legality: {} }, { ...query, cache: false }, { ...query, guildId: "g" },
      { ...query, banlist: "invented" }, { ...query, format: "invented" }, { ...query, pool: Array(5001).fill(BLUE) },
      { ...query, deck: { main: Array(101).fill(BLUE), extra: [], side: [] } }, { ...query, exclude: [0] },
      { ...query, released: { from: "2025-01", to: "2024-01" } }, { ...query, omittedChips: [] },
      { op: "effectSearch", text: "hand traps" }, { op: "effectSearch", text: "outside Blue-Eyes", exact: true },
      { op: "effectSearch", text: "outside Blue-Eyes", omittedChips: Array(17).fill("chip") }]) {
      expect((await post(invalid)).status, JSON.stringify(invalid)).toBe(400);
    }
    for (const suggestionVersion of [null, "stale", "g".repeat(64), 123]) expect((await post(query, { suggestionVersion })).status).toBe(400);
    expect(parseDeckSuggestionQuery({ op: "effectSearch", text: " outside Blue-Eyes ", exact: false, sort: "newest", era: { medianYear: 2020, spread: 2 } }))
      .toEqual({ op: "effectSearch", text: "outside Blue-Eyes", format: "normal", sort: "newest", era: { medianYear: 2020, spread: 2 } });
  });
});
