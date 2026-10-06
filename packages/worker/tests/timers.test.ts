import Database from "better-sqlite3";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach,expect,it,vi} from "vitest";
import {openDatabase} from "@yugidraft/shared/db";
import {createDraftService,createMatchService,createPlayerService,createTournamentService,createUserService,createTournamentDuelService,createDuelSeriesService} from "@yugidraft/shared/services";
import {createBroadcaster,recordingTransport} from "@yugidraft/shared/notify";
import {createDraftTimer} from "../src/draft-timer.js";
import {createTournamentTimer} from "../src/tournament-timer.js";
import {createLoop} from "../src/loop.js";
import type {WorkerEffects} from "../src/effects.js";
const opened:Database.Database[]=[];
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close();vi.useRealTimers();vi.restoreAllMocks();});
function setup(path=":memory:"){
  const db=openDatabase(path);opened.push(db);
  createUserService(db).createNonLogin("Owner without a player");
  const players=createPlayerService(db),drafts=createDraftService(db),matches=createMatchService(db),tournaments=createTournamentService(db);
  const a=players.findOrCreateByDiscord("g","900000000000000101","Alice");
  const b=players.findOrCreateByDiscord("g","900000000000000102","Bob");
  expect(a.userId).not.toBe(a.id);
  const rec=recordingTransport(),broadcast=createBroadcaster(rec.transport);
  const effects:WorkerEffects={discordEnabled:true,draft:broadcast.draft,tournament:broadcast.tournament,discord:vi.fn(async()=>{}),duel:vi.fn(async()=>{})};
  return {db,players,drafts,matches,tournaments,a,b,effects,rec};
}
function activeDraft(app:ReturnType<typeof setup>){
  const insert=app.db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values(?,?,'Normal Monster','normal','https://img/full','https://img/small','[{"set_name":"Metal Raiders"}]',current_timestamp)`);
  for(let id=1;id<=80;id++)insert.run(id,`Card ${id}`);
  const draft=app.drafts.create("g","channel","Worker draft",{},app.a.userId,app.a.id);
  app.drafts.join(draft.id,app.b.id);app.drafts.start(draft.id);
  return draft.id;
}
it("startup catches overdue picks; a web expiry racing a stale list commits once",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup(),id=activeDraft(app);
  vi.setSystemTime(new Date("2026-10-06T12:05:00Z"));
  const timer=createDraftTimer(app),loop=createLoop(()=>timer.tick(),1000);
  await loop.start();await loop.stop();
  const after=app.drafts.findById(id);expect(after.currentPickStep).toBe(2);
  const stale=app.drafts.listActive();
  vi.setSystemTime(new Date("2026-10-06T12:06:00Z"));
  app.drafts.expireCurrentPickStep(id,new Date()); // Same operation called by web helpers.ts:99.
  const picked=app.db.prepare("select count(*) as n from draft_picks where draft_id=?").get(id);
  vi.spyOn(app.drafts,"listActive").mockReturnValue(stale);
  await timer.tick();
  expect(app.db.prepare("select count(*) as n from draft_picks where draft_id=?").get(id)).toEqual(picked);
  expect(app.drafts.findById(id).currentPickStep).toBe(3);
});
it("completes an unattended draft, saves decks, and publishes despite Discord failure",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup(),id=activeDraft(app);
  vi.mocked(app.effects.discord).mockRejectedValue(new Error("offline"));
  const timer=createDraftTimer(app);
  for(let step=0;step<45&&app.drafts.findById(id).status==="active";step++){
    vi.setSystemTime(Date.now()+60_000);await timer.tick();
  }
  expect(app.drafts.findById(id).status).toBe("completed");
  expect(app.rec.calls.some(c=>c.path==="/internal/draft/complete")).toBe(true);
  expect(app.db.prepare("select count(*) as n from saved_decks where draft_id=?").get(id)).toEqual({n:2});
});
it("auto-approves reports and claims completed tournament only once",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup();
  const t=app.tournaments.create("g","Reports","round_robin",app.a.userId,{reportConfirmWindowHours:1});
  app.tournaments.join(t.id,app.a.id);app.tournaments.join(t.id,app.b.id);app.tournaments.start(t.id);
  const match=app.tournaments.report(t.id,app.a.id,app.b.id,app.a.id);
  app.db.prepare("update matches set created_at=? where id=?").run("2026-10-06T09:00:00Z",match.id);
  const timer=createTournamentTimer(app);await timer.tick();await timer.tick();
  expect(app.db.prepare("select status from matches where id=?").get(match.id)).toEqual({status:"approved"});
  expect(vi.mocked(app.effects.discord).mock.calls.filter(([p])=>p.kind==="tournament-completed")).toHaveLength(1);
  expect(app.effects.discord).toHaveBeenCalledWith({kind:"match-resolved",matchId:match.id});
});
it("closes overdue tournaments, awaits every duel invalidation, and tolerates effect failure",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup();
  const t=app.tournaments.create("g","Deadline","round_robin",app.a.userId,{deadlineAt:"2026-10-06T11:00:00Z"});
  const c=app.players.findOrCreateByDiscord("g","900000000000000103","Carol");
  for (const player of [app.a,app.b,c]) app.tournaments.join(t.id,player.id);
  app.tournaments.start(t.id);
  const duels=createTournamentDuelService(app.db),series=createDuelSeriesService(app.db);
  for (const player of [app.a,app.b,c]) duels.registerDeck({tournamentId:t.id,playerId:player.id,savedDeckId:null,deck:{main:[1,2,3],extra:[],side:[]}});
  const games=app.tournaments.openMatches(t.id).slice(0,2).map(slot=>series.startTournamentMatch({guildId:"g",tournamentMatchId:slot.id,actorPlayerId:slot.playerOneId}));
  let entered!:()=>void,release!:()=>void;
  const firstEffect=new Promise<void>(resolve=>{entered=resolve;});
  const transactions:boolean[]=[];
  vi.mocked(app.effects.duel).mockImplementation(async()=>{
    transactions.push(app.db.inTransaction);
    const pending=new Promise<void>(resolve=>{release=resolve;});
    entered();await pending;
  });
  vi.mocked(app.effects.discord).mockRejectedValue(new Error("offline"));
  let finished=false;
  const pending=createTournamentTimer(app).tick().then(()=>{finished=true;});
  await firstEffect;
  expect(finished).toBe(false);
  const secondEffect=new Promise<void>(resolve=>{entered=resolve;});
  release();await secondEffect;
  expect(finished).toBe(false);
  release();await pending;
  expect(app.tournaments.findById(t.id).status).toBe("completed");
  expect(vi.mocked(app.effects.duel).mock.calls).toEqual(games.map(game=>[game.duel.slug,"g"]));
  expect(transactions).toEqual([false,false]);
  for (const game of games) expect(series.get(game.series.id,"g").status).toBe("cancelled");
  expect(app.rec.calls.some(c=>c.path==="/internal/tournament/match-updated")).toBe(true);
});

it("recovers persisted due work in a new worker after database reopen", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const directory = await mkdtemp(join(tmpdir(), "worker-restart-"));
  try {
    const first = setup(join(directory, "queue.sqlite"));
    const id = activeDraft(first);
    first.db.close();
    vi.setSystemTime(new Date("2026-10-06T12:05:00Z"));
    const second = setup(join(directory, "queue.sqlite"));
    const timer = createDraftTimer(second);
    await timer.tick();
    await timer.tick();
    expect(second.drafts.findById(id).currentPickStep).toBe(2);
    expect(second.db.prepare("select count(*) as n from draft_picks where draft_id=?").get(id)).toEqual({n:2});
    expect(second.rec.calls.map(call => call.path)).toEqual(["/internal/draft/resync"]);
    second.db.close();
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
});

it("leaves completion claims available while Discord is disabled", async () => {
  const app = setup();
  app.effects.discordEnabled = false;
  const t = app.tournaments.create("g", "Disabled", "round_robin", app.a.userId, {
    deadlineAt: "2020-01-01T00:00:00Z",
  });
  app.tournaments.join(t.id, app.a.id);
  app.tournaments.join(t.id, app.b.id);
  app.tournaments.start(t.id);
  const timer = createTournamentTimer(app);
  await timer.tick();
  expect(app.tournaments.findById(t.id).status).toBe("completed");
  expect(app.db.prepare("select completed_announced_at as claim from tournaments where id=?").get(t.id)).toEqual({claim:null});
  expect(app.effects.discord).not.toHaveBeenCalled();
  expect(app.rec.calls.map(call => call.path)).toEqual(["/internal/tournament/match-updated"]);

  app.effects.discordEnabled = true;
  vi.mocked(app.effects.discord).mockRejectedValue(new Error("offline"));
  await timer.tick();
  await createTournamentTimer(app).tick();
  const row = app.db.prepare("select completed_announced_at as claim from tournaments where id=?").get(t.id) as {claim:string|null};
  expect(row.claim).not.toBeNull();
  expect(app.effects.discord).toHaveBeenCalledExactlyOnceWith({kind:"tournament-completed",tournamentId:t.id});
});

it("commits and publishes draft state before Discord I/O without an open transaction", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app = setup(), id = activeDraft(app);
  const observations: Array<{transaction:boolean;step:number;paths:string[]}> = [];
  vi.mocked(app.effects.discord).mockImplementation(async () => {
    observations.push({transaction:app.db.inTransaction,step:app.drafts.findById(id).currentPickStep,paths:app.rec.calls.map(call=>call.path)});
    throw new Error("offline");
  });
  vi.setSystemTime(new Date("2026-10-06T12:05:00Z"));
  await createDraftTimer(app).tick();
  expect(observations).toEqual([{transaction:false,step:2,paths:["/internal/draft/resync"]}]);
});
