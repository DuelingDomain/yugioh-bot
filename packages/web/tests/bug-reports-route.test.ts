import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
const tempDirs: string[] = [];
let discord: ReturnType<typeof mockDiscordAccess>;
let github: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: {} }));

const GUILD = "guild-1";
const DISCORD_ID = "810293847561029384";
const TOKEN = "github_pat_SECRET_TOKEN_VALUE";
const HAND = ["Dark Magician", "Blue-Eyes White Dragon", "Exodia the Forbidden One"];

async function seed() {
  const dir = mkdtempSync(join(tmpdir(), "yugioh-bug-reports-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "test.sqlite");
  process.env.DISCORD_GUILD_ID = GUILD;
  process.env.NEXTAUTH_URL = "https://duel.example.com/";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (1, ?, ?, 'Seraphina Quill')").run(GUILD, DISCORD_ID);
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values (?, 'duel-a', 'T', 1, 'normal', 'active')").run(GUILD);
  db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (2, 'guild-2', 'x', 'X')").run();
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values ('guild-2', 'duel-other', 'T', 2, 'normal', 'active')").run();
  db.close();
}

/** What GitHub answers to "create issue": the labels are part of it. */
const created = (number: number, labels: string[] = ["bug", "needs-triage", "from-app"]) => ({
  number, html_url: `https://github.com/imran443/yugioh-bot/issues/${number}`, labels: labels.map((name) => ({ name })),
});

const body = (extra: Record<string, unknown> = {}) => ({
  description: "Seraphina Quill here: the turn never ended",
  expected: "It should end",
  path: "/duels/duel-a",
  duelSlug: "duel-a",
  context: {
    format: "ffa3", duelMode: "normal", seat: 0, turn: 3, phase: "main1", turnSeat: 1, livingPlayers: 3, animationSpeed: 1,
    // The browser sends the viewer's own log. Lines only this player sees must not reach GitHub.
    log: [
      "Turn 3", "Player 1 Normal Summons a face-down monster", "Player 1 Normal Summons Dark Magician",
      `You added ${HAND[1]} to your hand`, `Confirmed ${HAND[2]}`, "Player 2 draws 1 card",
    ],
    userAgent: "Mozilla/5.0", viewport: { width: 1280, height: 720 }, timestamp: "2026-10-03T10:00:00.000Z",
  },
  ...extra,
});
const post = (payload: unknown) =>
  new Request("http://x/api/bug-reports", { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) });

async function route() {
  return (await import("../app/api/bug-reports/route")).POST;
}
async function rows() {
  const { getDb } = await import("../src/lib/db");
  return getDb().prepare("select * from bug_reports order by id").all() as Array<Record<string, any>>;
}
const githubCalls = () => github.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit, payload: JSON.parse(String((init as RequestInit).body)) }));

