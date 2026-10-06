import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { createDuelService, createPlayerService } from "@yugidraft/shared/services";
import { createSandboxCleanupService } from "../../src/services/sandbox-cleanup.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  const owner = createPlayerService(db).findOrCreate("g", "owner", "Owner").id;
  const service = createDuelService(db);
  function duel(sandbox: boolean, status: string, created: string, ended: string | null = null) {
    const room = service.create({ guildId: "g", organizerPlayerId: owner, name: "Cleanup", mode: "normal", sandbox });
    db.prepare("update duels set status = ?, created_at = ?, ended_at = ? where id = ?").run(status, created, ended, room.id);
    return room.id;
  }
  const row = (id: number) => db.prepare("select * from duels where id = ?").get(id) as { archived_at: string | null } | undefined;
  return { db, owner, service, duel, row, cleanup: createSandboxCleanupService(db) };
}
const now = "2026-10-06 12:00:00";
describe("sandbox cleanup", () => {
  it.each(["complete", "interrupt", "cancel"] as const)("waits one hour after the real %s transition", (action) => {
    const t = setup();
    const id = t.duel(true, "active", now);
    const { web_slug: slug } = t.db.prepare("select web_slug from duels where id = ?").get(id) as { web_slug: string };
    if (action === "complete") t.service.complete(slug, "g", 0, "Test");
    else if (action === "interrupt") t.service.interrupt(slug, "g", "Test");
    else t.service.cancel(slug, "g", t.owner);
    expect(t.row(id)?.archived_at).toBeNull();
    t.db.prepare("update duels set ended_at = '2026-10-06 11:30:00' where id = ?").run(id);
    expect(t.service.archiveDue(100, 0)).toEqual([]);
    expect(t.cleanup.tick(now)).toEqual({ archived: 0, deleted: 0 });
    expect(t.cleanup.tick("2026-10-06 12:30:00")).toEqual({ archived: 1, deleted: 0 });
  });
  it("archives only terminal sandbox duels one hour after end", () => {
    const t = setup();
    const due = ["completed", "cancelled", "interrupted"].map((status) => t.duel(true, status, now, "2026-10-06 11:00:00"));
    const keep = [t.duel(true, "completed", now, "2026-10-06 11:00:01"),
      t.duel(true, "active", now), t.duel(true, "lobby", now),
      t.duel(false, "completed", now, "2026-10-06 10:00:00")];
    expect(t.cleanup.tick(now)).toEqual({ archived: 3, deleted: 0 });
    for (const id of due) expect(t.row(id)?.archived_at).toBe(now);
    for (const id of keep) expect(t.row(id)?.archived_at).toBeNull();
    expect(t.cleanup.tick(now)).toEqual({ archived: 0, deleted: 0 });
  });
  it("deletes sandbox rows older than seven days and all children, but keeps normal duels", () => {
    const t = setup();
    const expired = t.duel(true, "cancelled", "2026-09-29 11:59:59", "2026-10-06 11:30:00");
    const oldLobby = t.duel(true, "lobby", "2026-09-01 00:00:00");
    const keep = [t.duel(true, "completed", "2026-09-29 12:00:01", now),
      t.duel(false, "cancelled", "2026-09-01 00:00:00", now)];
    t.db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) values (?, 1, 0, '{}')").run(expired);
    t.db.prepare("insert into duel_invite_grants (duel_id, player_id) values (?, ?)").run(expired, t.owner);
    expect(t.cleanup.tick(now)).toEqual({ archived: 0, deleted: 2 });
    expect(t.row(expired)).toBeUndefined();
    expect(t.row(oldLobby)).toBeUndefined();
    for (const table of ["duel_seats", "duel_commands", "duel_invite_grants"]) {
      expect(t.db.prepare(`select * from ${table} where duel_id = ?`).all(expired)).toEqual([]);
    }
    for (const id of keep) expect(t.row(id)).toBeDefined();
    expect(t.db.pragma("foreign_key_check")).toEqual([]);
  });
});
