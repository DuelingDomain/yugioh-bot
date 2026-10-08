import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createTournamentAccessReader, findTournamentReadAccess } from "../../src/services/index.js";

it("tournament reads share one guild-scoped access policy", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    db.exec("insert into users(id,username,display_name) values(101,'host','Host'); insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('g','Cup','round_robin','active',101,'cup')");
    expect(findTournamentReadAccess(db, "cup", "g", 999)).toEqual({ id: 1, status: "active", canRead: true });
    expect(findTournamentReadAccess(db, "cup", "other", 101)).toBeNull();
    expect(findTournamentReadAccess(db, "missing", "g", 101)).toBeNull();
  } finally { db.close(); }
});
it("the websocket reader checks current access with a readonly connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "tournament-reader-"));
  const path = join(dir, "db.sqlite");
  const db = new Database(path);
  let reader: ReturnType<typeof createTournamentAccessReader> | undefined;
  try {
    migrate(db);
    db.exec("insert into users(id,username,display_name) values(101,'host','Host'); insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('g','Cup','round_robin','active',101,'cup')");
    reader = createTournamentAccessReader(path);
    const claims = { slug: "cup", guildId: "g", userId: 101 };
    expect(reader.canReadTournament(claims)).toBe(true);
    db.exec("update tournaments set guild_id='other'");
    expect(reader.canReadTournament(claims)).toBe(false);
  } finally { reader?.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