describe("POST /api/bug-reports", () => {
  beforeEach(async () => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: DISCORD_ID, name: "Seraphina Quill" } });
    discord = mockDiscordAccess();
    const discordFetch = globalThis.fetch;
    github = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(created(77), { status: 201 }));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).startsWith("https://api.github.com/") ? github(url, init) : discordFetch(url as never)));
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", TOKEN);
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "");
    await seed();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "NEXTAUTH_URL"]) delete process.env[key];
    while (tempDirs.length) { const d = tempDirs.pop(); if (d) rmSync(d, { recursive: true, force: true }); }
  });

  it("401 without a session, 403 for a non-member, 503 when Discord is down", async () => {
    const POST = await route();
    auth.mockResolvedValue(null);
    expect((await POST(post(body()))).status).toBe(401);
    auth.mockResolvedValue({ user: { id: DISCORD_ID, name: "Seraphina Quill" } });
    discord.memberStatus = 404;
    expect((await POST(post(body()))).status).toBe(403);
    expect(github).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("503 when Discord cannot be asked", async () => {
    discord.memberStatus = 500;
    const POST = await route();
    expect((await POST(post(body()))).status).toBe(503);
  });

  it.each([
    ["bad JSON", "{nope"],
    ["an empty description", body({ description: "  " })],
    ["an unknown field", body({ playerId: 5 })],
    ["a hand in the context", body({ context: { hand: HAND } })],
  ])("400 for %s, and nothing is saved", async (_name, payload) => {
    const POST = await route();
    expect((await POST(post(payload))).status).toBe(400);
    expect(await rows()).toHaveLength(0);
    expect(github).not.toHaveBeenCalled();
  });

  it("413 for a body over the size cap, and nothing is saved or sent", async () => {
    const POST = await route();
    const huge = JSON.stringify(body({ description: "x".repeat(200_000) }));
    expect((await POST(post(huge))).status).toBe(413);
    const declared = new Request("http://x/api/bug-reports", { method: "POST", body: "{}", headers: { "content-length": "999999" } });
    expect((await POST(declared)).status).toBe(413);
    expect(await rows()).toHaveLength(0);
    expect(github).not.toHaveBeenCalled();
  });

  it("400 with a field error for a short description and a missing expectation, and nothing is saved", async () => {
    const POST = await route();
    const res = await POST(post(body({ description: "It broke", expected: "" })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.fieldErrors).toMatchObject({ description: expect.stringContaining("at least 20 characters"), expected: expect.any(String) });
    expect(json.error).toBe(json.fieldErrors.description);
    expect(await rows()).toHaveLength(0);
    expect(github).not.toHaveBeenCalled();
  });

  it("saves the report with the player id and opens a GitHub issue", async () => {
    const POST = await route();
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, issue: { number: 77, url: "https://github.com/imran443/yugioh-bot/issues/77" } });
    const [row] = await rows();
    expect(row).toMatchObject({
      guild_id: GUILD, player_id: 1, path: "/duels/duel-a", duel_slug: "duel-a", github_issue_number: 77,
      github_issue_url: "https://github.com/imran443/yugioh-bot/issues/77", github_error: null,
    });
    const [call] = githubCalls();
    expect(call!.url).toBe("https://api.github.com/repos/imran443/yugioh-bot/issues");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call!.payload.labels).toEqual(["bug", "needs-triage", "from-app"]);
    expect(call!.payload.title.startsWith("[Bug] [FFA3] ")).toBe(true);
    expect(call!.payload.body).toContain("https://duel.example.com/duels/duel-a/replay");
    expect(call!.payload.body).toContain("`Report #1`");
  });

  it("keeps private data out of the public issue", async () => {
    const POST = await route();
    await POST(post(body({ description: `Seraphina Quill (${DISCORD_ID}) in ${GUILD} cc @octocat` })));
    const [call] = githubCalls();
    const text = `${call!.payload.title}\n${call!.payload.body}`;
    for (const secret of [DISCORD_ID, "Seraphina Quill", "Seraphina", GUILD, TOKEN, ...HAND]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/@[A-Za-z]/);
    // Public lines are still there.
    expect(text).toContain("Player 1 Normal Summons a face-down monster");
    expect(text).toContain("Player 2 draws 1 card");
    // The database keeps the reporter and the full text.
    const [row] = await rows();
    expect(row!.player_id).toBe(1);
    expect(row!.description).toContain(DISCORD_ID);
  });

  it("returns issue null and records the error when the token is missing", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    const POST = await route();
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, issue: null });
    expect(github).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ github_issue_number: null, github_error: "BUG_REPORT_GITHUB_TOKEN is not set" });
  });

  it("keeps the report when GitHub fails, and never stores the token", async () => {
    github.mockResolvedValue(Response.json({ message: `Bad credentials ${TOKEN}` }, { status: 401 }));
    const POST = await route();
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, issue: null });
    const [row] = await rows();
    expect(row!.github_error).toContain("401");
    expect(row!.github_error).not.toContain(TOKEN);
  });

  it("keeps the report when the request to GitHub throws", async () => {
    github.mockRejectedValue(new Error(`socket closed ${TOKEN}`));
    const POST = await route();
    expect(await (await POST(post(body()))).json()).toEqual({ id: 1, issue: null });
    const [row] = await rows();
    expect(row!.github_error).toContain("GitHub request failed");
    expect(row!.github_error).not.toContain(TOKEN);
  });

  it("retries once without labels when GitHub refuses them (422), and records a warning", async () => {
    github
      .mockResolvedValueOnce(Response.json({ message: "Validation Failed" }, { status: 422 }))
      .mockResolvedValueOnce(Response.json(created(78, []), { status: 201 }));
    const POST = await route();
    expect(await (await POST(post(body()))).json()).toMatchObject({ issue: { number: 78 } });
    const calls = githubCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.payload.labels).toBeDefined();
    expect(calls[1]!.payload.labels).toBeUndefined();
    expect((await rows())[0]).toMatchObject({ github_issue_number: 78, github_error: expect.stringContaining("without them") });
  });

  it("does not retry without labels on a 403 (often a rate limit): one call, no issue, the error is kept", async () => {
    github.mockResolvedValue(Response.json({ message: "API rate limit exceeded" }, { status: 403 }));
    const POST = await route();
    expect(await (await POST(post(body()))).json()).toEqual({ id: 1, issue: null });
    expect(github).toHaveBeenCalledTimes(1);
    expect((await rows())[0]).toMatchObject({ github_issue_number: null, github_error: expect.stringContaining("403") });
  });

  it("records a warning when GitHub made the issue without the from-app label", async () => {
    github.mockResolvedValue(Response.json(created(79, ["bug"]), { status: 201 }));
    const POST = await route();
    expect(await (await POST(post(body()))).json()).toMatchObject({ issue: { number: 79 } });
    expect((await rows())[0]).toMatchObject({ github_issue_number: 79, github_error: expect.stringContaining("from-app label") });
  });

  it("records a warning when the answer holds no labels at all", async () => {
    github.mockResolvedValue(Response.json({ number: 80, html_url: "https://github.com/imran443/yugioh-bot/issues/80" }, { status: 201 }));
    const POST = await route();
    await POST(post(body()));
    expect((await rows())[0]!.github_error).toContain("from-app label");
  });

  it("clears the cached list of open issues after it opens a new issue", async () => {
    const lists = () => github.mock.calls.filter(([url, init]) => String(url).includes("/issues?state=open") && !init?.method).length;
    github.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === "POST" ? Response.json(created(77), { status: 201 }) : Response.json([]));
    const { listOpenFromAppIssues } = await import("../src/lib/bug-report-github");
    await listOpenFromAppIssues();
    await listOpenFromAppIssues();
    expect(lists()).toBe(1);
    const POST = await route();
    expect((await POST(post(body()))).status).toBe(200);
    await listOpenFromAppIssues();
    expect(lists()).toBe(2);
  });

  it("uses BUG_REPORT_GITHUB_REPO when it is valid", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "someone/else");
    const POST = await route();
    await POST(post(body()));
    expect(githubCalls()[0]!.url).toBe("https://api.github.com/repos/someone/else/issues");
  });

  it("429 on the sixth report in ten minutes, with Retry-After", async () => {
    const POST = await route();
    for (let i = 0; i < 5; i += 1) expect((await POST(post(body()))).status).toBe(200);
    const res = await POST(post(body()));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await rows()).toHaveLength(5);
    expect(github).toHaveBeenCalledTimes(5);
  });

  it("404 for a duel of another guild, and nothing is saved", async () => {
    const POST = await route();
    const res = await POST(post(body({ duelSlug: "duel-other" })));
    expect(res.status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });

  it("accepts a report with no duel (a general page)", async () => {
    const POST = await route();
    const res = await POST(post({ description: "The leaderboard is blank for everyone", expected: "It should list the players", path: "/leaderboard", context: {} }));
    expect(res.status).toBe(200);
    const [call] = githubCalls();
    expect(call!.payload.title).toBe("[Bug] The leaderboard is blank for everyone");
    expect(call!.payload.body).not.toContain("## Replay");
  });
});

