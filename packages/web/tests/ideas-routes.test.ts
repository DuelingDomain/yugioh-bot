import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});

const ORIGIN = "https://ideas.example";
const postInput = { title: "A useful feature", pitch: "One short line", area: "App", showAuthor: true };
const actor = (id: number) => state.auth.mockResolvedValue({ user: { id: String(id), name: `User ${id}`, discordUserId: null } });
const context = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path: string, method = "GET", body?: unknown, origin: string | null = ORIGIN) => new Request(`${ORIGIN}${path}`, {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: origin === null ? {} : { origin },
});
const rawRequest = (path: string, method: string, body: string) => new Request(`${ORIGIN}${path}`, { method, body, headers: { origin: ORIGIN } });

async function board() { return (await import("../app/api/ideas/route")).GET(); }
async function post(body: unknown = postInput) { return (await import("../app/api/ideas/route")).POST(request("/api/ideas", "POST", body)); }
async function done() { return (await import("../app/api/ideas/done/route")).GET(); }
async function vote(id: string | number = 1, body: unknown = { value: 1 }) {
  return (await import("../app/api/ideas/[id]/vote/route")).PUT(request(`/api/ideas/${id}/vote`, "PUT", body), context(id));
}
async function readNotices() { return (await import("../app/api/ideas/notices/read/route")).POST(); }
async function prompt(query = "at=duel") { return (await import("../app/api/ideas/prompt/route")).GET(request(`/api/ideas/prompt?${query}`)); }
async function queue() { return (await import("../app/api/admin/console/ideas/route")).GET(); }
async function decide(id: string | number = 1, body: unknown = { action: "approve" }, origin: string | null = ORIGIN) {
  return (await import("../app/api/admin/console/ideas/[id]/route")).POST(request(`/api/admin/console/ideas/${id}`, "POST", body, origin), context(id));
}
const endpoints = [
  ["GET /api/ideas", board], ["POST /api/ideas", post], ["GET /api/ideas/done", done],
  ["PUT /api/ideas/[id]/vote", vote], ["POST /api/ideas/notices/read", readNotices],
  ["GET /api/ideas/prompt", prompt], ["GET /api/admin/console/ideas", queue], ["POST /api/admin/console/ideas/[id]", decide],
] as const;

