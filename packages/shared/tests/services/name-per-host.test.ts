import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createDraftTournamentService } from "../../src/services/draft-tournament.js";
import { seedIdentity } from "../helpers/identity.js";

const handles: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of handles.splice(0)) db.close(); });

function setup() {
  const db = new Database(":memory:");
  handles.push(db);
  db.pragma("foreign_keys = on");
  migrate(db);
  const host = seedIdentity(db, { guildId: "g", name: "Host" });
  const other = seedIdentity(db, { guildId: "g", name: "Other" });
  const viewer = seedIdentity(db, { guildId: "g", name: "Viewer" });
  return { db, host, other, viewer };
}

describe.each(["drafts", "tournaments"] as const)("%s names per host", (table) => {
  function fixture() {
    const app = setup();
    const drafts = createDraftService(app.db);
    const tournaments = createTournamentService(app.db);
    const create = (actor: typeof app.host, name = "Friday Cup", guildId = "g") => table === "drafts"
      ? drafts.create(guildId, null, name, { customCardIds: [1], packsPerPlayer: 1, packSize: 1 }, actor.userId, actor.playerId)
      : tournaments.create(guildId, name, "round_robin", actor.userId);
    const lookup = (name: string, userId?: number) => table === "drafts"
      ? drafts.findByName("g", name, userId)
      : tournaments.findByName("g", name, userId);
    const insert = (actor: typeof app.host, status = "pending", visibility = "private", name = "Friday Cup") => {
      const columns = table === "tournaments" ? ", format" : "";
      const values = table === "tournaments" ? ", 'round_robin'" : "";
      return Number(app.db.prepare(`insert into ${table}(guild_id,name,status,created_by_user_id,visibility${columns})
        values('g',?,?,?,?${values})`)
        .run(name, status, actor.userId, visibility).lastInsertRowid);
    };
    return { ...app, create, lookup, insert };
  }

  it("lets two hosts create the same current name", () => {
    const app = fixture();
    const first = app.create(app.host);
    const second = app.create(app.other);
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe(first.name);
    expect(second.createdByUserId).toBe(app.other.userId);
  });

  it.each(["pending", "active"])("blocks the host's own %s name with host-only copy", (status) => {
    const app = fixture();
    app.create(app.host);
    app.db.prepare(`update ${table} set status = ?`).run(status);
    expect(() => app.create(app.host)).toThrow(`You already have a ${table === "drafts" ? "draft" : "tournament"} called this that hasn't finished.`);
    expect(app.db.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 1 });
  });

  it.each(["completed", "cancelled"])("a %s entry frees its host's name", (status) => {
    const app = fixture();
    const first = app.create(app.host);
    app.db.prepare(`update ${table} set status = ? where id = ?`).run(status, first.id);
    expect(app.create(app.host).id).not.toBe(first.id);
  });

  it("keeps uniqueness scoped to the guild as well as the host", () => {
    const app = fixture();
    app.create(app.host);
    const elsewhere = seedIdentity(app.db, { guildId: "elsewhere", name: "Host", userId: app.host.userId });
    expect(app.create(elsewhere, "Friday Cup", "elsewhere").createdByUserId).toBe(app.host.userId);
  });

  it("the database allows another host but rejects the same host on insert and rename", () => {
    const app = fixture();
    app.insert(app.host);
    expect(() => app.insert(app.other)).not.toThrow();
    expect(() => app.insert(app.host)).toThrow(/UNIQUE/);
    const second = app.insert(app.host, "pending", "private", "Saturday Cup");
    expect(() => app.db.prepare(`update ${table} set name='Friday Cup' where id=?`).run(second)).toThrow(/UNIQUE/);
  });

  it("uses host-only copy if a duplicate wins the race after the create check", () => {
    const app = fixture();
    const prepare = app.db.prepare.bind(app.db);
    const prepareSpy = vi.spyOn(app.db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.includes(`select id from ${table}`)) {
        const get = statement.get.bind(statement);
        vi.spyOn(statement, "get").mockImplementation((...params: unknown[]) => {
          const row = get(...params);
          prepareSpy.mockRestore();
          // A real row arrives after the pre-check read, before the write starts.
          app.insert(app.host);
          return row;
        });
      }
      return statement;
    });
    expect(() => app.create(app.host)).toThrow(`You already have a ${table === "drafts" ? "draft" : "tournament"} called this that hasn't finished.`);
    expect(app.db.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 1 });
  });

  // These fixtures model the new schema independently, so lookup failures expose
  // ordering/access bugs even before the migration is implemented.
  function lookupFixture() {
    const app = fixture();
    app.db.exec(`drop index if exists ${table}_current_name_unique; drop index if exists ${table}_current_host_name_unique;`);
    return app;
  }

  it("prefers the caller's own current entry over a newer host's entry", () => {
    const app = lookupFixture();
    const owned = app.insert(app.host);
    app.insert(app.other, "active", "open");
    expect(app.lookup("Friday Cup", app.host.userId)?.id).toBe(owned);
  });

  it("without a caller picks the newest current entry, with a deterministic tie-break", () => {
    const app = lookupFixture();
    app.insert(app.host, "active", "open");
    const latest = app.insert(app.other, "pending", "open");
    app.insert(app.viewer, "completed", "open");
    expect(app.lookup("Friday Cup")?.id).toBe(latest);
    expect(app.lookup("Missing")).toBeUndefined();
  });

  it("skips a stranger's private entry in favor of a readable current entry", () => {
    const app = lookupFixture();
    const readable = app.insert(app.host, "pending", "open");
    app.insert(app.other);
    expect(app.lookup("Friday Cup", app.viewer.userId)?.id).toBe(readable);
  });

  it("hides private entries until a grant or seat permits reading", () => {
    const app = lookupFixture();
    const id = app.insert(app.host);
    expect(app.lookup("Friday Cup", app.viewer.userId)).toBeUndefined();
    const grantTable = table === "drafts" ? "draft_invite_grants" : "tournament_invite_grants";
    const idColumn = table === "drafts" ? "draft_id" : "tournament_id";
    app.db.prepare(`insert into ${grantTable}(${idColumn},user_id) values(?,?)`).run(id, app.viewer.userId);
    expect(app.lookup("Friday Cup", app.viewer.userId)?.id).toBe(id);
    app.db.prepare(`delete from ${grantTable}`).run();
    const seats = table === "drafts" ? "draft_players" : "tournament_participants";
    app.db.prepare(`insert into ${seats}(${idColumn},player_id) values(?,?)`).run(id, app.viewer.playerId);
    expect(app.lookup("Friday Cup", app.viewer.userId)?.id).toBe(id);
  });

  it("keeps a readable finished entry available when there is no current entry", () => {
    const app = lookupFixture();
    const id = app.insert(app.host, "cancelled");
    expect(app.lookup("Friday Cup", app.host.userId)?.id).toBe(id);
    expect(app.lookup("Friday Cup", app.viewer.userId)).toBeUndefined();
  });
});

