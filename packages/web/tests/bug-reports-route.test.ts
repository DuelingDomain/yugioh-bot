import { useRecordingObservability } from "../../shared/tests/helpers/recording-observability.mjs";
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];
let github: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify", () => ({ announcer: { announce: vi.fn() }, broadcaster: {} }));
// The duel host's public view of the duel: only audience "all" lines, as the host reads them from the spectator view.
const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));
const PUBLIC_LOG = ["Turn 3 — Player 2", "Player 1 Normal Summons a face-down monster", "Player 2 drew 1 card(s)"];
const hostAnswer = () => ({
  ok: true as const,
  data: { format: "ffa3", mode: "normal", seat: 0, turn: 3, phase: "Main Phase 1", turnSeat: 1, livingPlayers: 3, log: PUBLIC_LOG },
});

const GUILD = "guild-1";
const DISCORD_ID = "810293847561029384";
const TOKEN = "github_pat_SECRET_TOKEN_VALUE";
const HAND = ["Dark Magician", "Blue-Eyes White Dragon", "Exodia the Forbidden One"];

async function seed() {
  const dir = mkdtempSync(join(tmpdir(), "yugioh-bug-reports-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "test.sqlite");
  process.env.DISCORD_GUILD_ID = GUILD;
  process.env.WEB_URL = "https://duel.example.com/";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  db.prepare("insert into players (id, guild_id, user_id, discord_user_id, display_name) values (1, ?, ?, ?, 'Seraphina Quill')").run(GUILD, fixtureUserId(DISCORD_ID), fixtureDiscordId(DISCORD_ID));
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status, format) values (?, 'duel-a', 'T', 1, 'normal', 'active', 'ffa3')").run(GUILD);
  // An invite-only duel of the same guild that the reporter (player 1) has no seat, grant or organizer role in.
  db.prepare(`insert into players (id, guild_id, user_id, discord_user_id, display_name) values (3, ?, ${fixtureUserId("other-owner")}, '${fixtureDiscordId("other-owner")}', 'Other Owner')`).run(GUILD);
  const { defaultDuelSettings } = await import("@yugidraft/shared/duels");
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status, format, settings_json) values (?, 'duel-private', 'T', 3, 'normal', 'active', 'ffa3', ?)")
    .run(GUILD, JSON.stringify({ ...defaultDuelSettings("normal"), visibility: "private" }));
  db.prepare(`insert into players (id, guild_id, user_id, discord_user_id, display_name) values (2, 'guild-2', ${fixtureUserId("x")}, '${fixtureDiscordId("x")}', 'X')`).run();
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values ('guild-2', 'duel-other', 'T', 2, 'normal', 'active')").run();
  db.close();
}

