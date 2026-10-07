import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { parseSandboxBoard, seatCountFor, type DuelEngineView, type DuelRoom, type SandboxRun } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker, type DuelGameWorker, type GameOptions } from "../src/worker-client.js";
import * as guards from "../src/multi-domain-guard.js";
import * as presets from "../src/presets/index.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "sandbox-test-secret";
const run: SandboxRun = { bots: { "1": "pass", "2": "pass", "3": "pass" } };
const board = { p0: { hand: [15025844], spells: [{ card: 83968380, pos: "set" }] } };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
interface Control {
  fail: boolean;
  promptSeat: number;
  answers: number;
  answerGate?: Promise<void>;
  onView?: () => Promise<void>;
  onAnswer?: () => void;
  onChange?: (slug: string) => void;
}
const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
afterEach(async () => {
  for (const { host, db } of resources.splice(0)) { await host.close(); db.close(); }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

class FakeWorker implements DuelGameWorker {
  running = true;
  created?: GameOptions;
  revision = 0;
  constructor(readonly control: Control) {}
  async create(options: GameOptions) {
    this.created = options;
    if (this.control.fail) throw new Error("Engine start failed");
  }
  async view(viewer: number | null): Promise<DuelEngineView> {
    await this.control.onView?.();
    const seat = this.revision === 0 ? this.control.promptSeat : 0;
    return { revision: this.revision, turn: 1, turnSeat: seat, phase: "main1", prioritySeat: seat,
      seats: Array.from({ length: seatCountFor(this.created?.format ?? "1v1") }, (_, index) => ({
        seat: index, lp: 8000, hand: [], deckCount: 20, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
      })),
      prompt: viewer === seat ? { id: `prompt-${this.revision}`, seat, kind: "choice", title: "Choose",
        options: [{ id: "to_ep", label: "End turn" }], min: 1, max: 1, cancelable: false } : null,
      chain: [], events: [], log: [], result: null };
  }
  async answer() { this.control.answers++; this.control.onAnswer?.(); await this.control.answerGate; this.revision++; }
  async search() { return []; }
  async close() { this.running = false; }
}

function setup(real = false) {
  vi.stubEnv("DUEL_SCENARIOS", "0");
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const db = new Database(":memory:");
  migrate(db);
  const player = (id: string) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
  ).run(id, id).lastInsertRowid);
  const owner = player("owner"), other = player("other");
  const duels = createDuelService(db);
  const control: Control = { fail: false, promptSeat: 0, answers: 0 };
  const workers: DuelGameWorker[] = [];
  let time = Date.now();
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, openingRps: true, searchCards: () => [],
    onChange: (slug) => control.onChange?.(slug),
    now: () => time, pollIntervalMs: 3_600_000, idleWorkerMs: 3_600_000, stallMs: 0, queueBlockedMs: 0,
    createWorker: () => { const worker = real ? new GameWorker() : new FakeWorker(control); workers.push(worker); return worker; } });
  resources.push({ host, db });
  async function post(op: string, extra: Record<string, unknown> = {}) {
    const raw = JSON.stringify({ guildId: "g", playerId: owner, op, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as any };
  }
  async function start(extra: Record<string, unknown> = {}) {
    const result = await post("start-sandbox", { board, run, ...extra });
    expect(result.status, result.data.error).toBe(200);
    expect(typeof result.data.slug).toBe("string");
    return result.data.slug as string;
  }
  return { db, duels, host, owner, other, workers, control, post, start, advance: () => { time += 60_000; } };
}

