import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { seedIdentity } from "./helpers/identity.js";
import { fixture, run, snapshot } from "./helpers/install-engine-bundle.js";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";

describe("install-engine-bundle.sh idle duels with the application schema", () => {
  it.each(["ranked", "tournament", "closed tournament"])("preserves an idle %s for host settlement while replacing the bundle", kind => {
    const f = fixture({ tag: "old" }, { tag: "new" });
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const guest = seedIdentity(db, { guildId: "g", name: "Guest" }).playerId;
      const series = createDuelSeriesService(db);
      const { duel, series: match } = series.createChallenge({ guildId: "g", challengerPlayerId: owner, opponentPlayerId: guest,
        bestOf: 3, ranked: true, mode: "normal" });
      db.prepare("update duel_series set status = 'active' where id = ?").run(match.id);
      if (kind !== "ranked") {
        db.prepare("update duels set ranked = 0 where id = ?").run(duel.id);
        db.prepare("update duel_series set ranked = 0 where id = ?").run(match.id);
        const tournament = db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) select 'g', 'Cup', 'single_elim', ?, user_id from players where id = ?")
          .run(kind === "closed tournament" ? "completed" : "active", owner);
        const slot = db.prepare("insert into tournament_matches (tournament_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, 1, 'open')")
          .run(tournament.lastInsertRowid, owner, guest);
        db.prepare("update duel_series set tournament_match_id = ? where id = ?").run(slot.lastInsertRowid, match.id);
      }
      const clock = { turn: 1, activeSeat: null, startedAt: null, remainingMs: [180_000, 180_000] };
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-11 minutes'), clock_json = ? where id = ?")
        .run(JSON.stringify(clock), duel.id);
      const before = db.prepare("select * from duels where id = ?").get(duel.id);
      expect(run(f, true, "1").status).toBe(0);
      expect(createDuelService(db).get(duel.slug, "g").status).toBe("active");
      expect(series.get(match.id, "g").status).toBe("active");
      const result = run(f, false, "1");
      expect(result.status, result.out).toBe(0);
      expect(db.prepare("select * from duels where id = ?").get(duel.id)).toEqual(before);
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(series.get(match.id, "g")).toMatchObject({ status: "active", wins: [0, 0], nextGameAt: null });
      expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it.each([undefined, "0", "true"])("leaves stale duel rows for the host to close during container startup (DUEL_IDLE_CLOSE=%s)", idleClose => {
    const f = fixture({ tag: "old" }, { tag: "new" });
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    try {
      const owner = seedIdentity(db, { guildId: "g", name: "Owner" }).playerId;
      const service = createDuelService(db);
      const duel = service.create({ guildId: "g", organizerPlayerId: owner, name: "Stale", mode: "normal" });
      const clock = { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * 60_000, remainingMs: [30 * 60_000, 30 * 60_000] };
      db.prepare("update duels set status = 'active', last_activity_at = datetime('now', '-11 minutes'), clock_json = ? where id = ?")
        .run(JSON.stringify(clock), duel.id);
      const before = db.prepare("select * from duels where id = ?").get(duel.id);
      const result = run(f, false, idleClose);
      expect(result.status, result.out).toBe(0);
      expect(snapshot(f.dst)).toEqual(snapshot(f.src));
      expect(db.prepare("select * from duels where id = ?").get(duel.id)).toEqual(before);
    } finally { db.close(); }
  });
});
