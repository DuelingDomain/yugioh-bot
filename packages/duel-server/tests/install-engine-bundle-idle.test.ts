import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seedIdentity } from "./helpers/identity.js";
import { fixture, run, snapshot } from "./helpers/install-engine-bundle.js";
import { createDuelService } from "@yugidraft/shared/services";

describe("install-engine-bundle.sh idle duels with the application schema", () => {
  it.each([9, 11, 1800])("ignores a fork idle for %i minutes and cancels stale forks only after services stop", minutes => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("drop table duels"); migrate(db);
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      db.prepare(`insert into duels (guild_id, web_slug, name, organizer_player_id, mode, kind, status, last_activity_at)
        values ('g', 'idle-fork', 'Fork', ?, 'normal', 'replay-fork', 'active', datetime('now', ?))`).run(owner, `-${minutes} minutes`);
      db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) select id, 1, 0, '{}' from duels").run();
      const before = db.prepare("select * from duels").get();
      const preflight = run(f, true, "1");
      expect(preflight.status, preflight.out).toBe(0);
      expect(db.prepare("select * from duels").get()).toEqual(before);
      const installed = run(f, false, "1");
      expect(installed.status, installed.out).toBe(0);
      expect(db.prepare(`select status, ended_at is not null as ended, archived_at is not null as archived,
        clock_json, winner_player_id, winner_seat, started_at from duels`).get()).toEqual({
        status: minutes > 10 ? "cancelled" : "active", ended: minutes > 10 ? 1 : 0, archived: minutes > 10 ? 1 : 0,
        clock_json: null, winner_player_id: null, winner_seat: null, started_at: null,
      });
      expect(db.prepare("select count(*) as n from duel_commands").get()).toEqual({ n: 1 });
      expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it.each([9, 11])("applies the idle cutoff to an unknown kind with only activity columns (%i minutes)", minutes => {
    const f = fixture({ tag: "old" }, { tag: "new" }, [{ format: "1v1", status: "active" }]);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("alter table duels add column kind text; alter table duels add column last_activity_at text; alter table duels add column started_at text; alter table duels add column created_at text");
      db.prepare("update duels set kind = 'future-practice', created_at = datetime('now', ?)").run(`-${minutes} minutes`);
      const result = run(f, true);
      expect(result.status, result.out).toBe(minutes > 10 ? 0 : 1);
    } finally { db.close(); }
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("closes stale %s duels after stop but still refuses a live duel", format => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      db.exec("drop table duels"); migrate(db);
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const service = createDuelService(db);
      const create = (name: string) => service.create({ guildId: "g", organizerPlayerId: owner, name, mode: "normal", format });
      const stale = create("Stale"), live = create("Live");
      db.prepare("update duels set status = 'active', seed_json = '[\"1\"]', bundle_version = 'saved', last_activity_at = datetime('now', '-2 hours') where id = ?").run(stale.id);
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-1 minute') where id = ?").run(live.id);
      db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) values (?, 1, 0, '{}')").run(stale.id);
      const before = snapshot(f.dst);
      // Before stopping the services the check is read-only, even if another live game refuses deployment.
      const preflight = run(f, true, "1");
      expect(preflight.status, preflight.out).toBe(1);
      expect(preflight.out).toContain("1 active");
      expect(service.get(stale.slug, "g").status).toBe("active");
      const startup = run(f, false);
      expect(startup.status, startup.out).toBe(1);
      expect(service.get(stale.slug, "g").status).toBe("active");
      const refused = run(f, false, "1");
      expect(refused.status, refused.out).toBe(1);
      expect(refused.out).toContain("1 active");
      expect(snapshot(f.dst)).toEqual(before);
      expect(service.get(stale.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, winnerPlayerId: null,
        resultReason: "No player activity for 10 minutes." });
      expect(service.get(live.slug, "g").status).toBe("active");
      expect(db.prepare("select ended_at is not null as ended, archived_at is not null as archived, clock_json from duels where id = ?").get(stale.id))
        .toEqual({ ended: 1, archived: 1, clock_json: null });
      expect(service.privateState(stale.slug, "g").commands).toHaveLength(1);
      db.prepare("update duels set last_activity_at = datetime('now', '-2 hours') where id = ?").run(live.id);
      expect(run(f, true, "1").status).toBe(0);
      expect(service.get(live.slug, "g").status).toBe("active");
      const installed = run(f, false, "1");
      expect(installed.status, installed.out).toBe(0);
      expect(service.get(live.slug, "g").status).toBe("interrupted");
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
});