describe("sandbox host operations", () => {
  it("validates cards without opening a worker or creating a duel", async () => {
    const t = setup();
    const result = await t.post("validate-board", { board });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, errors: [], codes: expect.arrayContaining([15025844, 83968380]) });
    expect(t.workers).toHaveLength(0);
    expect(t.db.prepare("select count(*) as n from duels").get()).toEqual({ n: 0 });
  });
  it.each([
    [{ teams: [] }, "teams"], [{ p0: { hand: [4294967295] } }, "p0.hand[0]"], [{ startAt: "invalid" }, "startAt"],
  ])("reports invalid boards and refuses start (%j)", async (badBoard, path) => {
    const t = setup();
    const checked = await t.post("validate-board", { board: badBoard });
    expect(checked.status).toBe(200);
    expect(checked.data).toMatchObject({ ok: false, errors: [expect.objectContaining({ path })] });
    expect((await t.post("start-sandbox", { board: badBoard, run })).status).toBe(400);
    expect(t.workers).toHaveLength(0);
  });
  it("starts a private, unranked duel without a clock or environment gate", async () => {
    const t = setup();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DUEL_SANDBOX", "0");
    const slug = await t.start({ scenarioId: 12, run: { ...run, seed: ["1", "2", "3", "4"] } });
    const state = t.duels.privateState(slug, "g");
    expect(state.session).toMatchObject({ sandbox: true, status: "active", ranked: false, bestOf: 1,
      organizerPlayerId: t.owner, settings: { visibility: "private", turnSeconds: 0 } });
    expect(t.db.prepare("select invite_code from duels where web_slug = ?").get(slug)).toEqual({ invite_code: null });
    expect(state.clock).toBeNull();
    expect(state.seed).toEqual(["1", "2", "3", "4"]);
    expect(state.setup).toMatchObject({ firstTurnDraw: true, engine: "pinned", sandbox: {
      board: parseSandboxBoard(board), run: { ...run, seed: state.seed }, scenarioId: 12,
    } });
    expect(state.setup?.startupScripts?.length).toBeGreaterThan(0);
    expect(state.session.seats.map((seat) => seat.isBot)).toEqual([false, true]);
    expect((t.workers[0] as FakeWorker).created).toMatchObject({ firstTurnDraw: true, engine: "pinned" });
    expect((await t.post("sandbox-info", { slug })).data).toEqual(state.setup!.sandbox);
  });
  it.each([{ run: { bots: { "1": "other" } } }, { run: { ...run, seed: ["0", "2", "3", "4"] } }, { scenarioId: 0 }])(
    "rejects invalid start settings %j before creating a duel", async (extra) => {
      const t = setup();
      expect((await t.post("start-sandbox", { board, run, ...extra })).status).toBe(400);
      expect(t.db.prepare("select count(*) as n from duels").get()).toEqual({ n: 0 });
    },
  );
  it("checks the sandbox flag, owner, and guild for info and restart", async () => {
    const t = setup();
    const slug = await t.start();
    const regular = t.duels.create({ guildId: "g", organizerPlayerId: t.owner, name: "Regular", mode: "normal" });
    for (const op of ["sandbox-info", "sandbox-restart"]) {
      expect((await t.post(op, { slug, playerId: t.other })).status).toBe(403);
      expect((await t.post(op, { slug, guildId: "elsewhere" })).status).toBe(404);
      expect((await t.post(op, { slug: regular.slug })).status).toBe(409);
    }
    for (const op of ["view", "replay"]) expect((await t.post(op, { slug, playerId: t.other })).status).toBe(403);
    expect(t.workers).toHaveLength(1);
  });
  it("restarts with the saved random seed and current run, then closes the old worker", async () => {
    const t = setup();
    const slug = await t.start({ scenarioId: 42 });
    const original = t.duels.privateState(slug, "g");
    const changedRun = { ...original.setup!.sandbox!.run, bots: { ...run.bots, "1": "manual" as const } };
    t.duels.setSetup(slug, "g", { ...original.setup, sandbox: { ...original.setup!.sandbox!, run: changedRun } });
    const restarted = await t.post("sandbox-restart", { slug });
    expect(restarted.status, restarted.data.error).toBe(200);
    expect(restarted.data.slug).not.toBe(slug);
    const next = t.duels.privateState(restarted.data.slug, "g");
    expect(next.seed).toEqual(original.seed);
    expect(next.setup!.sandbox).toEqual({ ...original.setup!.sandbox, run: { ...changedRun, seed: original.seed } });
    expect(t.duels.get(slug, "g").status).toBe("cancelled");
    expect(t.workers[0].running).toBe(false);
  });
  it("keeps the old duel when a restart fails and closes the failed worker", async () => {
    const t = setup();
    const slug = await t.start();
    t.control.fail = true;
    expect((await t.post("sandbox-restart", { slug })).status).toBe(503);
    expect(t.duels.get(slug, "g").status).toBe("active");
    expect(t.workers.map((worker) => worker.running)).toEqual([true, false]);
    expect(t.db.prepare("select status from duels order by id").all()).toEqual([{ status: "active" }, { status: "cancelled" }]);
  });
  it("cancels only the owner's oldest sandbox on the fourth start", async () => {
    const t = setup();
    const otherSlug = await t.start({ playerId: t.other });
    const slugs = [];
    for (let n = 0; n < 4; n++) slugs.push(await t.start());
    expect(slugs.map((slug) => t.duels.get(slug, "g").status)).toEqual(["cancelled", "active", "active", "active"]);
    expect(t.duels.get(otherSlug, "g").status).toBe("active");
    expect(t.workers[1].running).toBe(false);
  });
  it("caps concurrent starts at three active duels and ten starts per minute", async () => {
    const t = setup();
    const results = await Promise.all(Array.from({ length: 11 }, () => t.post("start-sandbox", { board, run })));
    expect(results.map((result) => result.status)).toEqual([...Array(10).fill(200), 429]);
    expect(t.db.prepare("select count(*) as n from duels where status = 'active'").get()).toEqual({ n: 3 });
    expect(t.workers.filter((worker) => worker.running)).toHaveLength(3);
    const slug = results[9].data.slug;
    expect((await t.post("sandbox-restart", { slug })).status).toBe(429);
    expect(t.duels.get(slug, "g").status).toBe("active");
    t.advance();
    await t.start();
  });
  it("serializes the initial bot step with room requests triggered by the start event", async () => {
    const t = setup();
    const gate = deferred();
    const entered = deferred();
    t.control.promptSeat = 1;
    t.control.answerGate = gate.promise;
    t.control.onAnswer = () => entered.resolve();
    let room: ReturnType<typeof t.post> | undefined;
    let roomResolved = false;
    const start = t.start();
    try {
      await entered.promise;
      const { web_slug: slug } = t.db.prepare("select web_slug from duels").get() as { web_slug: string };
      room = t.post("view", { slug }).then((result) => { roomResolved = true; return result; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(t.control.answers).toBe(1);
      expect(roomResolved).toBe(false);
    } finally { gate.resolve(); await start; await room; }
  });

  it("reads restart settings after an earlier operation in the duel queue", async () => {
    const t = setup();
    const slug = await t.start();
    const entered = deferred();
    const release = deferred();
    t.control.onView = async () => {
      t.control.onView = undefined;
      entered.resolve();
      await release.promise;
      const saved = t.duels.privateState(slug, "g").setup!;
      t.duels.setSetup(slug, "g", { ...saved, sandbox: { ...saved.sandbox!,
        run: { ...saved.sandbox!.run, bots: { ...run.bots, "1": "manual" } } } });
    };
    const room = t.post("view", { slug });
    await entered.promise;
    const restart = t.post("sandbox-restart", { slug });
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    await room;
    const result = await restart;
    expect(result.status, result.data.error).toBe(200);
    expect(t.duels.privateState(result.data.slug, "g").setup?.sandbox?.run.bots["1"]).toBe("manual");
  });

  it("honors the multiplayer flag and both core guards before start", async () => {
    const t = setup();
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    expect((await t.post("start-sandbox", { board: { format: "ffa3" }, run })).status).toBe(403);
    vi.stubEnv("MULTIPLAYER_TABLES", "1");
    vi.spyOn(presets, "multiCoreAvailable").mockReturnValue(false);
    expect((await t.post("start-sandbox", { board: { format: "ffa3" }, run })).status).toBe(409);
    vi.mocked(presets.multiCoreAvailable).mockReturnValue(true);
    vi.spyOn(guards, "multiStartProblem").mockReturnValue("Domain core unavailable");
    expect((await t.post("start-sandbox", { board: { format: "ffa3", mode: "domain",
      p0: { deckMaster: 15025844 }, p1: { deckMaster: 15025844 }, p2: { deckMaster: 15025844 } }, run })).data.error).toBe("Domain core unavailable");
    expect(t.workers).toHaveLength(0);
  });
  it("holds a manual bot seat on start and recovery; a pass seat uses empty scripted rules", async () => {
    const t = setup();
    t.control.promptSeat = 1;
    const slug = await t.start({ run: { ...run, bots: { ...run.bots, "1": "manual" } } });
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(0);
    await t.workers[0].close();
    expect((await t.post("view", { slug })).status).toBe(200);
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(0);
    const saved = t.duels.privateState(slug, "g").setup!;
    t.duels.setSetup(slug, "g", { ...saved, sandbox: { ...saved.sandbox!, run } });
    await t.workers[1].close();
    expect((await t.post("view", { slug })).status).toBe(200);
    const commands = t.duels.privateState(slug, "g").commands;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ seat: 1, command: { answer: { choice: "to_ep" } } });
    expect(commands[0].command).toMatchObject({ note: expect.stringContaining("default:") });
  });
});

describeWithCores("sandbox real engine", [needs.standard(DATA), needs.cards(DATA)], () => {
  it("starts 1v1 at a real Draw window and restart restores the same first view", async () => {
    const t = setup(true);
    const slug = await t.start();
    const first = (await t.post("view", { slug })).data as DuelRoom;
    expect(first.engine?.phase).toBe("draw");
    expect(first.engine?.seats[0].hand).toHaveLength(2);
    expect(first.engine?.prompt?.options.some((option) => option.card?.code === 83968380)).toBe(true);
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine).toEqual(first.engine);
    const restarted = await t.post("sandbox-restart", { slug });
    expect(restarted.status, restarted.data.error).toBe(200);
    const second = await t.post("view", { slug: restarted.data.slug });
    expect(second.data.engine).toEqual(first.engine);
    expect(t.duels.get(slug, "g").status).toBe("cancelled");
  }, 30_000);
});