describe("POST /api/bug-reports with duplicateOf", () => {
  const ISSUE = 50;
  const issueUrl = `https://github.com/imran443/yugioh-bot/issues/${ISSUE}`;
  const raw = (extra: Record<string, unknown> = {}) => ({
    number: ISSUE, html_url: issueUrl, title: "[Bug] [FFA3] Chain froze", state: "open", labels: [{ name: "bug" }, { name: "from-app" }], ...extra,
  });
  const calls = () => github.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null }));
  const comments = () => calls().filter((c) => c.url.endsWith("/comments"));

  function serve(issue: Record<string, unknown> | number = raw(), commentStatus = 201) {
    github.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/comments")) return Response.json(commentStatus === 201 ? { id: 1 } : { message: `no ${TOKEN}` }, { status: commentStatus });
      if (init?.method === "POST") return Response.json(created(77), { status: 201 });
      return typeof issue === "number" ? Response.json({ message: "Not Found" }, { status: issue }) : Response.json(issue);
    });
  }
  async function ownIssueFromAnotherReport() {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare(
      "insert into bug_reports (guild_id, player_id, created_at, path, description, context_json, github_issue_number, github_issue_url) values (?, 1, '2026-10-03T00:00:00.000Z', '/', 'older', '{}', ?, ?)",
    ).run(GUILD, ISSUE, issueUrl);
  }

  beforeEach(async () => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: DISCORD_ID, name: "Seraphina Quill" } });
    discord = mockDiscordAccess();
    const discordFetch = globalThis.fetch;
    github = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).startsWith("https://api.github.com/") ? github(url, init) : discordFetch(url as never)));
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", TOKEN);
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "");
    await seed();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "NEXTAUTH_URL"]) delete process.env[key];
    while (tempDirs.length) { const d = tempDirs.pop(); if (d) rmSync(d, { recursive: true, force: true }); }
  });

  it("saves the report linked to the issue and adds a +1 comment, with no new issue", async () => {
    serve();
    const POST = await route();
    const res = await POST(post(body({ duplicateOf: ISSUE })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, issue: { number: ISSUE, url: issueUrl }, duplicate: true });
    const [row] = await rows();
    expect(row).toMatchObject({ player_id: 1, duplicate_of: ISSUE, github_issue_number: ISSUE, github_issue_url: issueUrl, github_error: null });
    expect(calls().map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/imran443/yugioh-bot", "")}`)).toEqual([`GET /issues/${ISSUE}`, `POST /issues/${ISSUE}/comments`]);
    const [comment] = comments();
    expect(comment!.body.body.startsWith("**+1** from `Report #1`")).toBe(true);
    expect(comment!.body.body).toContain("https://duel.example.com/duels/duel-a/replay");
    expect(comment!.body.body).toContain("Player 2 draws 1 card");
  });

  it("keeps private data out of the comment", async () => {
    serve();
    const POST = await route();
    await POST(post(body({ duplicateOf: ISSUE, description: `Seraphina Quill (${DISCORD_ID}) in ${GUILD} cc @octocat #9` })));
    const text = String(comments()[0]!.body.body);
    for (const secret of [DISCORD_ID, "Seraphina Quill", "Seraphina", GUILD, TOKEN, ...HAND]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/@[A-Za-z]/);
    expect(text).not.toMatch(/#9\b/);
    expect((await rows())[0]!.description).toContain(DISCORD_ID);
  });

  it.each([
    ["a closed issue", raw({ state: "closed" })],
    ["an issue that is not from the app", raw({ labels: [{ name: "bug" }] })],
    ["a pull request", raw({ pull_request: {} })],
    ["an issue that does not exist", 404],
  ])("409 for %s, and nothing is saved or commented", async (_name, issue) => {
    serve(issue);
    const POST = await route();
    const res = await POST(post(body({ duplicateOf: 12 })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not open for reports/);
    expect(await rows()).toHaveLength(0);
    expect(comments()).toHaveLength(0);
    expect(calls().filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("400 for a duplicateOf that is not a positive whole number", async () => {
    const POST = await route();
    for (const bad of ["12", 0, -3, 1.5]) expect((await POST(post(body({ duplicateOf: bad })))).status).toBe(400);
    expect(await rows()).toHaveLength(0);
    expect(github).not.toHaveBeenCalled();
  });

  it("still applies the quality rules to a +1", async () => {
    serve();
    const POST = await route();
    expect((await POST(post(body({ duplicateOf: ISSUE, description: "same" })))).status).toBe(400);
    expect(github).not.toHaveBeenCalled();
  });

  it("without a token, accepts only an issue that one of our reports opened, and adds no comment", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    const POST = await route();
    expect((await POST(post(body({ duplicateOf: ISSUE })))).status).toBe(409);
    expect(await rows()).toHaveLength(0);
    await ownIssueFromAnotherReport();
    const res = await POST(post(body({ duplicateOf: ISSUE })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 2, issue: { number: ISSUE, url: issueUrl }, duplicate: true });
    expect((await rows())[1]).toMatchObject({ duplicate_of: ISSUE, github_issue_number: ISSUE });
    expect(github).not.toHaveBeenCalled();
  });

  it("does not take a +1 for an issue that only another +1 pointed at", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    const { getDb } = await import("../src/lib/db");
    getDb().prepare(
      "insert into bug_reports (guild_id, player_id, created_at, path, description, context_json, github_issue_number, github_issue_url, duplicate_of) values (?, 1, '2026-10-03T00:00:00.000Z', '/', 'older', '{}', ?, ?, ?)",
    ).run(GUILD, ISSUE, issueUrl, ISSUE);
    const POST = await route();
    expect((await POST(post(body({ duplicateOf: ISSUE })))).status).toBe(409);
  });

  it("keeps the report linked when the comment fails, and stores the error without the token", async () => {
    serve(raw(), 403);
    const POST = await route();
    const res = await POST(post(body({ duplicateOf: ISSUE })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, issue: { number: ISSUE } });
    const [row] = await rows();
    expect(row).toMatchObject({ duplicate_of: ISSUE, github_issue_number: ISSUE });
    expect(row!.github_error).toContain("403");
    expect(row!.github_error).not.toContain(TOKEN);
  });

  it("429 for a player who is out of reports, before any GitHub call", async () => {
    serve();
    const { getDb } = await import("../src/lib/db");
    const insert = getDb().prepare("insert into bug_reports (guild_id, player_id, created_at, path, description, context_json) values (?, 1, ?, '/', 'older', '{}')");
    for (let i = 0; i < 5; i += 1) insert.run(GUILD, new Date(Date.now() - 60_000 + i).toISOString());
    const POST = await route();
    const res = await POST(post(body({ duplicateOf: ISSUE })));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(github).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(5);
  });

  it("limits the target checks that end in 409 (10 in 10 minutes) and stops calling GitHub", async () => {
    serve(raw({ state: "closed" }));
    const POST = await route();
    for (let i = 0; i < 10; i += 1) expect((await POST(post(body({ duplicateOf: 12 })))).status).toBe(409);
    expect(github).toHaveBeenCalledTimes(10);
    const res = await POST(post(body({ duplicateOf: 12 })));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(github).toHaveBeenCalledTimes(10);
    // A new issue (no duplicateOf) is not affected by the target check limit.
    expect((await POST(post(body()))).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it("counts a +1 in the same limit of 5 reports in 10 minutes", async () => {
    serve();
    const POST = await route();
    for (let i = 0; i < 5; i += 1) expect((await POST(post(body({ duplicateOf: ISSUE })))).status).toBe(200);
    expect((await POST(post(body({ duplicateOf: ISSUE })))).status).toBe(429);
    expect(comments()).toHaveLength(5);
  });
});