describe("per-host name migration", () => {
  function assertIndexes(db: Database.Database) {
    for (const table of ["drafts", "tournaments"]) {
      const indexes = db.pragma(`index_list(${table})`) as Array<{ name: string; unique: number; partial: number }>;
      expect(indexes.some(index => index.name === `${table}_current_name_unique`)).toBe(false);
      expect(indexes).toContainEqual(expect.objectContaining({ name: `${table}_current_host_name_unique`, unique: 1, partial: 1 }));
      expect((db.pragma(`index_info(${table}_current_host_name_unique)`) as Array<{ name: string }>).map(column => column.name))
        .toEqual(["guild_id", "created_by_user_id", "name"]);
    }
  }

  it("upgrades populated old indexes and reruns after different hosts share a name", () => {
    const { db, host, other } = setup();
    db.exec(`
      drop index if exists drafts_current_host_name_unique;
      drop index if exists tournaments_current_host_name_unique;
      create unique index if not exists drafts_current_name_unique on drafts(guild_id,name) where status in ('pending','active');
      create unique index if not exists tournaments_current_name_unique on tournaments(guild_id,name) where status in ('pending','active');
    `);
    db.prepare("insert into drafts(guild_id,name,status,created_by_user_id) values('g','Cup','pending',?)").run(host.userId);
    db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('g','Cup','round_robin','active',?,'old-cup')").run(host.userId);
    const before = [db.prepare("select * from drafts").all(), db.prepare("select * from tournaments").all()];
    migrate(db);
    assertIndexes(db);
    expect([db.prepare("select * from drafts").all(), db.prepare("select * from tournaments").all()]).toEqual(before);
    db.prepare("insert into drafts(guild_id,name,status,created_by_user_id) values('g','Cup','active',?)").run(other.userId);
    db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id) values('g','Cup','round_robin','pending',?)").run(other.userId);
    migrate(db);
    assertIndexes(db);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("upgrades the frozen pre-identity schema with its old indexes", () => {
    const db = new Database(":memory:"); handles.push(db);
    db.exec(readFileSync(new URL("../db/fixtures/pre-identity.sql", import.meta.url), "utf8"));
    db.exec(`insert into tournaments(guild_id,name,format,status,created_by_user_id) values('g','Cup','round_robin','pending','900000000000000101');
      insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values('g','ch','Cup','active','900000000000000101');`);
    migrate(db); migrate(db);
    assertIndexes(db);
    expect(db.prepare("select name,status from tournaments").get()).toEqual({ name: "Cup", status: "pending" });
    expect(db.prepare("select name,status from drafts").get()).toEqual({ name: "Cup", status: "active" });
  });

  it("removes the ancient table-wide tournament constraint and supports fresh databases", () => {
    const db = new Database(":memory:"); handles.push(db);
    db.exec(`create table tournaments(id integer primary key autoincrement, guild_id text not null, name text not null,
      format text not null, status text not null, created_by_user_id text not null,
      created_at text not null default current_timestamp, started_at text, ended_at text, unique (guild_id, name));
      insert into tournaments(guild_id,name,format,status,created_by_user_id) values('g','Cup','round_robin','completed','900000000000000101');`);
    migrate(db); migrate(db);
    assertIndexes(db);
    expect((db.prepare("select sql from sqlite_master where name='tournaments'").get() as { sql: string }).sql)
      .not.toMatch(/unique\s*\(guild_id,\s*name\)/i);
    const user = db.prepare("select created_by_user_id as id from tournaments").get() as { id: number };
    expect(() => db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id) values('g','Cup','round_robin','pending',?)").run(user.id)).not.toThrow();
    assertIndexes(setup().db);
  });
});

describe("tournament from draft names", () => {
  it.each(["pending", "active", "completed", "cancelled"])("ignores another host's %s tournament with the draft's name", (status) => {
    const { db, host, other } = setup();
    const draft = createDraftService(db).create("g", null, "Cup", { customCardIds: [1], packsPerPlayer: 1, packSize: 1 }, host.userId, host.playerId);
    db.prepare("update drafts set status='completed' where id=?").run(draft.id);
    const existing = createTournamentService(db).create("g", "Cup", "round_robin", other.userId);
    db.prepare("update tournaments set status=? where id=?").run(status, existing.id);
    const result = createDraftTournamentService(db).createTournamentFromDraft({ draftId: draft.id, format: "round_robin", createdByUserId: host.userId });
    expect(result.tournamentId).not.toBe(existing.id);
    expect(result.tournamentName).toBe("Cup");
  });

  it.each(["pending", "active", "completed", "cancelled"])("checks only the host's own %s tournaments", (status) => {
    const { db, host } = setup();
    const draft = createDraftService(db).create("g", null, "Cup", { customCardIds: [1], packsPerPlayer: 1, packSize: 1 }, host.userId, host.playerId);
    db.prepare("update drafts set status='completed' where id=?").run(draft.id);
    const existing = createTournamentService(db).create("g", "Cup", "round_robin", host.userId);
    db.prepare("update tournaments set status=? where id=?").run(status, existing.id);
    const create = () => createDraftTournamentService(db).createTournamentFromDraft({ draftId: draft.id, format: "round_robin", createdByUserId: host.userId });
    if (status === "pending" || status === "active") {
      expect(create).toThrow("You already have a tournament called this that hasn't finished.");
      expect(db.prepare("select tournament_id from drafts where id=?").get(draft.id)).toEqual({ tournament_id: null });
    } else {
      expect(create().tournamentId).not.toBe(existing.id);
    }
  });
});
