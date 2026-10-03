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
    github = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ number: 77, html_url: "https://github.com/imran443/yugioh-bot/issues/77" }, { status: 201 }));
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

  it("retries once without labels when GitHub refuses them", async () => {
    github
      .mockResolvedValueOnce(Response.json({ message: "Validation Failed" }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ number: 78, html_url: "https://github.com/imran443/yugioh-bot/issues/78" }, { status: 201 }));
    const POST = await route();
    expect(await (await POST(post(body()))).json()).toMatchObject({ issue: { number: 78 } });
    const calls = githubCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.payload.labels).toBeDefined();
    expect(calls[1]!.payload.labels).toBeUndefined();
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
    const res = await POST(post({ description: "The leaderboard is blank", path: "/leaderboard", context: {} }));
    expect(res.status).toBe(200);
    const [call] = githubCalls();
    expect(call!.payload.title).toBe("[Bug] The leaderboard is blank");
    expect(call!.payload.body).not.toContain("## Replay");
  });
});