/** What GitHub answers to "create issue": the labels are part of it. */
const created = (number: number, labels: string[] = ["bug", "needs-triage", "from-app"]) => ({
  number, html_url: `https://github.com/DuelingDomain/yugioh-bot/issues/${number}`, labels: labels.map((name) => ({ name })),
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
    vi.resetModules(); await recording.install();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId(DISCORD_ID)), discordUserId: fixtureDiscordId(DISCORD_ID), name: "Seraphina Quill" } });
    callDuelHost.mockReset();
    callDuelHost.mockResolvedValue(hostAnswer());
    github = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(created(77), { status: 201 }));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).startsWith("https://api.github.com/") ? github(url, init) : Promise.reject(new Error(`Unexpected fetch: ${url}`))));
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", TOKEN);
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "");
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "WEB_URL"]) delete process.env[key];
    while (tempDirs.length) { const d = tempDirs.pop(); if (d) rmSync(d, { recursive: true, force: true }); }
  });

  it("401 without a session, with no storage or outbound writes", async () => {
    const POST = await route();
    auth.mockResolvedValue(null);
    expect((await POST(post(body()))).status).toBe(401);
    expect(github).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("503 when the account cannot be resolved", async () => {
    auth.mockRejectedValue(new Error("Session unavailable"));
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
    expect(await res.json()).toEqual({ id: 1, issue: { number: 77, url: "https://github.com/DuelingDomain/yugioh-bot/issues/77" } });
    const [row] = await rows();
    expect(row).toMatchObject({
      guild_id: GUILD, player_id: 1, path: "/duels/duel-a", duel_slug: "duel-a", github_issue_number: 77,
      github_issue_url: "https://github.com/DuelingDomain/yugioh-bot/issues/77", github_error: null,
    });
    const [call] = githubCalls();
    expect(call!.url).toBe("https://api.github.com/repos/DuelingDomain/yugioh-bot/issues");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call!.payload.labels).toEqual(["bug", "needs-triage", "from-app"]);
    expect(call!.payload.title.startsWith("[Bug] [FFA3] ")).toBe(true);
    expect(call!.payload.body).not.toContain("duel-a");
    expect(call!.payload.body).not.toContain("Reporter seat");
    expect(call!.payload.body).not.toContain("## Replay");
    expect(call!.payload.body).toContain(`Report #${row!.public_id}`);
    expect(row!.public_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("keeps the replay and duel reference private even with a configured WEB_URL", async () => {
    const POST = await route();
    vi.stubEnv("WEB_URL", "https://web-url.example.com/");
    await POST(new Request("https://evil.example/api/bug-reports", { method: "POST", body: JSON.stringify(body()) }));
    expect(githubCalls()[0]!.payload.body).not.toMatch(/web-url\.example|evil\.example|duel-a|## Replay/);
  });

  it("leaves the replay link out when no public URL is configured, even if the request has an origin", async () => {
    const POST = await route();
    vi.stubEnv("WEB_URL", "");
    const res = await POST(new Request("https://evil.example/api/bug-reports", { method: "POST", body: JSON.stringify(body()) }));
    expect(res.status).toBe(200);
    const text = githubCalls()[0]!.payload.body as string;
    expect(text).not.toContain("## Replay");
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("web-url.example.com");
    expect(text).not.toContain("localhost");
    expect(text).toContain(`Report #${(await rows())[0]!.public_id}`);
  });

  it("ignores a configured URL that is not http or https", async () => {
    const POST = await route();
    vi.stubEnv("WEB_URL", "javascript:alert(1)");
    await POST(post(body()));
    expect(githubCalls()[0]!.payload.body).not.toContain("## Replay");
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
    expect(text).toContain("Player 2 drew 1 card(s)");
    // The database keeps the reporter and the full text.
    const [row] = await rows();
    expect(row!.player_id).toBe(1);
    expect(row!.description).toContain(DISCORD_ID);
  });

  it("builds the log and the duel facts on the server and ignores the browser's copy", async () => {
    const POST = await route();
    await POST(post(body({ context: { ...body().context, format: "ffa4", turn: 99, phase: "Fake phase", livingPlayers: 1, log: [`You added ${HAND[1]} to your hand`, "Forged line"] } })));
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "bug-context", slug: "duel-a", guildId: GUILD, playerId: 1 }));
    const [call] = githubCalls();
    const issue = call!.payload.body as string;
    for (const line of PUBLIC_LOG) expect(issue).toContain(line);
    expect(issue).not.toContain("Forged line");
    expect(issue).not.toContain(HAND[1]);
    expect(issue).not.toContain("Fake phase");
    expect(issue).toContain("| Turn | `3` |");
    expect(issue).toContain("| Format | `3-player FFA` |");
    const [row] = await rows();
    expect(JSON.parse(row!.context_json)).toMatchObject({ format: "ffa3", turn: 3, log: PUBLIC_LOG });
  });

  it("takes the format, rules and seat from the database and leaves the log empty when the duel host cannot answer", async () => {
    callDuelHost.mockResolvedValue({ ok: false, response: Response.json({ error: "down" }, { status: 503 }) });
    const POST = await route();
    expect((await POST(post(body()))).status).toBe(200);
    const issue = githubCalls()[0]!.payload.body as string;
    expect(issue).toContain("| Format | `3-player FFA` |");
    expect(issue).toContain("_No duel log._");
    expect(issue).not.toContain(HAND[1]);
  });

  it("captures the full board and log privately, with a submitter snapshot", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("update users set username = ?, email = ? where id = ?")
      .run("report-author", "author@example.test", fixtureUserId(DISCORD_ID));
    const board = { revision: 42, seats: [], log: Array.from({ length: 25 }, (_, id) => ({ id, text: `Public event ${id}` })) };
    callDuelHost.mockResolvedValue({ ok: true, data: { ...hostAnswer().data, board } });
    expect((await (await route())(post(body()))).status).toBe(200);
    const [row] = await rows();
    expect(JSON.parse(row!.submitter_json)).toEqual({ userId: fixtureUserId(DISCORD_ID), username: "report-author", email: "author@example.test" });
    expect(JSON.parse(row!.diagnostics_json)).toMatchObject({ board, attempts: 1 });
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    getDb().prepare("update users set username = 'changed-author', email = null where id = ?").run(fixtureUserId(DISCORD_ID));
    vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId(DISCORD_ID)));
    const { GET } = await import("../app/api/admin/bug-reports/route");
    const ownerList = await (await GET(new Request("http://x/api/admin/bug-reports"))).json();
    expect(ownerList.reports[0].submitter).toEqual({ userId: fixtureUserId(DISCORD_ID), username: "report-author", email: "author@example.test" });
    const { GET: detail } = await import("../app/api/admin/bug-reports/[id]/route");
    const savedData = await (await detail(new Request("http://x"), { params: Promise.resolve({ id: "1" }) })).json();
    expect(savedData.diagnostics.board.log).toHaveLength(25);
    const issue = JSON.stringify(githubCalls()[0]!.payload).replace(/\u200b/g, "");
    for (const privateValue of ["author@example.test", "report-author", "\"revision\"", "Public event 0"]) expect(issue).not.toContain(privateValue);
  });

  it("infers the duel from its page path when the room has not loaded", async () => {
    expect((await (await route())(post(body({ duelSlug: undefined })))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ slug: "duel-a" }));
    expect((await rows())[0]!.duel_slug).toBe("duel-a");
  });

  it("retries a failed capture once and saves the recovered board", async () => {
    const board = { revision: 7, seats: [], log: [{ id: 1, text: "Recovered public log" }] };
    callDuelHost.mockResolvedValueOnce({ ok: false, response: Response.json({ error: "down" }, { status: 503 }) })
      .mockResolvedValueOnce({ ok: true, data: { ...hostAnswer().data, board } });
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await rows())[0]!.diagnostics_json)).toMatchObject({ board, attempts: 2 });
    expect(githubCalls()[0]!.payload.body).not.toContain("Log missing because");
  });

  it("still files the issue after two failed captures and records a safe reason", async () => {
    callDuelHost.mockRejectedValue(new DOMException(`private internal error ${TOKEN}`, "TimeoutError"));
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(2);
    const [row] = await rows();
    expect(JSON.parse(row!.diagnostics_json)).toMatchObject({ attempts: 2, board: null, missingReason: "the duel host request timed out" });
    expect(githubCalls()[0]!.payload.body).toContain("Log missing because the duel host request timed out");
    expect(githubCalls()[0]!.payload.body).not.toContain("private internal error");
  });

  it("retries an incomplete old host response and explains the missing board", async () => {
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(2);
    expect(githubCalls()[0]!.payload.body).toContain("Board missing because the duel host did not return a board");
    expect(githubCalls()[0]!.payload.body).toContain(PUBLIC_LOG[0]);
  });

  it("sends an outside-duel report without a missing-log reason or a host call", async () => {
    const payload = { description: "A card effect did not work as expected", expected: "The card effect should work", path: "/decks", context: {} };
    expect((await (await route())(post(payload))).status).toBe(200);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(githubCalls()[0]!.payload.body).not.toContain("Log missing because");
    expect(JSON.parse((await rows())[0]!.context_json)).not.toHaveProperty("logMissingReason");
  });

  it("keeps stored account names and emails out of player-written public text", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("update users set username = ?, email = ? where id = ?")
      .run("report-author", "author@example.test", fixtureUserId(DISCORD_ID));
    callDuelHost.mockResolvedValue({ ok: true, data: { ...hostAnswer().data, log: ["Player 1 summoned a card"] } });
    await (await route())(post(body({ description: "report-author at author@example.test saw another@example.test and 123456789012345678 fail" })));
    const issue = JSON.stringify(githubCalls()[0]!.payload).replace(/\u200b/g, "");
    for (const privateValue of ["report-author", "author@example.test", "another@example.test", "123456789012345678"]) expect(issue).not.toContain(privateValue);
  });

  it("keeps game numbers and card names in trusted logs and masks page parameters", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("insert into users(id,username,display_name) values(8000,'Kuriboh','Kuriboh')").run();
    getDb().prepare("insert into players(guild_id,user_id,display_name) values(?,8000,'Kuriboh')").run(GUILD);
    callDuelHost.mockResolvedValue({ ok: true, data: { ...hostAnswer().data,
      board: { log: [{ text: "Kuriboh has 8000 ATK" }] }, log: ["Kuriboh has 8000 ATK"],
    } });
    await (await route())(post(body({ path: "/cards/Kuriboh/8000", description: "Kuriboh saw the card keep 8000 ATK after resolving", expected: "Kuriboh expected 8000 ATK to remain" })));
    const issue = githubCalls()[0]!.payload;
    expect(issue.title).toContain("8000 ATK");
    expect(issue.title).not.toContain("Kuriboh");
    expect(issue.body).toContain("[removed] saw the card keep 8000 ATK");
    expect(issue.body).toContain("[removed] expected 8000 ATK");
    expect(issue.body).toContain("Kuriboh has 8000 ATK");
    expect(issue.body).toContain("| Page | `/cards/[id]/[id]` |");
  });

  it.each([400, 401, 403, 404, 409, 429])("does not retry host HTTP %s", async status => {
    callDuelHost.mockResolvedValue({ ok: false, response: Response.json({}, { status }) });
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await rows())[0]!.diagnostics_json).attempts).toBe(1);
  });

  it("does not retry a host error that is not a timeout", async () => {
    callDuelHost.mockRejectedValue(new Error("private failure"));
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], "invalid"])("retries invalid host data %s", async data => {
    callDuelHost.mockResolvedValueOnce({ ok: true, data });
    expect((await (await route())(post(body()))).status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledTimes(2);
  });

  it.each(["new", "dev-presets"])("does not treat /duels/%s as a duel", async page => {
    expect((await (await route())(post(body({ path: `/duels/${page}`, duelSlug: page })))).status).toBe(200);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect((await rows())[0]!.duel_slug).toBeNull();
    expect(githubCalls()[0]!.payload.body).not.toContain("Log missing because");
  });

  it("uses a neutral reason if the duel check fails", async () => {
    await (await route())(post(body({ path: "/duels/not-found", duelSlug: "not-found" })));
    const [row] = await rows();
    expect(JSON.parse(row!.diagnostics_json).missingReason).toBe("no duel data was found");
    expect(githubCalls()[0]!.payload.body).not.toMatch(/unavailable to this account|not-found/);
  });

  it("keeps the whole public log and only the last 400 board log entries", async () => {
    const log = Array.from({ length: 900 }, (_, id) => ({ id, text: `Public event ${id}` }));
    callDuelHost.mockResolvedValue({ ok: true, data: { ...hostAnswer().data, board: { revision: 9, log } } });
    await (await route())(post(body()));
    const diagnostics = JSON.parse((await rows())[0]!.diagnostics_json);
    expect(diagnostics.log).toEqual(log);
    expect(diagnostics.board.log).toEqual(log.slice(-400));
    expect(diagnostics.logTruncated).toBe(true);
    expect(diagnostics.logTotal).toBe(900);
  });

  it("caps diagnostic bytes and keeps the end of the log when a board is too large", async () => {
    const log = Array.from({ length: 1500 }, (_, id) => ({ id, text: `Event ${id} ` + "x".repeat(2000) }));
    callDuelHost.mockResolvedValue({ ok: true, data: { ...hostAnswer().data, board: { large: "x".repeat(500_000), log } } });
    await (await route())(post(body()));
    const [row] = await rows();
    expect(Buffer.byteLength(row!.diagnostics_json)).toBeLessThanOrEqual(2 * 1024 * 1024 + 1024);
    const diagnostics = JSON.parse(row!.diagnostics_json);
    expect(diagnostics.log.length).toBeLessThan(log.length);
    expect(diagnostics.log.at(-1)).toEqual(log.at(-1));
    expect(diagnostics.board).toBeNull();
    expect(diagnostics.boardOmittedReason).toBe("the board exceeded the storage limit");
  });

  it("makes one report and issue for concurrent or repeated submissions", async () => {
    const POST = await route();
    const results = await Promise.all([POST(post(body())), POST(post(body()))]);
    expect(results.map(res => res.status)).toEqual([200, 200]);
    expect(await results[0]!.json()).toEqual(await results[1]!.json());
    const first = (await rows())[0]!;
    expect(await rows()).toHaveLength(1);
    expect(githubCalls()).toHaveLength(1);
    // Simulate a retry handled by a new route instance after a lost browser response.
    vi.resetModules();
    await (await route())(post(body({ context: { viewport: { width: 1000, height: 800 } } })));
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.public_id).toBe(first.public_id);
    expect(githubCalls()).toHaveLength(1);
  });

  it("claims one report when separate route instances finish capture at the same time", async () => {
    let finishCapture!: (value: unknown) => void;
    const capture = new Promise(resolve => { finishCapture = resolve; });
    callDuelHost.mockImplementation(() => capture);
    const first = (await route())(post(body()));
    await vi.waitFor(() => expect(callDuelHost).toHaveBeenCalledTimes(1));
    vi.resetModules();
    const second = (await route())(post(body()));
    await vi.waitFor(() => expect(callDuelHost).toHaveBeenCalledTimes(2));
    finishCapture({ ok: true, data: { board: { log: [] }, log: [] } });
    expect((await Promise.all([first, second])).map(response => response.status)).toEqual([200, 200]);
    expect(await rows()).toHaveLength(1);
    expect(githubCalls()).toHaveLength(1);
  });

  it("keeps the tail of one oversized log entry within the diagnostic byte limit", async () => {
    const text = "x".repeat(2_500_000) + " final public event";
    callDuelHost.mockResolvedValue({ ok: true, data: { board: { log: [{ text }] } } });
    await (await route())(post(body()));
    const [row] = await rows();
    expect(Buffer.byteLength(row!.diagnostics_json)).toBeLessThanOrEqual(2 * 1024 * 1024 + 1024);
    const diagnostics = JSON.parse(row!.diagnostics_json);
    expect(diagnostics.log.at(-1).text).toMatch(/final public event$/);
    expect(diagnostics.logTruncated).toBe(true);
  });

  it("shows saved reports only to owners, with guild scope and old identity fallback", async () => {
    const POST = await route();
    await POST(post(body()));
    const { getDb } = await import("../src/lib/db");
    const db = getDb();
    db.prepare("update bug_reports set submitter_json = null where id = 1").run();
    db.prepare("insert into bug_reports(guild_id,player_id,created_at,path,description,context_json) values('other-guild',1,?, '/', 'Other guild report', '{}')").run(new Date().toISOString());
    const { GET } = await import("../app/api/admin/bug-reports/route");
    const request = new Request("http://x/api/admin/bug-reports");
    const { default: Page } = await import("../app/(app)/settings/bug-reports/page");
    const pageParams = { searchParams: Promise.resolve({}) };
    auth.mockResolvedValue(null);
    await expect(Page(pageParams)).rejects.toThrow("NEXT_REDIRECT");
    expect((await GET(request)).status).toBe(401);
    auth.mockResolvedValue({ user: { id: String(fixtureUserId(DISCORD_ID)), name: "Member" } });
    vi.stubEnv("OWNER_USER_IDS", "");
    expect((await GET(request)).status).toBe(403);
    await expect(Page(pageParams)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId(DISCORD_ID)));
    const response = await GET(request);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const list = await response.json();
    expect(list.reports).toHaveLength(1);
    expect(list.reports[0]).toMatchObject({ id: 1, duelSlug: "duel-a", githubIssueNumber: 77,
      submitter: { userId: fixtureUserId(DISCORD_ID), username: `fixture:${DISCORD_ID}`, email: null } });
    expect(list.reports[0]).not.toHaveProperty("diagnostics");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(await Page(pageParams));
    expect(html).toContain("fixture:");
    expect(html).toContain("/duels/duel-a/replay");
    expect(html).toContain((await rows())[0]!.public_id);
    expect(html).toContain("https://github.com/DuelingDomain/yugioh-bot/issues/77");
    expect(html).toContain("Board and log (JSON)");
    const { GET: detail } = await import("../app/api/admin/bug-reports/[id]/route");
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await detail(request, params("1"))).status).toBe(200);
    expect((await detail(request, params("2"))).status).toBe(404);
    expect((await detail(request, params("not-an-id"))).status).toBe(404);
    vi.stubEnv("OWNER_USER_IDS", "");
    expect((await detail(request, params("1"))).status).toBe(403);
  });

  it("paginates owner reports without moving reports across guilds", async () => {
    const POST = await route();
    await POST(post(body()));
    const { getDb } = await import("../src/lib/db");
    const insert = getDb().prepare("insert into bug_reports(guild_id,player_id,created_at,path,description,context_json) values(?,1,?, '/', 'Saved report', '{}')");
    for (let index = 0; index < 51; index += 1) insert.run(GUILD, new Date().toISOString());
    vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId(DISCORD_ID)));
    const { GET } = await import("../app/api/admin/bug-reports/route");
    const first = await (await GET(new Request("http://x/api/admin/bug-reports"))).json();
    expect(first.reports).toHaveLength(50);
    expect(first.next).toBe(3);
    const next = await (await GET(new Request(`http://x/api/admin/bug-reports?before=${first.next}`))).json();
    expect(next.reports.map((report: { id: number }) => report.id)).toEqual([2, 1]);
    expect(next.next).toBeNull();
  });

  it("removes the submitter snapshot when the account is deleted", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("update users set username = 'private-author', email = 'private@example.test' where id = ?").run(fixtureUserId(DISCORD_ID));
    await (await route())(post(body()));
    const { deleteUserAccount, createBugReportService } = await import("@yugidraft/shared/services");
    deleteUserAccount(getDb(), fixtureUserId(DISCORD_ID));
    const report = createBugReportService(getDb()).get(1, GUILD);
    expect(report.submitter).toEqual({ userId: fixtureUserId(DISCORD_ID), username: `deleted-${fixtureUserId(DISCORD_ID)}`, email: null });
    expect(JSON.stringify(report.submitter)).not.toMatch(/private-author|private@example.test/);
  });

  it("removes other account names from member duplicate suggestions when GitHub is unavailable", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("update users set username = 'private-opponent', email = 'opponent@example.test' where id = ?").run(fixtureUserId("other-owner"));
    const payload = body({ description: "private-opponent says the chain froze after the summon" });
    await (await route())(post(payload));
    expect(githubCalls()[0]!.payload.body).not.toContain("private-opponent");
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", "");
    const { POST } = await import("../app/api/bug-reports/precheck/route");
    const response = await POST(post(payload));
    expect(response.status).toBe(200);
    const suggestions = await response.json();
    expect(suggestions.duplicates).toHaveLength(1);
    expect(JSON.stringify(suggestions)).not.toMatch(/private-opponent|opponent@example.test|submitter/);
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
    const warn = recording.log.mockClear().mockImplementation(() => {});
    github.mockResolvedValue(Response.json({ message: `Bad credentials ${TOKEN}` }, { status: 401 }));
    const POST = await route();
    const res = await POST(post(body()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, issue: null });
    const [row] = await rows();
    expect(row!.github_error).toBe("GitHub answered 401: Bad credentials [token]");
    expect(row!.github_error).not.toContain(TOKEN);
    expect(warn).toHaveBeenCalledWith("warn", "[api/bug-reports] report saved without an issue", {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
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
    github.mockResolvedValue(Response.json({ number: 80, html_url: "https://github.com/DuelingDomain/yugioh-bot/issues/80" }, { status: 201 }));
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
    for (let i = 0; i < 5; i += 1) expect((await POST(post(body({ description: `Distinct report ${i} about a card effect failure` })))).status).toBe(200);
    const res = await POST(post(body()));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await rows()).toHaveLength(5);
    expect(github).toHaveBeenCalledTimes(5);
  });

  it("keeps a report about a duel of another guild without the duel: no slug saved or sent", async () => {
    const POST = await route();
    const res = await POST(post(body({ duelSlug: "duel-other", path: "/duels/duel-other" })));
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row!.duel_slug).toBeNull();
    expect(githubCalls()[0]!.payload.body).not.toContain("duel-other");
  });

  it.each([undefined, 50])("rejects a fork report before storage, host logs or GitHub, duplicateOf=%s", async duplicateOf => {
    const userId = fixtureUserId(DISCORD_ID);
    vi.stubEnv("OWNER_USER_IDS", String(userId));
    const { getDb } = await import("../src/lib/db");
    const setup = { replayFork: { ownerUserId: userId, control: "all-manual", origin: {
      sourceSlug: "duel-private", sourceVersion: "source-v1", frameId: "opening", step: 0, prefixCount: 0,
      prefixHash: "a".repeat(64), sourceSeats: [0, 1, 2].map(seat => ({ seat, displayName: `Source ${seat}` })),
    } } };
    const forkId = Number(getDb().prepare(`insert into duels(guild_id, web_slug, name, organizer_player_id, mode, status, format, kind, setup_json)
      values(?, 'fork-report', 'Test fork', 1, 'normal', 'active', 'ffa3', 'replay-fork', ?)`).run(GUILD, JSON.stringify(setup)).lastInsertRowid);
    getDb().prepare("insert into duel_seats(duel_id, seat, player_id) values(?, 0, 1)").run(forkId);
    const POST = await route();
    const res = await POST(post(body({ duplicateOf, duelSlug: "fork-report", path: "/duels/fork-report",
      description: "The replay fork fork-report shows a private source log" })));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Bug reports from replay forks are disabled to protect private duel data." });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await rows()).toHaveLength(0);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(github).not.toHaveBeenCalled();
  });

  it("drops the duel slug when the player may not see the duel: not saved, no replay link, no slug in the issue", async () => {
    const POST = await route();
    const res = await POST(post(body({ duelSlug: "duel-private", path: "/duels/duel-private" })));
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row!.duel_slug).toBeNull();
    const [call] = githubCalls();
    expect(call!.payload.body).not.toContain("duel-private");
    expect(call!.payload.body).not.toContain("## Replay");
    expect(call!.payload.body).not.toContain("/replay");
    // Nothing asked the duel host about it, and no duel facts of it are kept.
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(call!.payload.title.startsWith("[Bug] [FFA3]")).toBe(false);
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
  const issueUrl = `https://github.com/DuelingDomain/yugioh-bot/issues/${ISSUE}`;
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
    vi.resetModules(); await recording.install();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId(DISCORD_ID)), discordUserId: fixtureDiscordId(DISCORD_ID), name: "Seraphina Quill" } });
    callDuelHost.mockReset();
    callDuelHost.mockResolvedValue(hostAnswer());
    github = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).startsWith("https://api.github.com/") ? github(url, init) : Promise.reject(new Error(`Unexpected fetch: ${url}`))));
    vi.stubEnv("BUG_REPORT_GITHUB_TOKEN", TOKEN);
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "");
    await seed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID", "WEB_URL"]) delete process.env[key];
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
    expect(calls().map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/DuelingDomain/yugioh-bot", "")}`)).toEqual([`GET /issues/${ISSUE}`, `POST /issues/${ISSUE}/comments`]);
    const [comment] = comments();
    expect(comment!.body.body.startsWith(`**+1** from \`Report #${row!.public_id}\``)).toBe(true);
    expect(comment!.body.body).not.toMatch(/duel-a|Reporter seat|## Replay/);
    expect(comment!.body.body).toContain("Player 2 drew 1 card(s)");
  });

  it("leaves the replay link out of the +1 comment when no public URL is configured", async () => {
    serve();
    vi.stubEnv("WEB_URL", "");
    const POST = await route();
    expect((await POST(new Request("https://evil.example/api/bug-reports", { method: "POST", body: JSON.stringify(body({ duplicateOf: ISSUE })) }))).status).toBe(200);
    const text = String(comments()[0]!.body.body);
    expect(text).not.toContain("## Replay");
    expect(text).not.toContain("evil.example");
  });

  it("keeps private data out of the comment", async () => {
    const { getDb } = await import("../src/lib/db");
    getDb().prepare("update users set username = 'private-handle', email = 'private@example.test' where id = ?").run(fixtureUserId(DISCORD_ID));
    serve();
    const POST = await route();
    await POST(post(body({ duplicateOf: ISSUE, description: `Seraphina Quill (${DISCORD_ID}) in ${GUILD} cc @octocat #9 private-handle private@example.test` })));
    const text = String(comments()[0]!.body.body);
    for (const secret of [DISCORD_ID, "Seraphina Quill", "Seraphina", GUILD, TOKEN, ...HAND]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/@[A-Za-z]/);
    expect(text).not.toMatch(/#9\b/);
    expect(text.replace(/\u200b/g, "")).not.toMatch(/private-handle|private@example.test/);
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

  it("records and logs the GitHub lookup error when a saved issue takes a +1 without a comment", async () => {
    const warn = recording.log.mockClear().mockImplementation(() => {});
    vi.stubEnv("BUG_REPORT_GITHUB_REPO", "someone/else");
    await ownIssueFromAnotherReport();
    github.mockResolvedValue(Response.json({ message: `Resource not accessible ${TOKEN}` }, { status: 403 }));
    const res = await (await route())(post(body({ duplicateOf: ISSUE })));
    expect(await res.json()).toEqual({ id: 2, issue: { number: ISSUE, url: "https://github.com/someone/else/issues/50" }, duplicate: true });
    expect((await rows())[1]).toMatchObject({ github_error: "GitHub answered 403: Resource not accessible [token]; no comment was added" });
    expect(warn).toHaveBeenCalledWith("warn", "[api/bug-reports] duplicate report saved without a comment", {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    expect(comments()).toHaveLength(0);
  });

  it("logs a warning when the duplicate target is missing or inaccessible", async () => {
    const warn = recording.log.mockClear().mockImplementation(() => {});
    github.mockResolvedValue(Response.json({ message: `Not Found ${TOKEN}` }, { status: 404 }));
    expect((await (await route())(post(body({ duplicateOf: ISSUE })))).status).toBe(409);
    expect(warn).toHaveBeenCalledWith("warn", "[api/bug-reports] issue cannot take a report", {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);
    expect(await rows()).toHaveLength(0);
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
    for (let i = 0; i < 5; i += 1) expect((await POST(post(body({ duplicateOf: ISSUE, description: `Distinct report ${i} about a card effect failure` })))).status).toBe(200);
    expect((await POST(post(body({ duplicateOf: ISSUE })))).status).toBe(429);
    expect(comments()).toHaveLength(5);
  });
});

const FIXTURE_KEYS = ["other-owner", "x", "810293847561029384"] as const;

const recording = useRecordingObservability();
