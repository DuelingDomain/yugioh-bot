import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: async () => ({ ok: true }) }));

beforeAll(() => {
  state.db = new Database(":memory:");
  migrate(state.db);
  const insert = state.db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at) VALUES(?,?,?,?,?,?,?,?,'image','small','[]',CURRENT_TIMESTAMP)`);
  insert.run(46986414, "Dark Magician", "Spellcaster / Normal Monster", "normal", "The ultimate wizard.", "DARK", 7, "Dark Magician");
  insert.run(7084129, "Magician's Rod", "Spellcaster / Effect Monster", "effect", 'Add a card that mentions "Dark Magician".', "DARK", 3, "Dark Magician");
  insert.run(97268402, "Effect Veiler", "Spellcaster / Tuner Effect Monster", "effect", "Negate the effects of a monster.", "LIGHT", 1, null);
  importCardEffectArtifact(state.db);
});
afterAll(() => state.db?.close());
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DISCORD_GUILD_ID", "configured-community");
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("DUEL_DATA_DIR", "/tmp/yugioh-no-insight-engine");
  state.auth.mockReset();
  state.auth.mockResolvedValue({ user: { id: "123", name: "Yugi" } });
});
afterEach(() => vi.unstubAllEnvs());

async function request(body: unknown, headers?: HeadersInit) {
  const { POST } = await import("../app/api/cards/insights/route");
  return POST(new Request("http://local/api/cards/insights", { method: "POST", body: JSON.stringify(body), headers }));
}

describe("authenticated public-catalog insight operations", () => {
  it("returns real imported summaries, reads and effect results with the capability and credit", async () => {
    const summary = await request({ op: "summary", passcode: 7084129 });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ effectSearchEnabled: true, attribution: "Effect search powered by searchygo", summary: { passcode: 7084129, roles: ["searcher", "recursion"] } });
    const read = await request({ op: "read", text: "hand traps" });
    expect(await read.json()).toMatchObject({ reading: { chips: expect.arrayContaining(["Role: hand trap"]) } });
    const effects = await request({ op: "effectSearch", text: "hand traps", pool: [97268402] });
    expect(await effects.json()).toMatchObject({ total: 1, cards: [{ passcode: 97268402 }] });
  });

  it("uses real service ranking, health and draft scoring with explicit pools", async () => {
    const partners = await request({ op: "worksWith", passcode: 46986414, pool: [7084129] });
    expect(await partners.json()).toMatchObject({ cards: [{ passcode: 7084129, linkedCards: 1 }] });
    const suggest = await request({ op: "suggest", deck: { main: [46986414], extra: [], side: [], deckMaster: 46986414 }, pool: [7084129], format: "domain" });
    expect(await suggest.json()).toMatchObject({ cards: [{ passcode: 7084129, deckMasterFit: true }] });
    const empty = await request({ op: "suggest", deck: [46986414], pool: [], format: "normal" });
    expect(await empty.json()).toMatchObject({ cards: [] });
    const health = await request({ op: "poolHealth", cards: [7084129] });
    expect(await health.json()).toMatchObject({ health: { roles: { searchers: 1 } } });
    const score = await request({ op: "pickScore", candidate: 7084129, pickedPool: [46986414] });
    expect((await score.json()).score).toBeGreaterThan(0);
  });

  it("accepts date and cube era controls and rejects malformed controls", async () => {
    const found = await request({ op: "effectSearch", text: "hand traps before 2015", pool: [97268402], released: { from: "2010-01", to: "2014-12" }, sort: "newest", era: { medianYear: 2010, spread: 2 } });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ total: 1, cards: [{ passcode: 97268402, release: { date: "2010-08", upcoming: false } }] });
    const health = await request({ op: "poolHealth", cards: [46986414, 7084129], era: { medianYear: 2002, spread: 1 } });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ health: { era: { medianYear: 2002, spread: 1 }, warnings: expect.arrayContaining(["1 card is much newer than the rest of this cube."]) } });
    for (const control of [{ released: { from: "2010-13" } }, { released: { from: "2015-01", to: "2002-01" } }, { released: { region: "any" } }, { released: { day: "2010-01-01" } }, { sort: "random" }, { era: { medianYear: "2002", spread: 1 } }, { era: { medianYear: 2002, spread: -1 } }]) {
      expect((await request({ op: "effectSearch", text: "hand traps", ...control })).status).toBe(400);
    }
  });

  it("passes the browser works-with era through to real ranking", async () => {
    const { POST } = await import("../app/api/cards/insights/route");
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      POST(new Request("http://local/api/cards/insights", init)));
    try {
      const { fetchWorksWith } = await import("../src/components/decks/insights-api");
      const era = { medianYear: 2016, spread: 1 };
      const options = { mode: "normal" as const, genesys: false, pool: [7084129], era };
      const expected = await request({ op: "worksWith", passcode: 46986414, pool: [7084129], format: "normal", era });
      const result = await fetchWorksWith(46986414, options);
      expect(result).toEqual((await expected.json()).cards);
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ era });
    } finally { fetch.mockRestore(); }
  });

  it("authenticates before processing and handles session outages", async () => {
    state.auth.mockResolvedValue(null);
    expect((await request({ op: "summary", passcode: 7084129 })).status).toBe(401);
    state.auth.mockRejectedValue(new Error("identity unavailable"));
    await expect(request({ op: "summary", passcode: 7084129 })).rejects.toThrow("identity unavailable");
  });

  it("requires the server's configured community and rejects client authority and private references", async () => {
    for (const body of [
      { op: "worksWith", passcode: 46986414, guildId: "foreign-community" },
      { op: "worksWith", passcode: 46986414, cubeId: 1 },
      { op: "worksWith", passcode: 46986414, draftSlug: "private-draft" },
    ]) expect((await request(body)).status).toBe(400);
    vi.stubEnv("DISCORD_GUILD_ID", "");
    vi.resetModules();
    expect((await request({ op: "summary", passcode: 7084129 })).status).toBe(503);
  });

  it("returns no insights when explicitly disabled or when production has no opt-in", async () => {
    vi.stubEnv("EFFECT_SEARCH", "0");
    const disabled = await request({ op: "summary", passcode: 7084129 });
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toEqual({ effectSearchEnabled: false, error: "effect_search_disabled" });
    vi.stubEnv("EFFECT_SEARCH", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect((await request({ op: "summary", passcode: 7084129 })).status).toBe(404);
  });

  it("rejects malformed operation fields and caps streaming bodies", async () => {
    for (const body of [null, [], {}, { op: "unknown" },
      { op: "summary", passcode: "7084129" }, { op: "summary", passcode: -1 }, { op: "summary", passcode: 0x100000000 },
      { op: "effectSearch", text: "hand traps", pool: [97268402, "7084129"] },
      { op: "effectSearch", text: "hand traps", pool: Array(5001).fill(97268402) },
      { op: "effectSearch", text: "hand traps", exact: "true" },
      { op: "worksWith", passcode: 46986414, limit: 121 },
      { op: "worksWith", passcode: 46986414, format: "invented" },
      { op: "suggest", deck: { main: [46986414], extra: [] } },
      { op: "suggest", deck: [NaN] }, { op: "pickScore", candidate: 7084129, pickedPool: [0] },
      { op: "poolHealth", cards: Array(501).fill(7084129) },
      { op: "effectSearch", text: "hand traps", genesysRemaining: -1 },
    ]) expect((await request(body)).status).toBe(400);
    const oversized = await request({ op: "read", text: "x".repeat(70_000) });
    expect(oversized.status).toBe(413);
    const { POST } = await import("../app/api/cards/insights/route");
    expect((await POST(new Request("http://local/api/cards/insights", { method: "POST", body: "{broken" }))).status).toBe(400);
  });

  it("rejects prototype property names as operation discriminants", async () => {
    for (const op of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      const result = await request({ op, text: "hand traps" });
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({ error: "Invalid insight request" });
    }
  });

  it("caps suggestion decks at 100 while health and picked pools still allow 500", async () => {
    expect((await request({ op: "suggest", deck: Array(100).fill(46986414), pool: [] })).status).toBe(200);
    expect((await request({ op: "suggest", deck: Array(101).fill(46986414), pool: [] })).status).toBe(400);
    expect((await request({ op: "suggest", deck: { main: Array(70).fill(46986414), extra: Array(16).fill(46986414), side: Array(15).fill(46986414) }, pool: [] })).status).toBe(400);
    expect((await request({ op: "poolHealth", cards: Array(500).fill(46986414) })).status).toBe(200);
    expect((await request({ op: "pickScore", candidate: 7084129, pickedPool: Array(500).fill(46986414) })).status).toBe(200);
  });
});
