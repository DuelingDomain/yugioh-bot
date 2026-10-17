import Database from "better-sqlite3";
import {afterEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
import {createSetSync} from "../src/set-sync.js";
import {createImageCleanup} from "../src/image-cleanup.js";
afterEach(()=>vi.useRealTimers());
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
