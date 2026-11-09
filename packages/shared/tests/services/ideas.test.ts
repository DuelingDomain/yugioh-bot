import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createIdeaService } from "../../src/services/ideas.js";

let db: Database.Database;
let service: ReturnType<typeof createIdeaService>;
beforeEach(() => {
  vi.stubEnv("DISCORD_GUILD_ID", "g"); vi.stubEnv("OWNER_USER_IDS", "1");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  db = new Database(":memory:"); migrate(db); db.pragma("foreign_keys=on");
  for (let id = 1; id <= 8; id++) {
    db.prepare("insert into users(id,username,display_name) values(?,?,?)").run(id, `user${id}`, `User ${id}`);
    db.prepare("insert into players(id,guild_id,user_id,display_name) values(?,'g',?,?)").run(id, id, `Player ${id}`);
  }
  service = createIdeaService(db);
});
afterEach(() => { expect(db.pragma("foreign_key_check")).toEqual([]); db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

function idea(state = "open", author: number | null = 1, extra: { guild?: string; created?: string; show?: number } = {}) {
  return Number(db.prepare(`insert into ideas(guild_id,title,area,author_user_id,show_author,state,created_at)
    values(?,'An idea','App',?,?,?,?)`).run(extra.guild ?? "g", author, extra.show ?? 0, state, extra.created ?? new Date().toISOString()).lastInsertRowid);
}
function played(user = 2, status = "completed", guild = "g", kind = "play") {
  const id = Number(db.prepare("insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,kind) values(?,?,'Game',?,'normal',?,?)")
    .run(guild, `duel-${user}-${status}-${guild}-${kind}`, user, status, kind).lastInsertRowid);
  db.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,0,?)").run(id, user);
  return id;
}
function vote(id: number, user: number, value: number) { db.prepare("insert into idea_votes(idea_id,user_id,value) values(?,?,?)").run(id, user, value); }
const input = { title: "A useful feature", pitch: "One line", area: "App" as const, showAuthor: true };

it("migrates idempotently and enforces enum, title and foreign-key constraints", () => {
  migrate(db);
  expect(() => idea("invalid")).toThrow(/CHECK/);
  const id = idea();
  expect(() => vote(id, 2, 0)).toThrow(/CHECK/);
  expect(() => db.prepare("update ideas set title=? where id=?").run("x".repeat(81), id)).toThrow(/CHECK/);
  expect(() => db.exec("insert into user_permissions(user_id,permission) values(1,'admin')")).toThrow(/CHECK/);
});
it("ranks by score, more up, older timestamp and stable ID; hides foreign and other private ideas", () => {
  const old = idea("open", 1, { created: "2026-10-01T00:00:00Z" });
  const moreUp = idea(); const best = idea(); const newest = idea();
  vote(old, 2, 1); vote(moreUp, 2, 1); vote(moreUp, 3, 1); vote(moreUp, 4, -1);
  vote(best, 2, 1); vote(best, 3, 1); vote(newest, 2, 1);
  const waiting = idea("waiting", 2); const declined = idea("declined", 2); const ip = idea("in_progress");
  idea("waiting", 3); idea("declined", 3); idea("open", 1, { guild: "other" });
  const board = service.board(2);
  expect(board.open.map(i => [i.id, i.score, i.rank, i.viewerVote])).toEqual([[best,2,1,1],[moreUp,1,2,1],[old,1,3,1],[newest,1,4,1]]);
  expect(board.inProgress.map(i => i.id)).toEqual([ip]);
  expect(board.yourIdeas.map(i => i.id).sort()).toEqual([waiting, declined].sort());
});
it("requires a completed seated duel, ignoring cancelled, interrupted, spectator, foreign and replay-fork games", () => {
  played(2, "cancelled"); played(2, "interrupted"); played(2, "completed", "other"); played(3);
  played(2,"completed","g","replay-fork");
  expect(service.board(2)).toMatchObject({ canVote: false, canPost: false, voteReason: "not_played_yet", postReason: "not_played_yet" });
  expect(() => service.post(2, input)).toThrow("not_played_yet");
  played(2);
  expect(service.board(2)).toMatchObject({ canVote: true, canPost: true, voteReason: null });
});
it("accepts a completed draft participant, even if pool exhaustion left finished_at null", () => {
  db.exec("insert into drafts(id,guild_id,name,status,created_by_user_id) values(1,'g','Draft','cancelled',1); insert into draft_players(draft_id,player_id) values(1,2)");
  expect(service.board(2).canVote).toBe(false);
  db.exec("update drafts set status='completed' where id=1");
  expect(service.board(2).canVote).toBe(true);
});
it("accepts completed approved tournament results for either participant, excluding byes and unapproved reports", () => {
  db.exec(`insert into tournaments(id,guild_id,name,format,status,created_by_user_id) values(1,'g','Cup','round_robin','active',1);
    insert into tournament_matches(id,tournament_id,player_one_id,player_two_id,round_number,status) values(1,1,2,null,1,'completed');`);
  expect(service.board(2).canVote).toBe(false);
  db.exec(`insert into matches(id,guild_id,player_one_id,player_two_id,reporter_id,status,source,tournament_id) values(1,'g',2,3,2,'pending','tournament',1);
    update tournament_matches set player_two_id=3,match_id=1 where id=1;`);
  expect(service.board(2).canVote).toBe(false);
  db.exec("update matches set status='approved' where id=1");
  expect(service.board(2).canVote).toBe(true); expect(service.board(3).canVote).toBe(true);
});
it("posts waiting ideas and enforces three posts in a rolling 24 hours, including rejected ideas", () => {
  played();
  const first = service.post(2, input).idea;
  expect(first).toMatchObject({ state: "waiting", team: false, authorName: null, isOwn: true });
  service.decide(1, first.id, { action: "decline", reason: "Not for now" });
  service.post(2, input); service.post(2, input);
  expect(service.board(2)).toMatchObject({ canVote: true, canPost: false, postReason: "daily_limit" });
  expect(() => service.post(2, input)).toThrow("daily_limit");
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(service.post(2, input).idea.state).toBe("waiting");
});
it("team permission and configured owners skip waiting but still need the completion gate", () => {
  expect(() => service.post(1, input)).toThrow("not_played_yet");
  played(1); played(2);
  db.exec("insert into user_permissions(user_id,permission) values(2,'ideas_team')");
  for (const user of [1,2]) expect(service.post(user, input).idea).toMatchObject({ state: "open", team: true, approvedAt: expect.any(String) });
});
it("validates posts, votes, prompt locations and owner action text in the service", () => {
  played(); const id = idea();
  for (const bad of [{ ...input, title: " " }, { ...input, title: "x".repeat(81) }, { ...input, pitch: "x\ny" }, { ...input, area: "Other" }, { ...input, showAuthor: 1 }]) {
    expect(() => service.post(2, bad as never)).toThrow("invalid_body");
  }
  expect(() => service.vote(2, id, 2 as never)).toThrow("invalid_body");
  expect(() => service.prompt(2, "other" as never)).toThrow("invalid_at");
  expect(() => service.decide(1, id, { action: "done", note: "x".repeat(141) })).toThrow("invalid_body");
});
it("switches votes, toggles the same vote off and clears with zero, returning new rank", () => {
  played(); const id = idea(); idea();
  expect(service.vote(2, id, -1)).toMatchObject({ up: 0, down: 1, score: -1, rank: 2, viewerVote: -1 });
  expect(service.vote(2, id, 1)).toMatchObject({ up: 1, down: 0, score: 1, rank: 1, viewerVote: 1 });
  expect(service.vote(2, id, 1)).toMatchObject({ up: 0, down: 0, viewerVote: 0 });
  service.vote(2, id, -1);
  expect(service.vote(2, id, 0)).toMatchObject({ down: 0, viewerVote: 0 });
  expect(service.vote(2, id, 0)).toMatchObject({ down: 0, viewerVote: 0 });
});
it("blocks own ideas, closed voting and ideas in another guild", () => {
  played();
  expect(() => service.vote(2, idea("open",2), 1)).toThrow("own_idea");
  for (const state of ["waiting","declined","in_progress","done"]) expect(() => service.vote(2, idea(state), 1)).toThrow("not_open");
  expect(() => service.vote(2, idea("open",1,{guild:"other"}), 1)).toThrow("not_found");
});
it("uses player display names only after approval and only with author consent; owner queue always sees them", () => {
  const shown = idea("open",2,{show:1}); const hidden = idea("open",2); const waiting = idea("waiting",2,{show:1});
  const b = service.board(2);
  expect(b.open.find(i => i.id === shown)?.authorName).toBe("Player 2");
  expect(b.open.find(i => i.id === hidden)?.authorName).toBeNull();
  expect(b.yourIdeas.find(i => i.id === waiting)?.authorName).toBeNull();
  expect(service.queue().waiting[0].authorName).toBe("Player 2");
  service.decide(1, waiting, {action:"approve"});
  expect(service.board(3).open.find(i => i.id === waiting)?.authorName).toBe("Player 2");
});
it("prompts newest unvoted open idea, excludes own ideas, includes rank and open total, and claims once per 24h", () => {
  played(); const old = idea("open",1,{created:"2026-10-01"}); const fresh = idea();
  idea("open",2); idea("in_progress");
  expect(service.prompt(2,"duel")).toMatchObject({ idea: { id:fresh, rank:2 }, openTotal:3 });
  expect(service.prompt(2,"draft")).toBeNull();
  vi.advanceTimersByTime(24*60*60*1000-1); expect(service.prompt(2,"tournament")).toBeNull();
  vi.advanceTimersByTime(1); service.vote(2,fresh,1);
  expect(service.prompt(2,"draft")?.idea.id).toBe(old);
});
it("does not consume prompt time if ineligible or there is nothing to show", () => {
  idea("open",2); expect(service.prompt(2,"duel")).toBeNull(); played();
  expect(service.prompt(2,"duel")).toBeNull();
  expect(db.prepare("select ideas_prompt_at from users where id=2").get()).toEqual({ideas_prompt_at:null});
});
it("compares SQLite and ISO timestamps as UTC when choosing the newest prompt", () => {
  vi.stubEnv("TZ", "America/Toronto");
  played();
  idea("open", 1, {created:"2026-10-31 11:00:00"});
  const newest = idea("open", 1, {created:"2026-10-31T12:00:00Z"});
  expect(service.prompt(2,"duel")?.idea.id).toBe(newest);
});
it("scopes notices, Done and owner decisions to the configured guild", () => {
  const local = idea("done", 2); const foreign = idea("done", 2, {guild:"other"});
  db.prepare("insert into idea_notices(user_id,idea_id,kind) values(2,?,'done'),(2,?,'done')").run(local,foreign);
  expect(service.board(2).notices.map(n=>n.ideaId)).toEqual([local]);
  expect(service.markNoticesRead(2)).toEqual({markedRead:1});
  expect(db.prepare("select read_at from idea_notices where idea_id=?").get(foreign)).toEqual({read_at:null});
  expect(service.done(2).weeks.flatMap(w=>w.ideas.map(i=>i.id))).toEqual([local]);
  expect(service.queue().counts.done).toBe(1);
  expect(() => service.decide(1,foreign,{action:"done"})).toThrow("not_found");
});
it("approves, starts and completes once; notifies up-voters and author exactly once, never down-voters", () => {
  const id = idea("waiting",2,{show:1});
  expect(service.decide(1,id,{action:"approve"})).toMatchObject({status:"ok",idea:{state:"open"},noticesSent:0});
  vote(id,2,1); vote(id,3,1); vote(id,4,-1);
  service.decide(1,id,{action:"start"});
  expect(service.decide(1,id,{action:"done",note:"Now shipped"})).toMatchObject({status:"ok",idea:{state:"done",doneNote:"Now shipped"},noticesSent:2});
  expect(service.decide(1,id,{action:"done"})).toMatchObject({status:"already_decided",noticesSent:0});
  expect(service.board(2).notices).toEqual([expect.objectContaining({ideaId:id,kind:"done",note:"Now shipped",title:"An idea"})]);
  expect(service.board(3).notices).toHaveLength(1); expect(service.board(4).notices).toHaveLength(0);
  expect(service.markNoticesRead(2)).toEqual({markedRead:1}); expect(service.markNoticesRead(2)).toEqual({markedRead:0});
});
it("declines with preset and optional line; accepts a typed reason; wrong states conflict and nonowners are denied", () => {
  const id = idea("waiting",2);
  expect(() => service.decide(2,id,{action:"approve"})).toThrow("not_found");
  const result = service.decide(1,id,{action:"decline",reason:"Not for now",line:"We will revisit this."});
  expect(result.idea.declineReason).toBe("Not for now: We will revisit this.");
  expect(service.board(2).notices[0].note).toBe(result.idea.declineReason);
  expect(service.decide(1,id,{action:"decline",reason:"Not for now"}).status).toBe("already_decided");
  expect(service.decide(1,id,{action:"approve"}).status).toBe("conflict");
  const typed = idea("waiting",2);
  expect(service.decide(1,typed,{action:"decline",reason:"A typed reason"}).idea.declineReason).toBe("A typed reason");
});
it.each(["waiting","open","in_progress","done","declined"])("every invalid owner transition from %s is an expected conflict", state => {
  const valid: Record<string,string[]> = {waiting:["approve","decline"],open:["start"],in_progress:["done"],done:[],declined:[]};
  for (const action of ["approve","decline","start","done"] as const) {
    if (valid[state].includes(action)) continue;
    const result = service.decide(1,idea(state),{action,reason:"Not for now"} as never);
    expect(["already_decided","conflict"]).toContain(result.status);
  }
});
it("rolls back Done and prompt timestamp together with their transactional effects on failure", () => {
  const id = idea("in_progress",2);
  db.exec("create trigger fail_notice before insert on idea_notices begin select raise(abort,'notice unavailable'); end");
  expect(() => service.decide(1,id,{action:"done"})).toThrow("notice unavailable");
  expect(service.queue().inProgress.map(i => i.id)).toContain(id);
  expect(db.prepare("select count(*) as n from idea_notices").get()).toEqual({n:0});
  played(); idea();
  db.exec("create trigger fail_prompt before update of ideas_prompt_at on users begin select raise(abort,'prompt unavailable'); end");
  expect(() => service.prompt(2,"duel")).toThrow("prompt unavailable");
  expect(db.prepare("select ideas_prompt_at from users where id=2").get()).toEqual({ideas_prompt_at:null});
});
it("groups Done by UTC Monday weeks, newest first, and includes historical shipped rows", () => {
  const sunday = idea("done"); const monday = idea("done"); const seed = idea("done");
  db.prepare("update ideas set done_at=? where id=?").run("2026-10-25T23:59:59Z",sunday);
  db.prepare("update ideas set done_at=? where id=?").run("2026-10-26T00:00:00Z",monday);
  db.prepare("update ideas set shipped_before_board=1,shipped_week='2026-09-28' where id=?").run(seed);
  expect(service.done(2).weeks.map(w => [w.week,w.ideas.map(i => i.id)])).toEqual([["2026-10-26",[monday]],["2026-10-19",[sunday]],["2026-09-28",[seed]]]);
});
