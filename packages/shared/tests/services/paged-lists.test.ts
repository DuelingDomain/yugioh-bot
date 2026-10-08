import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { findDraftListPage, findTournamentListPage, findDraftListStatusCounts, findTournamentListStatusCounts, InvalidListCursorError } from "../../src/services/index.js";
let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  db.exec("insert into users(id,username,display_name) values(101,'viewer','Viewer'),(102,'other','Other'); insert into players(id,guild_id,user_id,display_name) values(1,'g',101,'Viewer'),(2,'other-guild',101,'Viewer'),(3,'g',102,'Other')");
  const draft = db.prepare("insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at,config_json) values(?,'g','c',?,?,101,?,'2026-10-01 12:00:00',?)");
  const cup = db.prepare("insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug,created_at) values(?,'g',?,'round_robin',?,101,?,'2026-10-01 12:00:00')");
  const statuses = ["active", "pending", "completed", "cancelled"];
  for (let i = 1; i <= 52; i++) {
    const status = statuses[Math.floor((i-1)/13)];
    draft.run(i,`Draft ${i}`,status,`draft-${i}`, JSON.stringify({mode: i===13 ? "theme" : "booster"}));
    db.prepare("insert into draft_players(draft_id,player_id) values(?,1)").run(i);
    cup.run(i,`Cup ${i}`,status,`cup-${i}`);
  }
  db.prepare("insert into tournament_participants(tournament_id,player_id) values(13,1),(13,3)").run();
});
afterEach(() => db.close());
describe("paged draft and tournament lists", () => {
  it("paginates drafts across status boundaries with descending ID ties and no skips", () => {
    const first = findDraftListPage(db,"g",101);
    expect(first.items.map(r=>r.id)).toEqual([13,12,11,10,9,8,7,6,5,4,3,2,1,26,25,24,23,22,21,20,19,18,17,16,15]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = findDraftListPage(db,"g",101,first.nextCursor!);
    expect(second.items.map(r=>r.id)).toEqual([14,39,38,37,36,35,34,33,32,31,30,29,28,27,52,51,50,49,48,47,46,45,44,43,42]);
    const last = findDraftListPage(db,"g",101,second.nextCursor!);
    expect(last.items.map(r=>r.id)).toEqual([41,40]);
    expect(last.nextCursor).toBeNull();
    expect(first.items[0]).toMatchObject({id:13, guildId:"g",name:"Draft 13",status:"active",mode:"theme",webSlug:"draft-13",playerCount:1,currentPackRound:0,currentPickStep:0,createdAt:"2026-10-01 12:00:00"});
  });
  it("paginates tournaments, excluding cancelled rows and retaining participant counts", () => {
    const first = findTournamentListPage(db,"g",101);
    expect(first.items.map(r=>r.id)).toEqual([13,12,11,10,9,8,7,6,5,4,3,2,1,26,25,24,23,22,21,20,19,18,17,16,15]);
    expect(first.items[0]).toEqual({id:13,guildId:"g",name:"Cup 13",format:"round_robin",status:"active",createdByUserId:101,webSlug:"cup-13",participantCount:2});
    const last = findTournamentListPage(db,"g",101,first.nextCursor!);
    expect(last.items.map(r=>r.id)).toEqual([14,39,38,37,36,35,34,33,32,31,30,29,28,27]);
    expect(last.nextCursor).toBeNull();
  });
  it("sorts by newest creation time before the ID tie-break", () => {
    db.exec("update drafts set created_at='2026-10-02 12:00:00' where id=1; update tournaments set created_at='2026-10-02 12:00:00' where id=1");
    expect(findDraftListPage(db,"g",101).items.slice(0,3).map(r=>r.id)).toEqual([1,13,12]);
    expect(findTournamentListPage(db,"g",101).items.slice(0,3).map(r=>r.id)).toEqual([1,13,12]);
  });
  it("remains stable when a newer row is inserted before a saved cursor", () => {
    const first = findDraftListPage(db,"g",101);
    db.exec("insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at) values('g','c','New','active',101,'new','2026-10-02 12:00:00'); insert into draft_players(draft_id,player_id) values(53,1)");
    expect(findDraftListPage(db,"g",101,first.nextCursor!).items[0].id).toBe(14);
  });
  it("returns no cursor when exactly one full page remains", () => {
    db.exec("delete from tournament_participants; delete from tournaments where id>25; delete from draft_players where draft_id>25; delete from drafts where id>25");
    expect(findDraftListPage(db,"g",101).items).toHaveLength(25);
    expect(findDraftListPage(db,"g",101).nextCursor).toBeNull();
    expect(findTournamentListPage(db,"g",101).nextCursor).toBeNull();
  });
  it("scopes draft membership and both lists to the guild", () => {
    db.exec("insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug) values('other-guild','c','Other','active',101,'other'); insert into draft_players(draft_id,player_id) values(53,2); insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('other-guild','Other','round_robin','active',101,'other')");
    expect(findDraftListPage(db,"g",102).items).toEqual([]);
    expect(findDraftListPage(db,"g",102).nextCursor).toBeNull();
    expect(findDraftListPage(db,"other-guild",101).items.map(r=>r.id)).toEqual([53]);
    expect(findTournamentListPage(db,"other-guild",101).items.map(r=>r.id)).toEqual([53]);
    const drafts = findDraftListPage(db,"g",101);
    const cups = findTournamentListPage(db,"g",101);
    expect(()=>findDraftListPage(db,"other-guild",101,drafts.nextCursor!)).toThrow(InvalidListCursorError);
    expect(()=>findTournamentListPage(db,"other-guild",101,cups.nextCursor!)).toThrow(InvalidListCursorError);
    expect(()=>findDraftListPage(db,"g",102,drafts.nextCursor!)).toThrow(InvalidListCursorError);
    expect(()=>findTournamentListPage(db,"g",101,drafts.nextCursor!)).toThrow(InvalidListCursorError);
  });
  it.each(["", "not-a-cursor", "%%%", "e30", "W10", "A".repeat(5000)])("rejects invalid cursors: %s", cursor => {
    expect(()=>findDraftListPage(db,"g",101,cursor)).toThrow(InvalidListCursorError);
    expect(()=>findTournamentListPage(db,"g",101,cursor)).toThrow(InvalidListCursorError);
  });
});

describe("full-list status counts", () => {
  it("counts all 52 visible drafts, including completed and cancelled rows beyond the first page", () => {
    expect(findDraftListStatusCounts(db, "g", 101)).toEqual({ active: 13, pending: 13, completed: 13, cancelled: 13 });
  });
  it("restricts draft counts to the guild and the viewer's membership in that guild", () => {
    db.exec("insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id) values(53,'g','c','Other player','active',102),(54,'other-guild','c','Other guild','pending',101),(55,'g','c','Wrong guild seat','completed',101); insert into draft_players(draft_id,player_id) values(53,3),(54,1),(54,2),(55,2)");
    expect(findDraftListStatusCounts(db, "g", 101)).toEqual({ active: 13, pending: 13, completed: 13, cancelled: 13 });
    expect(findDraftListStatusCounts(db, "g", 102)).toEqual({ active: 1, pending: 0, completed: 0, cancelled: 0 });
    expect(findDraftListStatusCounts(db, "other-guild", 101)).toEqual({ active: 0, pending: 1, completed: 0, cancelled: 0 });
  });
  it("counts all 39 listed tournaments without requiring a participant seat", () => {
    db.exec("insert into tournaments(guild_id,name,format,status,created_by_user_id) values('other-guild','Other guild','round_robin','active',101)");
    expect(findTournamentListStatusCounts(db, "g")).toEqual({ active: 13, pending: 13, completed: 13, cancelled: 0 });
    expect(findTournamentListStatusCounts(db, "other-guild")).toEqual({ active: 1, pending: 0, completed: 0, cancelled: 0 });
  });
  it("returns zero counts when the viewer or guild has no visible rows", () => {
    const empty = { active: 0, pending: 0, completed: 0, cancelled: 0 };
    expect(findDraftListStatusCounts(db, "g", 102)).toEqual(empty);
    expect(findDraftListStatusCounts(db, "missing", 101)).toEqual(empty);
    expect(findTournamentListStatusCounts(db, "missing")).toEqual(empty);
  });
});
