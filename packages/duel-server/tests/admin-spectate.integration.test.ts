import Database from "better-sqlite3";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { seedIdentity } from "./helpers/identity.js";
import { ReplayWorker, replaySource, replayFixtureResources } from "./support/replay-fixtures.js";
const resourceRead = vi.hoisted(() => vi.fn());
vi.mock("../src/engine-resource-resolver.js", async original => ({ ...await original<typeof import("../src/engine-resource-resolver.js")>(), resolveEngineResourcesForSource: resourceRead }));
const queryErrors = vi.hoisted(() => ({ emit: false }));
vi.mock("../src/worker-client.js", async original => {
  const { ReplayWorker } = await import("./support/replay-fixtures.js");
  return { ...await original<typeof import("../src/worker-client.js")>(), GameWorker: class extends ReplayWorker {
    constructor(private readonly onError?: (error: import("../src/script-errors.js").DuelScriptError) => void) { super(); }
    override async view(seat: number | null) {
      if (queryErrors.emit) this.onError?.({ code: 100, scriptFile: "c100.lua", line: 1, message: "query error", index: 1,
        source: "query", commandHash: "a".repeat(64), mode: "normal", format: "1v1", engine: "legacy", scriptErrorMode: "tolerant" });
      return super.view(seat);
    }
  } };
});
let db: Database.Database; let dir: string; let host: DuelHost; let slug: string;
let workers: ReplayWorker[]; const secret = "admin-host-test"; let onChange: ReturnType<typeof vi.fn<(slug: string, guildId: string) => void>>;
beforeEach(() => {
  queryErrors.emit = false;
  vi.stubEnv("OWNER_USER_IDS", "101"); vi.stubEnv("DISCORD_GUILD_ID", "test-guild");
  db = new Database(":memory:"); migrate(db); dir = mkdtempSync(join(tmpdir(), "admin-spectate-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test-bundle" }));
  const catalog = new Database(join(dir, "cards.cdb")); catalog.exec("create table datas(id integer); create table texts(id integer)"); catalog.close();
  writeFileSync(join(dir, "strings.conf"), ""); mkdirSync(join(dir, "card-scripts"));
  vi.spyOn(EngineResourceCache.prototype, "get").mockImplementation(async (_dir, options) => replayFixtureResources(dir, options.format, options.mode));
  resourceRead.mockReset().mockImplementation((_dir, _source, current) => current);
  for (const [playerId, userId] of [[61, 101], [62, 102], [63, 103], [64, 104], [65, 105]]) seedIdentity(db, { guildId: "test-guild", playerId, userId });
  workers = []; onChange = vi.fn();
  host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], pollIntervalMs: 60_000, onChange,
    createWorker: () => { const w = new ReplayWorker(); workers.push(w); return w; } });
});
afterEach(async () => { await host.close(); db.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function table(format: DuelFormat) {
  const duels = createDuelService(db); const session = duels.create({ guildId: "test-guild", organizerPlayerId: 62, name: "Private", mode: "normal", format });
  slug = session.slug; for (let seat = 1; seat < seatCountFor(format); seat++) duels.takeSeat(slug, "test-guild", 62 + seat, seat);
  const source = replaySource(format); const resources = replayFixtureResources(dir, format);
  db.prepare("update duel_seats set deck_json=? where duel_id=?").run(JSON.stringify(source.decks[0]), session.id);
  db.prepare("update duels set status='active', settings_json=json_set(settings_json,'$.visibility','private'), seed_json=?, bundle_version=?,setup_json=?,started_at=datetime('now'),last_activity_at='2000-01-01 00:00:00' where id=?")
    .run(JSON.stringify(source.seed), resources.bundleVersion, JSON.stringify({ ...source.setup, engineIdentity: resources.identity }), session.id);
}
async function post(extra = {}, signed = true) {
  const body = JSON.stringify({ op: "admin-spectate", slug, guildId: "test-guild", userId: 101, seat: null, ...extra });
  const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body, headers: signed ? signedRequestHeaders({ url: "http://localhost/internal/duel", method: "POST", body, secret, purpose: "duel-host" }) : {} }));
  return { status: response.status, body: await response.json() as any };
}
const rows = () => ["duels", "duel_seats", "duel_commands", "duel_series", "duel_invite_grants"].map(t => db.prepare(`select * from ${t}`).all());
it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("reads every %s seat and neutral POV without driving clocks, bots or changing state", async format => {
  table(format); expect((await post({ op: "view", playerId: 62, userId: 102 })).status).toBe(200); const before = rows();
  for (const seat of [null, ...Array.from({ length: seatCountFor(format) }, (_, i) => i)]) {
    const result = await post({ seat }); expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ role: "spectator", mySeat: seat });
    for (const s of result.body.engine.seats) expect(s.hand[0].code).toBe(s.seat === seat ? 900 + s.seat : undefined);
    expect(result.body.engine.prompt?.seat ?? null).toBe(seat === 0 ? 0 : null);
  }
  expect(rows()).toEqual(before); expect(onChange).not.toHaveBeenCalled(); expect(workers).toHaveLength(1); expect(workers[0].closed).toBe(0);
});
it("rejects forged, wrong-guild, revoked, unseated player and invalid POV requests before worker reads", async () => {
  table("1v1");
  expect((await post({}, false)).status).toBe(401);
  for (const extra of [{ userId: 102 }, { guildId: "other" }, { slug: "missing" }]) expect((await post(extra)).status).toBe(404);
  for (const seat of [-1, 2, "0", 0.5]) expect((await post({ seat })).status).toBe(400);
  vi.stubEnv("OWNER_USER_IDS", ""); expect((await post()).status).toBe(404); expect(workers).toHaveLength(0);
});
it("rechecks owner access after an asynchronous worker view", async () => {
  table("1v1"); await post({ op: "view", playerId: 62, userId: 102 }); const original = ReplayWorker.prototype.view;
  vi.spyOn(ReplayWorker.prototype, "view").mockImplementation(async function(this: ReplayWorker, seat) { const view = await original.call(this, seat); vi.stubEnv("OWNER_USER_IDS", ""); return view; });
  expect((await post({ seat: 0 })).status).toBe(404);
});

