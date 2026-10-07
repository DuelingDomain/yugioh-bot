import {afterEach,expect,it,vi} from "vitest";
import {recordingTransport, type AnnouncePayload} from "@yugidraft/shared/notify";
import {createEffects, effectsFromEnv} from "../src/effects.js";
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});
it("keeps WS effects when Discord fails and forwards status/completion/resolve",async()=>{
  const ws=recordingTransport(),bot=recordingTransport();
  const effects=createEffects({enabled:true,ws:ws.transport,bot:bot.transport});
  const payloads:AnnouncePayload[]=[
    {kind:"draft-status",draftId:13},
    {kind:"draft-completed",draftId:13,channelId:"channel",name:"Draft",webSlug:"draft"},
    {kind:"tournament-completed",tournamentId:11},
    {kind:"match-resolved",matchId:7},
  ];
  for(const payload of payloads) await effects.discord(payload);
  expect(bot.calls.map(c=>c.path)).toEqual(["draft-status","draft-completed","tournament-completed","match-resolved"].map(k=>`/internal/announce/${k}`));
  expect(bot.calls.map(c=>JSON.parse(c.body))).toEqual([
    {draftId:13},
    {draftId:13,channelId:"channel",name:"Draft",webSlug:"draft"},
    {tournamentId:11},
    {matchId:7},
  ]);
  vi.spyOn(bot.transport,"post").mockRejectedValue(new Error("offline"));
  await effects.discord({kind:"draft-status",draftId:13});
  await effects.draft({kind:"complete",slug:"draft"});
  await effects.duel("duel","guild");
  expect(ws.calls.map(c=>c.path)).toEqual(["/internal/draft/complete","/internal/duel/changed"]);
  expect(ws.calls.map(c=>JSON.parse(c.body))).toEqual([{slug:"draft"},{slug:"duel",guildId:"guild"}]);
});
it("does no Discord I/O when disabled",async()=>{
  const ws=recordingTransport(),bot=recordingTransport();
  const effects=createEffects({enabled:false,ws:ws.transport,bot:bot.transport});
  await effects.discord({kind:"draft-status",draftId:13});
  await effects.draft({kind:"complete",slug:"draft"});
  expect(bot.calls).toEqual([]);expect(ws.calls).toHaveLength(1);
});

it.each([undefined,"0","true","1"])("enables Discord only for literal 1 (switch=%s)", async switchValue => {
  const fetchMock=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(null,{status:204}));
  vi.stubGlobal("fetch",fetchMock);
  const effects=effectsFromEnv({DISCORD_BOT_ENABLED:switchValue,WS_INTERNAL_URL:"http://ws",WS_INTERNAL_SECRET:"ws-secret",BOT_ANNOUNCE_URL:"http://bot",BOT_ANNOUNCE_SECRET:"bot-secret"});
  await effects.draft({kind:"complete",slug:"draft"});
  await effects.discord({kind:"match-resolved",matchId:7});
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(switchValue==="1"
    ? ["http://ws/internal/draft/complete","http://bot/internal/announce/match-resolved"]
    : ["http://ws/internal/draft/complete"]);
});

it("bounds every WS and bot call with an abort signal", async () => {
  const fetchMock=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(null,{status:204}));
  vi.stubGlobal("fetch",fetchMock);
  const effects=effectsFromEnv({DISCORD_BOT_ENABLED:"1",WS_INTERNAL_URL:"http://ws",WS_INTERNAL_SECRET:"ws-secret",BOT_ANNOUNCE_URL:"http://bot",BOT_ANNOUNCE_SECRET:"bot-secret"});
  await effects.draft({kind:"complete",slug:"draft"});
  await effects.discord({kind:"match-resolved",matchId:7});
  expect(fetchMock.mock.calls.map(call=>call[1]?.signal instanceof AbortSignal)).toEqual([true,true]);
});
