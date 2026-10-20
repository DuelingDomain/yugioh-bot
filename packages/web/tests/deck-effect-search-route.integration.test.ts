import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";
import { createPlayerService, type DeckSuggestionQuery } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../../duel-server/src/host";
import { createHostDataFixture } from "../../duel-server/tests/helpers/host-data-fixture";
import { emptyCardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { queryPoolCards } from "../src/components/decks/pool-search";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), fallback: vi.fn(),
  suggestionRequests: [] as Array<{ userId: string; suggestionQuery: unknown; suggestionVersion?: string }>, suggestionResponses: [] as Array<Record<string, unknown>> }));
vi.mock("@yugidraft/shared/cards/effects/reading-fallback", () => ({ fallbackEffectReading: state.fallback }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: async () => ({ ok: true }) }));
let directory: string, host: DuelHost;
beforeAll(() => {
  state.db = new Database(":memory:");migrate(state.db);importCardEffectArtifact(state.db);
  state.db.prepare("INSERT INTO players(guild_id,discord_user_id,display_name) VALUES('configured-community','123','Yugi')").run();
  state.db.prepare("INSERT INTO players(guild_id,discord_user_id,display_name) VALUES('configured-community','124','Joey')").run();
  directory = createHostDataFixture([
    {code:14558127,name:"Ash Blossom & Joyous Spring",type:0x21},
    {code:97268402,name:"Effect Veiler",type:0x21},
    {code:89631139,name:"Blue-Eyes White Dragon",type:0x11},
    {code:87025064,name:"Silver's Cry",type:0x10002},
  ]);
  const engine = new Database(join(directory,"cards.cdb"));
  engine.prepare("UPDATE datas SET race=?,attribute=?,level=? WHERE id=?").run(0x2,0x10,1,97268402);
  engine.prepare("UPDATE datas SET race=?,attribute=?,level=? WHERE id=?").run(0x2000,0x10,8,89631139);
  engine.close();
  const insert = state.db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at) VALUES(?,?,?,?,?,?,?,?,'fixture','fixture','[]','now')`);
  insert.run(89631139, "Blue-Eyes White Dragon", "Dragon / Normal Monster", "normal", "A powerful dragon.", "LIGHT", 8, "Blue-Eyes");
  insert.run(87025064, "Silver's Cry", "Quick-Play Spell Card", "spell", "Target 1 Dragon Normal Monster in your GY; Special Summon that target.", null, null, null);
  // Unrelated cached catalog records give the real 5% broad-hook guard a useful denominator.
  for (let n = 0; n < 100; n++) insert.run(500000000 + n, `Unrelated catalog card ${n}`, "Spell Card", "spell", "", null, null, null);
  host=createDuelHost({db:state.db,dataDirectory:directory,secret:"web-effect-secret",searchCards:()=>[],pollIntervalMs:60_000});
});
afterAll(async()=>{await host.close();state.db?.close();rmSync(directory,{recursive:true,force:true});});
beforeEach(()=>{
  state.fallback.mockReset().mockResolvedValue(null);
  vi.resetModules();vi.stubEnv("DISCORD_GUILD_ID","configured-community");vi.stubEnv("EFFECT_SEARCH","1");
  vi.stubEnv("DECK_SUGGESTIONS", "1");
  vi.stubEnv("DUEL_INTERNAL_URL","http://effect-host");vi.stubEnv("DUEL_INTERNAL_SECRET","web-effect-secret");
  state.auth.mockResolvedValue({user:{id:"123",name:"Yugi"}});
  state.suggestionRequests.length = 0; state.suggestionResponses.length = 0;
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    const body = JSON.parse(String(init?.body ?? "{}"));
    const response = await host.handle(new Request(String(input),init));
    if (body.op === "deck-suggestions") {
      state.suggestionRequests.push(body);
      state.suggestionResponses.push(await response.clone().json());
    }
    return response;
  });
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const post=async(body:unknown)=>{
  const {POST}=await import("../app/api/decks/cards/route");
  return POST(new Request("http://web/api/decks/cards",{method:"POST",body:JSON.stringify(body)}));
};
it("forwards an authenticated scoped reading to the real signed host and keeps separate effect hits",async()=>{
  const response=await post({text:"hand traps that negate",passcodes:[14558127,97268402,89631139]});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({effectSearchEnabled:true,cards:[],effectTotal:2,reading:{chips:["Role: hand trap","Does: negate"]},effectHits:expect.arrayContaining([expect.objectContaining({code:97268402,reason:expect.any(String)})])});
});
it("uses the same Outside row through the signed deck-search and insight entry points", async () => {
  vi.stubEnv("DECK_SUGGESTIONS", "1");
  vi.stubEnv("DUEL_DATA_DIR", directory);
  const deck = { main: [89631139, 89631139, 89631139], extra: [], side: [] };
  const search = await post({ text: "non Blue-Eyes cards that synergize with Blue-Eyes", deck });
  expect(search.status).toBe(200);
  const found = await search.json();
  expect(found.reading.query.intent).toEqual({ kind: "outside", archetype: "Blue-Eyes" });
  expect(found.effectHits.map((card: DeckCardInfo) => card.code)).toEqual([87025064]);
  const { POST } = await import("../app/api/cards/insights/route");
  const response = await POST(new Request("http://web/api/cards/insights", { method: "POST", body: JSON.stringify({ op: "suggestRows", deck }) }));
  expect(response.status).toBe(200);
  const suggestions = await response.json();
  expect(suggestions.rows[1].cards.map((card: { passcode: number }) => card.passcode)).toEqual([87025064]);
  const insights = await POST(new Request("http://web/api/cards/insights", { method: "POST", body: JSON.stringify({ op: "effectSearch", text: "outside Blue-Eyes", deck }) }));
  expect(insights.status).toBe(200);
  expect((await insights.json()).cards.map((card: { passcode: number }) => card.passcode)).toEqual([87025064]);
  const { POST: resolve } = await import("../app/api/cards/resolve/route");
  const resolved = await resolve(new Request("http://web/api/cards/resolve", { method: "POST", body: JSON.stringify({ op: "effectSearch", text: "outside Blue-Eyes", deck }) }));
  expect(resolved.status).toBe(200);
  expect((await resolved.json()).cards.map((card: { id: number }) => card.id)).toEqual([87025064]);
  expect(state.suggestionRequests).toHaveLength(4);
  expect(state.suggestionRequests[3].suggestionVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(state.suggestionResponses[3]).toMatchObject({ notModified: true });
  const excluded = await post({ text: "outside Blue-Eyes", deck, exclude: [87025064] });
  expect(excluded.status).toBe(200);
  expect((await excluded.json()).effectHits).toEqual([]);
  expect(state.fallback).not.toHaveBeenCalled();
  vi.stubEnv("DECK_SUGGESTIONS", "0");
  expect((await post({ text: "outside Blue-Eyes", deck })).status).toBe(404);
});

it("checks every cached result with the real host and isolates mutations, actors and metadata revisions", async () => {
  const { loadDeckSuggestions } = await import("../src/lib/deck-suggestions");
  const query: Extract<DeckSuggestionQuery, { op: "suggestRows" }> = { op: "suggestRows", format: "normal", deck: { main: [89631139, 89631139, 89631139], extra: [], side: [97268402, 14558127] } };
  const input = { guildId: "configured-community", userId: "123", query };
  const first = await loadDeckSuggestions(input);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  first.result.rows[1].cards[0].name = "caller mutation";
  const repeated = await loadDeckSuggestions({ ...input, query: { ...input.query, deck: { ...input.query.deck, side: [...input.query.deck.side].reverse() } } });
  expect(repeated.ok).toBe(true);
  if (repeated.ok) expect(repeated.result.rows[1].cards[0].name).toBe("Silver's Cry");
  expect(state.suggestionRequests.at(-1)?.suggestionVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(state.suggestionResponses.at(-1)).toMatchObject({ notModified: true });
  expect((await loadDeckSuggestions({ ...input, userId: "124" })).ok).toBe(true);
  expect(state.suggestionRequests.at(-1)?.userId).toBe("124");
  expect(state.suggestionRequests.at(-1)?.suggestionVersion).toBeUndefined();
  state.db!.prepare("UPDATE card_catalog SET name='Updated Silver Cry' WHERE ygoprodeck_id=87025064").run();
  try {
    const updated = await loadDeckSuggestions(input);
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.result.rows[1].cards[0].name).toBe("Updated Silver Cry");
    expect(state.suggestionResponses.at(-1)).not.toHaveProperty("notModified");
  } finally { state.db!.prepare("UPDATE card_catalog SET name='Silver''s Cry' WHERE ygoprodeck_id=87025064").run(); }
});

it("retains at most 64 completed results across module reloads and reuses only validated versions", async () => {
  const { loadDeckSuggestions } = await import("../src/lib/deck-suggestions");
  const input = (n: number) => ({ guildId: "configured-community", userId: "123", query: { op: "suggestRows" as const, format: "normal" as const,
    deck: { main: [89631139, 89631139, 89631139], extra: [], side: [] }, exclude: [500000000 + n] } });
  for (let n = 0; n < 65; n++) expect((await loadDeckSuggestions(input(n))).ok).toBe(true);
  vi.resetModules();
  const reloaded = await import("../src/lib/deck-suggestions");
  expect((await reloaded.loadDeckSuggestions(input(64))).ok).toBe(true);
  expect(state.suggestionRequests.at(-1)?.suggestionVersion).toMatch(/^[a-f0-9]{64}$/);
  expect(state.suggestionResponses.at(-1)).toMatchObject({ notModified: true });
  expect((await reloaded.loadDeckSuggestions(input(0))).ok).toBe(true);
  expect(state.suggestionRequests.at(-1)?.suggestionVersion).toBeUndefined();
});

it("fails closed on host outages and malformed conditional/result responses even with a cached result", async () => {
  const { loadDeckSuggestions } = await import("../src/lib/deck-suggestions");
  const input = { guildId: "configured-community", userId: "123", query: { op: "suggestRows" as const, format: "normal" as const,
    deck: { main: [89631139, 89631139, 89631139], extra: [], side: [] }, exclude: [500000099] } };
  expect((await loadDeckSuggestions(input)).ok).toBe(true);
  vi.stubGlobal("fetch", async () => { throw new Error("host unavailable"); });
  const outage = await loadDeckSuggestions(input);
  expect(outage.ok).toBe(false);
  if (!outage.ok) expect(outage.response.status).toBe(503);
  for (const body of [{ contextVersion: "0".repeat(64), notModified: true }, { contextVersion: "0".repeat(64), result: { rows: [], version: "invalid" } },
    { contextVersion: "0".repeat(64), result: {}, allowed: [87025064] }]) {
    vi.stubGlobal("fetch", async () => Response.json(body));
    const malformed = await loadDeckSuggestions(input);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.response.status).toBe(502);
  }
});
it("retains literal search when exact or the web flag is off, even with an enabled host",async()=>{
  expect(await (await post({text:"hand traps that negate",exact:true})).json()).toMatchObject({reading:null,effectHits:[]});
  vi.stubEnv("EFFECT_SEARCH","0");
  const off=await(await post({text:"hand traps that negate"})).json();
  expect(off.effectSearchEnabled).toBe(false);expect(off).not.toHaveProperty("reading");
  const name=await(await post({text:"Blue-Eyes White Dragon",scope:"name"})).json();
  expect(name.cards[0].code).toBe(89631139);
});
it("rejects unauthenticated and malformed effect controls before searching",async()=>{
  state.auth.mockResolvedValue(null);expect((await post({text:"hand traps"})).status).toBe(401);
  state.auth.mockResolvedValue({user:{id:"123",name:"Yugi"}});
  for(const body of [{text:"hand traps",exact:"yes"},{passcodes:[0]},{effectOmit:[{}]},{effectOffset:-1}]) expect((await post(body)).status).toBe(400);
});
it("keeps immediate draft-pool aliases and typos consistent with the scoped host",async()=>{
  const { cards } = await (await post({text:""})).json() as { cards: DeckCardInfo[] };
  for (const text of ["blueeyes", "blueeyes white dragon", "bule eyes white dragon"]) {
    const pool = queryPoolCards(cards,{...emptyCardQuery(),text});
    expect(pool.map(card=>card.code)).toContain(89631139);
    const remote = await (await post({text,passcodes:cards.map(card=>card.code)})).json();
    expect(remote.cards.map((card:DeckCardInfo)=>card.code)).toContain(89631139);
  }
  expect(queryPoolCards(cards,{...emptyCardQuery(),text:"blueeyes",exact:true})).toEqual([]);
  expect(queryPoolCards(cards,{...emptyCardQuery(),text:"blueeyes",kind:"spell"})).toEqual([]);
});

it("reruns hard phrases through the same scoped host filters after a fallback and skips successful names/exact/off/empty pools", async () => {
  const { interpret } = await import('@yugidraft/shared/cards/effects');
  const reading = interpret('hand traps that negate')!;
  state.fallback.mockImplementation(async (db: Database.Database, phrase: string, user: number) => {
    expect(String(user)).toBe('123');
    db.prepare("INSERT OR REPLACE INTO effect_readings VALUES(?,'done',?,0)").run(phrase.toLowerCase(), JSON.stringify(reading.query));
    return reading;
  });
  const result = await (await post({ text: 'halt their combo', passcodes: [97268402,89631139] })).json();
  expect(result).toMatchObject({ effectTotal: 1, effectHits: [{ code: 97268402, reason: expect.any(String) }], relax: [] });
  expect(result.effectHits[0].reason.length).toBeLessThanOrEqual(70);
  expect(state.fallback).toHaveBeenCalledTimes(1);
  state.fallback.mockClear();
  await post({ text: 'Blue-Eyes White Dragon' });
  await post({ text: 'another difficult phrase', exact: true });
  await post({ text: 'another difficult phrase', scope: 'name' });
  await post({ text: 'another difficult phrase', passcodes: [] });
  vi.stubEnv('EFFECT_SEARCH', '0');
  const off = await (await post({ text: 'another difficult phrase' })).json();
  expect(off).not.toHaveProperty('relax');
  expect(state.fallback).not.toHaveBeenCalled();
});
