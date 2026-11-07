import Database from "better-sqlite3";
import {afterEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
import {createSetSync} from "../src/set-sync.js";
import {createImageCleanup} from "../src/image-cleanup.js";
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it("syncs an empty set cache at startup and at 06:00 UTC only",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T05:59:58Z"));
  const db=new Database(":memory:");migrate(db);
  const cards={syncSets:vi.fn(async()=>["Metal Raiders"])};
  const job=createSetSync({db,cards,expression:"0 6 * * *",timezone:"UTC"});
  try{await job.start();expect(cards.syncSets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);expect(cards.syncSets).toHaveBeenCalledTimes(2);
  }finally{await job.stop();db.close();}
});
it("does not sync non-empty metadata on startup",async()=>{
  const db=new Database(":memory:");migrate(db);
  db.prepare("insert into card_sets(set_name,synced_at) values('Metal Raiders',current_timestamp)").run();
  const cards={syncSets:vi.fn(async()=>[] as string[])};
  const job=createSetSync({db,cards,expression:"0 6 * * *",timezone:"UTC"});
  try{await job.start();expect(cards.syncSets).not.toHaveBeenCalled();}finally{await job.stop();db.close();}
});
it("evicts on startup and at 04:00 UTC and stops scheduling",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T03:59:58Z"));
  const cache={imageCacheBytes:vi.fn(async()=>100),removeOldestImages:vi.fn(async(_maxBytes:number)=>2)};
  const job=createImageCleanup({cache,maximumBytes:50,expression:"0 4 * * *",timezone:"UTC"});
  await job.start();await vi.advanceTimersByTimeAsync(3000);await job.stop();
  expect(cache.removeOldestImages.mock.calls).toEqual([[50],[50]]);
  await vi.advanceTimersByTimeAsync(24*60*60*1000);expect(cache.removeOldestImages).toHaveBeenCalledTimes(2);
});

it("coalesces cron ticks with a slow startup sync and drains it on stop", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T05:59:58Z"));
  const db=new Database(":memory:");migrate(db);
  let release!:(sets:string[])=>void;
  const cards={syncSets:vi.fn(()=>new Promise<string[]>(resolve=>{release=resolve;}))};
  const job=createSetSync({db,cards,expression:"0 6 * * *",timezone:"UTC"});
  try {
    const started=job.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(cards.syncSets).toHaveBeenCalledTimes(1);
    let stopped=false;
    const stop=job.stop().then(()=>{stopped=true;});
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(["Metal Raiders"]);
    await Promise.all([started,stop]);
    await job.tick();
    expect(cards.syncSets).toHaveBeenCalledTimes(1);
  } finally {
    await job.stop();db.close();
  }
});


it("purges only expired remote rooms in bounded hourly cleanup batches", async () => {
  const {createRemoteDuelService,createUserService}=await import('@yugidraft/shared/services');
  const {pruneRemoteDuels}=await import('../src/remote-retention.js');
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');migrate(db);
  try {
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','');
    const user=createUserService(db).createNonLogin('Retention owner');
    const service=createRemoteDuelService(db), day=86400000, now=40*day;
    const create=()=>service.create({guildId:'g',userId:user.id,displayName:'Owner',gameId:'ygo',seatCount:2},1000);
    for(let i=0;i<101;i++) {
      const room=create();
      db.prepare("update remote_tables set status='ended',ended_at=? where slug=?").run(now-day-1,room.slug);
    }
    const active=create(), retained=create();
    db.prepare("update remote_tables set status='active',ended_at=? where slug=?").run(now-31*day,active.slug);
    db.prepare("update remote_tables set status='ended',ended_at=? where slug=?").run(now-day,retained.slug);
    expect(pruneRemoteDuels(db,now)).toBe(101);
    expect(db.prepare('select count(*) n from remote_tables').get()).toEqual({n:2});
    expect(service.replay(retained.slug,'g',user.id)).toBeDefined();
    expect(service.get(active.slug,'g',user.id).status).toBe('active');
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','0');
    expect(()=>pruneRemoteDuels(db,now)).toThrow('REMOTE_DUELS_RETENTION_DAYS');
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','bad');
    expect(()=>pruneRemoteDuels(db,now)).toThrow('REMOTE_DUELS_RETENTION_DAYS');
    expect(db.prepare('select count(*) n from remote_tables').get()).toEqual({n:2});
    vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS','');
    expect(pruneRemoteDuels(db,now+1)).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {db.close();}
});


it("finalizes eligible Remote proposals at two hours, survives room deletion and publishes changes once", async () => {
  const {createTournamentService,createMatchService,createUserService} = await import("@yugidraft/shared/services");
  const {createTournamentTimer} = await import("../src/tournament-timer.js");
  const db=new Database(":memory:"); db.pragma("foreign_keys=ON"); migrate(db);
  vi.stubEnv("REMOTE_DUELS","1"); vi.stubEnv("REMOTE_DUELS_USERS","*");
  try {
    const owner=createUserService(db).createNonLogin("Organizer");
    const players=Array.from({length:4},(_,i)=>{
      const user=createUserService(db).createNonLogin(`Player ${i}`);
      return Number(db.prepare("insert into players(guild_id,user_id,display_name) values('g',?,?)").run(user.id,`P${i}`).lastInsertRowid);
    });
    const tournaments=createTournamentService(db), matches=createMatchService(db);
    const t=tournaments.create("g","Timer cup","round_robin",owner.id,{duelType:"remote",bestOf:1});
    for(const p of players)tournaments.join(t.id,p);tournaments.start(t.id);
    const slots=tournaments.matches(t.id).slice(0,5), deadline=10_000;
    for (const [i,slot] of slots.entries()) db.prepare(`insert into tournament_remote_matches
      (tournament_match_id,table_slug,player_one_id,player_two_id,status,winner_player_id,player_one_wins,player_two_wins,
      result_source,proposed_at,confirm_deadline_at,player_one_choice,created_at,updated_at)
      values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slot.id,`purged-${i}`,slot.playerOneId,slot.playerTwoId,
        i===4?'disputed':'proposed',slot.playerOneId,1,0,i===0?'concede':i===1?'declared':'lp',
        deadline-7200000,deadline,i===3?'confirm':null,0,0);
    const effects={discordEnabled:false,tournament:vi.fn(async()=>{}),discord:vi.fn(async()=>{}),draft:vi.fn(async()=>{}),duel:vi.fn(async()=>{})};
    const timer=createTournamentTimer({db,tournaments,matches,effects});
    await timer.tick(new Date(deadline-1));
    expect(db.prepare("select count(*) n from matches").get()).toEqual({n:0});
    await timer.tick(new Date(deadline));
    expect(db.prepare("select count(*) n from tournament_remote_matches where status='final' and finalization_reason='timeout'").get()).toEqual({n:3});
    expect(db.prepare("select status from tournament_matches where id=?").get(slots[2].id)).toEqual({status:"open"});
    expect(db.prepare("select status from tournament_matches where id=?").get(slots[4].id)).toEqual({status:"open"});
    expect(effects.tournament).toHaveBeenCalledWith({kind:"match-updated",slug:t.webSlug});
    await timer.tick(new Date(deadline+60000));
    expect(db.prepare("select count(*) n from matches").get()).toEqual({n:3});
    expect(effects.tournament).toHaveBeenCalledTimes(3);
  } finally {db.close();}
});