function seedIdea(stateName = "open", author: number | null = 1, guild = "g") {
  return Number(state.db!.prepare(`insert into ideas(guild_id,title,area,author_user_id,show_author,state,created_at)
    values(?,'A board idea','App',?,1,?,'2026-10-30T12:00:00Z')`).run(guild, author, stateName).lastInsertRowid);
}
function played(user = 2) {
  const id = Number(state.db!.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status)
    values('g',?,'Completed game',?,'normal','completed')`).run(`played-${user}`, user).lastInsertRowid);
  state.db!.prepare("insert into duel_seats(duel_id,seat,player_id) values(?,0,?)").run(id, user);
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ error: code });
}

beforeEach(() => {
  vi.stubEnv("DISCORD_GUILD_ID", "g");
  vi.stubEnv("OWNER_USER_IDS", "1");
  vi.stubEnv("WEB_URL", `${ORIGIN}/`);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
  state.auth.mockReset(); actor(2);
  state.db = new Database(":memory:"); migrate(state.db); state.db.pragma("foreign_keys=on");
  for (const id of [1, 2, 3]) {
    state.db.prepare("insert into users(id,username,display_name) values(?,?,?)").run(id, `user-${id}`, `User ${id}`);
    state.db.prepare("insert into players(id,guild_id,user_id,display_name) values(?,'g',?,?)").run(id, id, `Player ${id}`);
  }
});
afterEach(() => { state.db?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe.each(endpoints)("%s access and cache contract", (_name, invoke) => {
  it("returns private 401 when signed out before parsing or mutation", async () => {
    state.auth.mockResolvedValue(null);
    await expectError(await invoke(), 401, "unauthorized");
    expect(state.db!.prepare("select count(*) as n from ideas").get()).toEqual({ n: 0 });
  });
  it("returns private 503 when the session cannot be resolved", async () => {
    state.auth.mockRejectedValue(new Error("identity unavailable"));
    await expectError(await invoke(), 503, "session_unavailable");
  });
  it("returns private 503 when the guild is not configured", async () => {
    actor(1); vi.stubEnv("DISCORD_GUILD_ID", "");
    await expectError(await invoke(), 503, "not_configured");
  });
});

describe("owner guard", () => {
  it("hides both owner routes from members, regardless of a forged body actor", async () => {
    await expectError(await queue(), 404, "not_found");
    await expectError(await decide(1, { action: "approve", userId: 1 }), 404, "not_found");
  });
  it("rereads OWNER_USER_IDS for every request", async () => {
    actor(1); expect((await queue()).status).toBe(200);
    vi.stubEnv("OWNER_USER_IDS", "3");
    await expectError(await queue(), 404, "not_found");
    await expectError(await decide(), 404, "not_found");
  });
  it.each([null, "null", "https://other.example", `${ORIGIN}/`, `${ORIGIN}/path`])("rejects Origin %j", async origin => {
    actor(1); const id = seedIdea("waiting", 2);
    await expectError(await decide(id, { action: "approve" }, origin), 403, "invalid_origin");
    expect(state.db!.prepare("select state from ideas where id=?").get(id)).toEqual({ state: "waiting" });
  });
  it.each(["", "not a URL", "javascript:alert(1)", "https://user:password@ideas.example"])("refuses a mutation with WEB_URL %j", async webUrl => {
    actor(1); vi.stubEnv("WEB_URL", webUrl);
    await expectError(await decide(), 403, "invalid_origin");
  });
});

describe("request validation", () => {
  it.each(["0", "-1", "1.2", "1e2", "1x", "+1", "01", "9007199254740992", "99999999999999999999999"])("rejects a noncanonical or unsafe idea ID %s on both ID routes", async id => {
    await expectError(await vote(id), 400, "invalid_id");
    actor(1); await expectError(await decide(id), 400, "invalid_id");
  });
  it.each([
    null, [], {}, true, { ...postInput, title: " " }, { ...postInput, title: 12 },
    { ...postInput, title: "x".repeat(81) }, { ...postInput, title: "two\nlines" },
    { ...postInput, pitch: 5 }, { ...postInput, pitch: "x".repeat(141) }, { ...postInput, pitch: "two\rline" },
    { ...postInput, area: "unknown" }, { ...postInput, showAuthor: "true" }, { ...postInput, showAuthor: 1 },
  ])("rejects an invalid post %j", async body => {
    played(); await expectError(await post(body), 400, "invalid_body");
    expect(state.db!.prepare("select count(*) as n from ideas").get()).toEqual({ n: 0 });
  });
  it.each([null, [], {}, true, { value: true }, { value: false }, { value: 0.5 }, { value: 2 }, { value: -2 }, { value: "1" }, { value: null }])("rejects an invalid vote %j", async body => {
    const id = seedIdea(); played();
    await expectError(await vote(id, body), 400, "invalid_body");
    expect(state.db!.prepare("select count(*) as n from idea_votes").get()).toEqual({ n: 0 });
  });
  it.each([
    null, [], {}, true, { action: "delete" }, { action: ["approve"] },
    { action: "decline" }, { action: "decline", reason: " " }, { action: "decline", reason: false },
    { action: "decline", reason: "x".repeat(141) }, { action: "decline", reason: "Not for now", line: null },
    { action: "decline", reason: "Not for now", line: "two\nlines" },
    { action: "done", note: false }, { action: "done", note: "x".repeat(141) },
  ])("rejects an invalid owner decision %j", async body => {
    actor(1); const id = seedIdea("waiting", 2);
    await expectError(await decide(id, body), 400, "invalid_body");
    expect(state.db!.prepare("select state from ideas where id=?").get(id)).toEqual({ state: "waiting" });
  });
  it.each([
    ["malformed", "{bad"], ["empty", ""],
    ["oversized", JSON.stringify({ ...postInput, action: "approve", value: 1, padding: "x".repeat(16 * 1024) })],
  ])("treats %s JSON as invalid_body on all JSON endpoints", async (_name, body) => {
    const { POST } = await import("../app/api/ideas/route");
    const { PUT } = await import("../app/api/ideas/[id]/vote/route");
    const ownerRoute = await import("../app/api/admin/console/ideas/[id]/route");
    await expectError(await POST(rawRequest("/api/ideas", "POST", body)), 400, "invalid_body");
    await expectError(await PUT(rawRequest("/api/ideas/1/vote", "PUT", body), context(1)), 400, "invalid_body");
    actor(1);
    await expectError(await ownerRoute.POST(rawRequest("/api/admin/console/ideas/1", "POST", body), context(1)), 400, "invalid_body");
  });
  it.each(["", "at=", "at=other", "at=DUEL", "at=duel%20", "at=duel&at=draft"])("rejects prompt query %j without claiming a prompt", async query => {
    played(); seedIdea();
    await expectError(await prompt(query), 400, "invalid_at");
    expect(state.db!.prepare("select ideas_prompt_at from users where id=2").get()).toEqual({ ideas_prompt_at: null });
  });
});

describe("successful HTTP responses", () => {
  it("posts trimmed text using session identity and ignores forged owner, guild, team and state fields", async () => {
    played();
    const response = await post({ ...postInput, title: "  A useful feature  ", pitch: "  One line  ", userId: 1, authorUserId: 1, guildId: "other", team: true, state: "open" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ idea: { title: "A useful feature", pitch: "One line", state: "waiting", isOwn: true, team: false, authorName: null, rank: null, viewerVote: 0 } });
    expect(state.db!.prepare("select author_user_id,guild_id,team,state from ideas").get()).toEqual({ author_user_id: 2, guild_id: "g", team: 0, state: "waiting" });
    const result = await (await board()).json();
    expect(Object.keys(result).sort()).toEqual(["canPost", "canVote", "inProgress", "notices", "open", "postReason", "voteReason", "yourIdeas"]);
    expect(result).toMatchObject({ inProgress: [], open: [], notices: [], canVote: true, canPost: true, voteReason: null, postReason: null, yourIdeas: [{ title: "A useful feature" }] });
  });
  it("lets a qualified owner post a Team idea directly to Open", async () => {
    actor(1); played(1);
    expect(await (await post({ ...postInput, pitch: null })).json()).toMatchObject({ idea: { state: "open", team: true, pitch: null, rank: 1 } });
  });
  it("serves the board scoped to this guild and exposes the activity gate without blocking reads", async () => {
    const openId = seedIdea(); const progressId = seedIdea("in_progress"); const ownId = seedIdea("waiting", 2);
    seedIdea("waiting", 3); seedIdea("declined", 3); seedIdea("open", 1, "other");
    const response = await board();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data).toMatchObject({ canVote: false, canPost: false, voteReason: "not_played_yet", postReason: "not_played_yet" });
    expect(data.open.map((idea: { id: number }) => idea.id)).toEqual([openId]);
    expect(data.inProgress.map((idea: { id: number }) => idea.id)).toEqual([progressId]);
    expect(data.yourIdeas.map((idea: { id: number }) => idea.id)).toEqual([ownId]);
    expect(data.open[0]).toMatchObject({ authorName: "Player 1", up: 0, down: 0, score: 0, rank: 1 });
  });
  it("accepts all three numeric vote values and returns counts and ordinal rank", async () => {
    played(); const id = seedIdea(); seedIdea();
    for (const [value, expected] of [
      [-1, { up: 0, down: 1, score: -1, rank: 2, viewerVote: -1 }],
      [1, { up: 1, down: 0, score: 1, rank: 1, viewerVote: 1 }],
      [1, { up: 0, down: 0, score: 0, rank: 1, viewerVote: 0 }],
      [-1, { up: 0, down: 1, score: -1, rank: 2, viewerVote: -1 }],
      [0, { up: 0, down: 0, score: 0, rank: 1, viewerVote: 0 }],
    ] as const) {
      const response = await vote(id, { value, userId: 1 });
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ ideaId: id, ...expected });
    }
  });
  it.each(["duel", "draft", "tournament"])("claims an eligible %s prompt and returns JSON null for a later request", async at => {
    played(); const id = seedIdea();
    const response = await prompt(`at=${at}`);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ idea: { id, rank: 1 }, openTotal: 1 });
    expect(state.db!.prepare("select ideas_prompt_at from users where id=2").get()).toEqual({ ideas_prompt_at: Date.now() });
    expect(await (await prompt("at=draft")).json()).toBeNull();
  });
  it("approves, starts and completes through owner routes, sends notices once, and reads them without a body", async () => {
    played(); const id = (await (await post()).json()).idea.id as number;
    actor(1);
    const initial = await queue();
    expect(initial.headers.get("cache-control")).toBe("private, no-store");
    expect(await initial.json()).toMatchObject({ waiting: [{ id, authorName: "Player 2" }], open: [], inProgress: [], recentDone: [], counts: { waiting: 1, open: 0, inProgress: 0, done: 0 } });
    expect(await (await decide(id)).json()).toMatchObject({ status: "ok", idea: { state: "open" }, noticesSent: 0 });
    actor(3); played(3); await vote(id);
    actor(1); await decide(id, { action: "start" });
    const completed = await decide(id, { action: "done", note: "Shipped today", userId: 3 });
    expect(completed.status).toBe(200); expect(completed.headers.get("cache-control")).toBe("private, no-store");
    expect(await completed.json()).toMatchObject({ status: "ok", idea: { id, state: "done", doneNote: "Shipped today", decidedByUserId: 1 }, noticesSent: 2 });
    const repeated = await decide(id, { action: "done" });
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ error: "already_decided", status: "already_decided", idea: { id, state: "done" }, noticesSent: 0 });
    const conflicting = await decide(id, { action: "approve" });
    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toMatchObject({ error: "conflict", status: "conflict", idea: { id, state: "done" }, noticesSent: 0 });
    expect(await (await queue()).json()).toMatchObject({ recentDone: [{ id }], counts: { waiting: 0, open: 0, inProgress: 0, done: 1 } });
    actor(2);
    expect(await (await board()).json()).toMatchObject({ notices: [{ ideaId: id, kind: "done", title: "A useful feature", note: "Shipped today", createdAt: "2026-10-31T12:00:00.000Z" }] });
    const shipped = await done();
    expect(shipped.status).toBe(200); expect(shipped.headers.get("cache-control")).toBe("private, no-store");
    expect(await shipped.json()).toMatchObject({ weeks: [{ week: "2026-10-26", ideas: [{ id, state: "done" }] }] });
    const read = await readNotices();
    expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(await read.json()).toEqual({ markedRead: 1 });
    expect(await (await readNotices()).json()).toEqual({ markedRead: 0 });
    expect(await (await board()).json()).toMatchObject({ notices: [] });
    actor(3); expect(await (await board()).json()).toMatchObject({ notices: [{ ideaId: id }] });
  });
  it("declines with a typed reason and optional line, visible privately to the author", async () => {
    const id = seedIdea("waiting", 2); actor(1);
    expect(await (await decide(id, { action: "decline", reason: "Not for now", line: "A short explanation" })).json()).toMatchObject({ status: "ok", noticesSent: 1, idea: { state: "declined", declineReason: "Not for now: A short explanation" } });
    actor(2);
    expect(await (await board()).json()).toMatchObject({ yourIdeas: [{ id, declineReason: "Not for now: A short explanation" }], notices: [{ kind: "declined", note: "Not for now: A short explanation" }] });
  });
});

describe("expected service errors retain HTTP status and safe code", () => {
  it("returns 403 for own ideas and 409 after voting closes", async () => {
    played(); await expectError(await vote(seedIdea("open", 2)), 403, "own_idea");
    await expectError(await vote(seedIdea("in_progress")), 409, "not_open");
  });
  it("returns 403 for a player who has not finished an activity", async () => {
    await expectError(await post(), 403, "not_played_yet");
    await expectError(await vote(seedIdea()), 403, "not_played_yet");
  });
  it("returns 429 after three daily posts", async () => {
    played(); await post(); await post(); await post();
    await expectError(await post(), 429, "daily_limit");
  });
  it("returns 404 for unknown or foreign-guild ideas on both ID routes", async () => {
    const foreign = seedIdea("waiting", 3, "other");
    for (const id of [foreign, 999]) {
      await expectError(await vote(id), 404, "not_found");
      actor(1); await expectError(await decide(id), 404, "not_found"); actor(2);
    }
  });
});
