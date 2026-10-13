import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";

it("adds creation storage after the local migrations and keeps all existing rows", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = on");
  try {
    migrate(db);
    db.exec(`drop table duel_creation_requests; drop index duels_host_live_idx; drop index duels_waiting_idle_idx;
      insert into players(id,guild_id,discord_user_id,display_name) values(31,'g','111111111111111111','Host');
      insert into cubes(id,guild_id,name,created_by_user_id) values(51,'g','Local cube','111111111111111111');
      insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,kind,sandbox)
        values(71,'g','web-wait','Web table',31,'normal','lobby','play',0),
              (72,'g','dev-sandbox','Sandbox',31,'normal','lobby','play',1),
              (73,'g','local-fork','Fork',31,'normal','active','replay-fork',0);
      insert into duel_seats(duel_id,seat,player_id) values(71,0,31),(72,0,31),(73,0,31);
      insert into replay_fork_requests(owner_user_id,request_id,source_slug,source_version,cursor_digest,fork_duel_id)
        values('111111111111111111','old-fork-key','source','v1','digest',73);`);
    const tables = ["players", "cubes", "duels", "duel_seats", "replay_fork_requests"];
    const rows = () => tables.map(table => db.prepare(`select * from ${table} order by rowid`).all());
    const before = rows();
    migrate(db);
    expect(rows()).toEqual(before);
    expect(db.prepare("select * from duel_creation_requests").all()).toEqual([]);
    const once = db.serialize();
    migrate(db);
    expect(db.serialize()).toEqual(once);
    expect(rows()).toEqual(before);
    for (const name of ["duels_host_live_idx", "duels_waiting_idle_idx", "duel_creation_requests_age_idx"])
      expect(db.prepare("select name from sqlite_master where type = 'index' and name = ?").get(name)).toEqual({ name });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  } finally { db.close(); }
});