it("keeps resident-worker script error recording during an admin read", async () => {
  await host.close();
  host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], pollIntervalMs: 60_000 });
  table("1v1");
  const warm = await post({ op: "view", playerId: 62, userId: 102 });
  expect(warm.status, JSON.stringify(warm.body)).toBe(200);
  const before = rows(); queryErrors.emit = true;
  const watched = await post({ seat: 0 }); expect(watched.status, JSON.stringify(watched.body)).toBe(200);
  expect(db.prepare("select * from card_script_error_occurrences").all().length).toBeGreaterThan(0);
  expect(rows()).toEqual(before);
  // The same resident worker still records diagnostics for a normal player read.
  expect((await post({ op: "view", playerId: 62, userId: 102 })).status).toBe(200);
  expect(db.prepare("select * from card_script_error_occurrences").all().length).toBeGreaterThan(0);
});

it("cold polls use saved per-seat boards without journal parsing or worker creation", async () => {
  table("ffa4");
  const fixture = new ReplayWorker(); fixture.created = { decks: replaySource("ffa4").decks } as any;
  const views = await Promise.all([0, 1, 2, 3].map(seat => fixture.view(seat)));
  db.prepare("update duels set snapshot_public_json=?,snapshot_seats_json=? where web_slug=?")
    .run(JSON.stringify(await fixture.view(null)), JSON.stringify(views), slug);
  const command = JSON.stringify({ revision: 1, promptId: "sentinel-command", answer: { choice: "next" } });
  db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) select id,1,0,? from duels where web_slug=?").run(command, slug);
  const parse = vi.spyOn(JSON, "parse");
  for (const seat of [null, 3, 3]) {
    const result = await post({ seat }); expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ stale: true, metadataOnly: false, mySeat: seat });
    for (const s of result.body.engine.seats) expect(s.hand[0].code).toBe(s.seat === seat ? 900 + s.seat : undefined);
  }
  expect(parse.mock.calls.some(([value]) => value === command)).toBe(false);
  expect(workers).toHaveLength(0); expect(resourceRead).not.toHaveBeenCalled();
});
it("cold polls without a saved board return metadata without rebuilding", async () => {
  table("1v1");
  for (let poll = 0; poll < 3; poll++) expect((await post({ seat: 1 })).body).toMatchObject({ engine: null, metadataOnly: true, stale: true });
  expect(workers).toHaveLength(0);
});
it("a slow admin view does not queue player responses behind it", async () => {
  table("1v1"); expect((await post({ op: "view", playerId: 62, userId: 102 })).status).toBe(200);
  const original = ReplayWorker.prototype.view;
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let reading = false;
  vi.spyOn(ReplayWorker.prototype, "view").mockImplementation(async function(this: ReplayWorker, seat) {
    if (seat === 1 && !reading) { reading = true; entered(); await blocked; }
    return original.call(this, seat);
  });
  const watched = post({ seat: 1 }); await started;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const player = post({ op: "respond", playerId: 62, userId: 102, command: { revision: 1, promptId: "p1", answer: { choice: "next" } } });
    const result = await Promise.race([player, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 1000); })]);
    expect(result?.status, JSON.stringify(result)).toBe(200);
  } finally { clearTimeout(timeout); release(); await watched; }
});
it("denies a seated owner on the signed host for public and opposing POVs", async () => {
  table("1v1"); vi.stubEnv("OWNER_USER_IDS", "102");
  for (const seat of [null, 1]) expect((await post({ userId: 102, seat })).status).toBe(404);
  expect(workers).toHaveLength(0);
});
