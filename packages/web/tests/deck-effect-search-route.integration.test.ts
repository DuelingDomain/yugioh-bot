import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../shared/src/db/schema";
import { importCardEffectArtifact } from "../../shared/src/cards/effects/artifact";
import { createDuelHost, type DuelHost } from "../../duel-server/src/host";
import { createHostDataFixture } from "../../duel-server/tests/helpers/host-data-fixture";
import { emptyCardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { queryPoolCards } from "../src/components/decks/pool-search";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: async () => ({ ok: true }) }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: async () => ({ ok: true }) }));
let directory: string, host: DuelHost;
beforeAll(() => {
  state.db = new Database(":memory:");migrate(state.db);importCardEffectArtifact(state.db);
  state.db.prepare("INSERT INTO players(guild_id,discord_user_id,display_name) VALUES('configured-community','123','Yugi')").run();
  directory = createHostDataFixture([
    {code:14558127,name:"Ash Blossom & Joyous Spring",type:0x21},
    {code:97268402,name:"Effect Veiler",type:0x21},
    {code:89631139,name:"Blue-Eyes White Dragon",type:0x11},
  ]);
  const engine = new Database(join(directory,"cards.cdb"));
  engine.prepare("UPDATE datas SET race=?,attribute=?,level=? WHERE id=?").run(0x2,0x10,1,97268402);
  engine.close();
  host=createDuelHost({db:state.db,dataDirectory:directory,secret:"web-effect-secret",searchCards:()=>[],pollIntervalMs:60_000});
});
afterAll(async()=>{await host.close();state.db?.close();rmSync(directory,{recursive:true,force:true});});
beforeEach(()=>{
  vi.resetModules();vi.stubEnv("DISCORD_GUILD_ID","configured-community");vi.stubEnv("EFFECT_SEARCH","1");
  vi.stubEnv("DUEL_INTERNAL_URL","http://effect-host");vi.stubEnv("DUEL_INTERNAL_SECRET","web-effect-secret");
  state.auth.mockResolvedValue({user:{id:"123",name:"Yugi"}});
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>host.handle(new Request(String(input),init)));
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
