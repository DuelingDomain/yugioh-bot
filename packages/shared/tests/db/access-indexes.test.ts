import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
let db: Database.Database;
beforeEach(() => { db = new Database(":memory:"); migrate(db); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });
const indexes = () => (db.prepare("select name from sqlite_master where type='index'").all() as { name: string }[]).map(r => r.name);
const addDraft = (slug: string | null, name: string) => db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug) values('g','c',?,'completed',101,?)").run(name,slug);
describe("access and list indexes", () => {
  it("creates the unique partial slug index and all lookup indexes idempotently", () => {
    db.exec("insert into users(id,username,display_name) values(101,'host','Host')");
    addDraft("unique-slug", "One"); addDraft(null, "Two"); addDraft(null, "Three");
    migrate(db); migrate(db);
    expect(indexes()).toEqual(expect.arrayContaining([
      "drafts_web_slug_unique", "draft_players_player_idx", "tournament_participants_player_idx",
      "drafts_guild_status_created_idx", "tournaments_guild_status_created_idx", "players_user_idx",
    ]));
    expect(() => addDraft("unique-slug", "Duplicate")).toThrow(/unique/i);
    const playerIndexes = db.pragma("index_list(players)") as { name: string; unique: number }[];
    expect(playerIndexes.some(i => i.unique && JSON.stringify((db.pragma(`index_info(${i.name})`) as { name: string }[]).map(c => c.name)) === '["guild_id","user_id"]')).toBe(true);
    expect(db.pragma("index_info(tournament_participants_player_idx)")).toMatchObject([{ name: "player_id" }]);
  });
  it("falls back to a non-unique index for duplicate non-null slugs without logging their values", () => {
    // Simulate production data before the index exists.
    db.exec("drop index if exists drafts_web_slug_unique; insert into users(id,username,display_name) values(101,'host','Host')");
    addDraft("sensitive-slug", "One"); addDraft("sensitive-slug", "Two");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    migrate(db); migrate(db);
    expect(indexes()).toContain("drafts_web_slug_idx");
    expect(indexes()).not.toContain("drafts_web_slug_unique");
    expect(warning).toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive-slug");
    expect((db.pragma("index_list(drafts)") as {name:string;unique:number;partial:number}[]).find(i => i.name === "drafts_web_slug_idx")).toMatchObject({ unique: 0, partial: 0 });
    expect(db.prepare("select count(*) as n from drafts").get()).toEqual({ n: 2 });
  });
  it("upgrades the fallback after duplicates are reconciled", () => {
    db.exec("drop index if exists drafts_web_slug_unique; insert into users(id,username,display_name) values(101,'host','Host')");
    addDraft("duplicate", "One"); addDraft("duplicate", "Two");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    migrate(db);
    db.exec("update drafts set web_slug='repaired' where name='Two'");
    migrate(db); migrate(db);
    expect(indexes()).toContain("drafts_web_slug_unique");
    expect(() => addDraft("duplicate", "Three")).toThrow(/unique/i);
  });
  it.each(["unique", "fallback"])("preserves recognized list indexes during legacy identity migration: %s", (kind) => {
    db.close(); db = new Database(":memory:");
    db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
    db.exec(`create index drafts_guild_status_created_idx on drafts(guild_id,status,created_at);
      create index tournaments_guild_status_created_idx on tournaments(guild_id,status,created_at);
      create ${kind === "unique" ? "unique" : ""} index ${kind === "unique" ? "drafts_web_slug_unique" : "drafts_web_slug_idx"} on drafts(web_slug) where web_slug is not null;`);
    expect(() => migrate(db)).not.toThrow();
    expect(indexes()).toEqual(expect.arrayContaining(["drafts_guild_status_created_idx", "tournaments_guild_status_created_idx", "drafts_web_slug_unique"]));
  });
});
