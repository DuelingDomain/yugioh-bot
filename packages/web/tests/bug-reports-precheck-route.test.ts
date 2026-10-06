import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockDiscordAccess } from "./fixtures/discord-access";

const auth = vi.fn();
const tempDirs: string[] = [];
let discord: ReturnType<typeof mockDiscordAccess>;
let github: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
let openIssues: Array<Record<string, unknown>>;
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: {} }));

const GUILD = "guild-1";
const DISCORD_ID = "810293847561029384";
const OTHER_ID = "990000000000000001";
const TOKEN = "github_pat_SECRET_TOKEN_VALUE";

const issue = (number: number, title: string, description: string, extra: Record<string, unknown> = {}) => ({
  number, html_url: `https://github.com/imran443/yugioh-bot/issues/${number}`, title, state: "open",
  labels: [{ name: "bug" }, { name: "from-app" }], body: `## Description\n\n\`\`\`\n${description}\n\`\`\`\n\n## Expected\n\nx`, ...extra,
});

async function seed() {
  const dir = mkdtempSync(join(tmpdir(), "yugioh-precheck-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "test.sqlite");
  process.env.DISCORD_GUILD_ID = GUILD;
  process.env.NEXTAUTH_URL = "https://duel.example.com/";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  db.prepare("insert into players (id, guild_id, user_id, discord_user_id, display_name) values (1, ?, ?, ?, 'Seraphina Quill')").run(GUILD, fixtureUserId(DISCORD_ID), fixtureDiscordId(DISCORD_ID));
  db.prepare("insert into players (id, guild_id, user_id, discord_user_id, display_name) values (3, ?, ?, ?, 'Orion Vale')").run(GUILD, fixtureUserId(OTHER_ID), fixtureDiscordId(OTHER_ID));
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values (?, 'duel-a', 'T', 1, 'normal', 'active')").run(GUILD);
  db.close();
}

async function addReport(row: { player: number; slug?: string | null; turn?: number; description: string; issue?: number | null; minutesAgo?: number; duplicateOf?: number }) {
  const { getDb } = await import("../src/lib/db");
  getDb().prepare(
    `insert into bug_reports (guild_id, player_id, created_at, path, duel_slug, description, expected, context_json, github_issue_number, github_issue_url, duplicate_of)
     values (?, ?, ?, '/duels/duel-a', ?, ?, 'x', ?, ?, ?, ?)`,
  ).run(
    GUILD, row.player, new Date(Date.now() - (row.minutesAgo ?? 0) * 60_000).toISOString(), row.slug ?? null, row.description,
    JSON.stringify({ format: "ffa3", ...(row.turn === undefined ? {} : { turn: row.turn }) }),
    row.issue ?? null, row.issue ? `https://github.com/imran443/yugioh-bot/issues/${row.issue}` : null, row.duplicateOf ?? null,
  );
}

const body = (extra: Record<string, unknown> = {}) => ({
  description: "The chain froze and the duel never went on after my effect",
  expected: "The chain should resolve and the duel goes on",
  path: "/duels/duel-a",
  duelSlug: "duel-a",
  context: { format: "ffa3", duelMode: "normal", seat: 0, turn: 3, phase: "main1", livingPlayers: 3, log: ["Turn 3"] },
  ...extra,
});
const post = (payload: unknown) => new Request("http://x/api/bug-reports/precheck", { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) });
const route = async () => (await import("../app/api/bug-reports/precheck/route")).POST;
const rows = async () => (await import("../src/lib/db")).getDb().prepare("select * from bug_reports").all();

describe("POST /api/bug-reports/precheck", () => {
  beforeEach(async () => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId(DISCORD_ID)), discordUserId: fixtureDiscordId(DISCORD_ID), name: "Seraphina Quill" } });
    discord = mockDiscordAccess();
    openIssues = [];
    const discordFetch = globalThis.fetch;
    github = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).includes("/issues?") ? Response.json(openIssues) : Response.json({ number: 99, html_url: "https://github.com/x/y/issues/99" }, { status: 201 }));
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

  it("401 without a session and 403 for a non-member", async () => {
    const POST = await route();
    auth.mockResolvedValue(null);
    expect((await POST(post(body()))).status).toBe(401);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId(DISCORD_ID)), discordUserId: fixtureDiscordId(DISCORD_ID), name: "Seraphina Quill" } });
    discord.memberStatus = 404;
    expect((await POST(post(body()))).status).toBe(403);
    expect(github).not.toHaveBeenCalled();
  });

  it("503 when Discord cannot be asked", async () => {
    discord.memberStatus = 500;
    expect((await (await route())(post(body()))).status).toBe(503);
    expect(github).not.toHaveBeenCalled();
  });

  it("400 with field errors for text that is too short, and 400 for bad JSON", async () => {
    const POST = await route();
    const res = await POST(post(body({ description: "Broke", expected: "" })));
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toMatchObject({ description: expect.any(String), expected: expect.any(String) });
    expect((await POST(post("{nope"))).status).toBe(400);
  });

  it("413 for a body over the size cap, by content-length or by the bytes read, with no GitHub call", async () => {
    const POST = await route();
    const huge = JSON.stringify(body({ description: "x".repeat(200_000) }));
    expect((await POST(post(huge))).status).toBe(413);
    const lying = new Request("http://x/api/bug-reports/precheck", { method: "POST", body: huge, headers: { "content-length": "10" } });
    expect((await POST(lying)).status).toBe(413);
    const declared = new Request("http://x/api/bug-reports/precheck", { method: "POST", body: "{}", headers: { "content-length": "999999" } });
    expect((await POST(declared)).status).toBe(413);
    expect(github).not.toHaveBeenCalled();
  });

  it("only reads: a player with no row is not created, and nothing is saved", async () => {
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("123456789012345678")), discordUserId: fixtureDiscordId("123456789012345678"), name: "Newcomer" } });
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    await addReport({ player: 3, slug: "duel-a", turn: 3, description: "The chain froze and the duel never went on after my effect", issue: 8 });
    const { getDb } = await import("../src/lib/db");
    const count = (table: string) => (getDb().prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
    const before = { players: count("players"), reports: count("bug_reports") };
    const res = await (await route())(post(body()));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicates.map((d: { number: number; sameDuel: boolean }) => [d.number, d.sameDuel])).toEqual([[8, true]]);
    expect({ players: count("players"), reports: count("bug_reports") }).toEqual(before);
  });

  it("returns a known limit that matches the text and the format", async () => {
    const POST = await route();
    const res = await POST(post(body({ description: "The player was eliminated and his card went to my graveyard", expected: "The card should go to his graveyard" })));
    const json = await res.json();
    expect(json.knownLimits).toEqual([expect.objectContaining({ id: "eliminated-card-wrong-graveyard", explanation: expect.stringContaining("another player's Graveyard") })]);
    expect(json.duplicates).toEqual([]);
  });

  it("returns no limit for a 1v1 surrender report", async () => {
    const POST = await route();
    const res = await POST(post(body({
      description: "I surrendered in the duel but my monsters stayed on the field",
      expected: "My monsters should leave at once",
      context: { format: "1v1" },
    })));
    expect((await res.json()).knownLimits).toEqual([]);
  });

  it("ranks open from-app issues from GitHub and keeps the best 3 above the threshold", async () => {
    openIssues = [
      issue(1, "[Bug] [FFA3] Deck editor drops the extra cards", "Extra deck cards vanish in the editor"),
      issue(2, "[Bug] [FFA3] The chain froze and the duel never went on", "Chain froze after my effect and the duel never went on"),
      issue(3, "[Bug] [Tag] Chain froze duel never went on", "The chain froze, duel did not go on"),
      issue(4, "[Bug] [FFA3] Chain froze after effect", "After my effect the chain froze"),
      issue(5, "[Bug] [FFA3] Chain froze and duel stuck after my effect", "Chain froze, duel stuck after effect"),
    ];
    const POST = await route();
    const json = await (await POST(post(body()))).json();
    expect(github.mock.calls[0]![0]).toContain("labels=from-app");
    expect(json.duplicates).toHaveLength(3);
    expect(json.duplicates.map((d: { number: number }) => d.number)).not.toContain(1);
    expect(json.duplicates[0]).toMatchObject({ number: 2, url: "https://github.com/imran443/yugioh-bot/issues/2", sameDuel: false });
    expect(json.duplicates[0].score).toBeGreaterThanOrEqual(json.duplicates[1].score);
    expect(Object.keys(json.duplicates[0]).sort()).toEqual(["number", "sameDuel", "score", "title", "url"]);
    expect(await rows()).toHaveLength(0);
    expect(github.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("puts an issue reported by another player on the same turn of this duel first", async () => {
    openIssues = [
      issue(2, "[Bug] [FFA3] The chain froze and the duel never went on", "Chain froze after my effect and the duel never went on"),
      issue(8, "[Bug] [FFA3] Lobby avatar is missing", "My avatar does not show"),
    ];
    await addReport({ player: 3, slug: "duel-a", turn: 3, description: "My avatar does not show", issue: 8, minutesAgo: 120 });
    const POST = await route();
    const json = await (await POST(post(body()))).json();
    expect(json.duplicates.map((d: { number: number; sameDuel: boolean }) => [d.number, d.sameDuel])).toEqual([[8, true], [2, false]]);
  });

  it("also counts a report from the same duel in the last 10 minutes, but not an older one on another turn", async () => {
    openIssues = [issue(8, "[Bug] [FFA3] Lobby avatar is missing", "avatar"), issue(9, "[Bug] [FFA3] Music is too loud", "music")];
    await addReport({ player: 3, slug: "duel-a", turn: 1, description: "avatar", issue: 8, minutesAgo: 4 });
    await addReport({ player: 3, slug: "duel-a", turn: 1, description: "music", issue: 9, minutesAgo: 60 });
    const POST = await route();
    const json = await (await POST(post(body()))).json();
    expect(json.duplicates.map((d: { number: number }) => d.number)).toEqual([8]);
  });

  it("does not offer your own report or a closed issue as the same duel", async () => {
    openIssues = [];
    await addReport({ player: 1, slug: "duel-a", turn: 3, description: "mine", issue: 8 });
    await addReport({ player: 3, slug: "duel-a", turn: 3, description: "closed one", issue: 9 });
    const POST = await route();
    expect((await (await POST(post(body()))).json()).duplicates).toEqual([]);
  });

  it("falls back to saved reports with an issue when there is no token, with no GitHub call", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    await addReport({ player: 3, slug: "duel-z", turn: 2, description: "The chain froze and the duel never went on after the effect", issue: 21 });
    await addReport({ player: 3, slug: "duel-z", description: "Totally different lobby avatar problem", issue: 22 });
    await addReport({ player: 3, slug: "duel-z", description: "The chain froze and the duel never went on after the effect", issue: 21, duplicateOf: 21 });
    const POST = await route();
    const json = await (await POST(post(body()))).json();
    expect(github).not.toHaveBeenCalled();
    expect(json.duplicates).toHaveLength(1);
    expect(json.duplicates[0]).toMatchObject({ number: 21, url: "https://github.com/imran443/yugioh-bot/issues/21", sameDuel: false });
    expect(json.duplicates[0].title).toMatch(/^\[Bug\] \[FFA3\] The chain froze/);
  });

  it("falls back to saved reports when GitHub fails, and hides names and ids in their titles", async () => {
    github.mockImplementation(async () => Response.json({ message: "boom" }, { status: 500 }));
    await addReport({ player: 3, slug: "duel-z", description: `Orion Vale (${OTHER_ID}) says the chain froze and the duel never went on after the effect`, issue: 31 });
    const POST = await route();
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("31");
    expect(text).not.toContain("Orion Vale");
    expect(text).not.toContain(OTHER_ID);
    expect(text).not.toContain(TOKEN);
  });

  it("puts a same-duel saved report first in the fallback too", async () => {
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    await addReport({ player: 3, slug: "duel-a", turn: 3, description: "Something quite unrelated about sound volume", issue: 41 });
    await addReport({ player: 3, slug: "duel-z", description: "The chain froze and the duel never went on after the effect", issue: 42 });
    const POST = await route();
    const json = await (await POST(post(body()))).json();
    expect(json.duplicates.map((d: { number: number; sameDuel: boolean }) => [d.number, d.sameDuel])).toEqual([[41, true], [42, false]]);
  });

  it("limits each player to 30 checks in 10 minutes", async () => {
    const POST = await route();
    for (let i = 0; i < 30; i += 1) expect((await POST(post(body()))).status).toBe(200);
    const res = await POST(post(body()));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

const FIXTURE_KEYS = ["123456789012345678", "810293847561029384", "990000000000000001", "players"] as const;
