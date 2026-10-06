import { seedIdentity, seedUser } from "../../shared/tests/helpers/identity.js";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { CHAIN_MODE_JOURNAL_LIMIT, defaultChainMode, type DuelChainMode, type DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

// The chain response switch through the host: the op, the journal, privacy, the cap and a rebuild from the journal.
// The worker is a script: seat 1 holds an optional response window; Off passes it to seat 2.
const SECRET = "chain-mode-test";
const hosts: DuelHost[] = [];
const databases: Database.Database[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); for (const db of databases.splice(0)) db.close(); });

class ScriptedWorker implements DuelGameWorker {
  running = true;
  revision = 1;
  holder = 1;
  modes: DuelChainMode[] = ["auto", "auto", "auto"];
  readonly calls: Array<{ seat: number; mode: DuelChainMode }> = [];
  constructor(readonly withSwitch = true) {
    if (!withSwitch) (this as { setChainMode?: unknown }).setChainMode = undefined; // a test double that predates the switch
  }
  async create() {}
  view(seat: number | null): Promise<DuelEngineView> {
    const view = {
      revision: this.revision, format: "ffa3", turn: 2, turnSeat: 1, phase: "main1",
      seats: [0, 1, 2].map((index) => ({
        seat: index, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
      })),
      prompt: seat === this.holder
        ? { id: `p${this.revision}`, seat, kind: "choice", title: "Chain", options: [{ id: "pass", label: "Pass" }], context: { type: "chain" } }
        : null,
      chain: [], events: [], log: [], result: null,
      ...(seat === null ? {} : { chainMode: this.modes[seat] }),
    } as unknown as DuelEngineView;
    return Promise.resolve(view);
  }
  async answer() { this.revision += 1; }
  async search() { return []; }
  /** Set to make the next setChainMode change the mode and then throw, like a core that refuses the automatic pass. */
  failNext: Error | null = null;
  /** Read by a test to learn how many times the host asked for the time before the switch reached the worker. */
  onSetChainMode: () => void = () => {};
  async setChainMode(seat: number, mode: DuelChainMode): Promise<boolean> {
    this.onSetChainMode();
    this.calls.push({ seat, mode });
    this.modes[seat] = mode;
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
    if (mode === "off" && this.holder === seat) {
      this.holder = 2;
      this.revision += 1;
      return true;
    }
    return false;
  }
  async close() { this.running = false; }
}

async function table(worker = new ScriptedWorker(), now?: () => number) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const players = [0, 1, 2].map((seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}`, userId: seedUser(db, `u${seat}`).userId, discordUserId: seedUser(db, `u${seat}`).discordUserId ?? `u${seat}` }).playerId);
  const outsider = seedIdentity(db, { guildId: "g", name: "Out", userId: seedUser(db, "out").userId, discordUserId: seedUser(db, "out").discordUserId ?? "out" }).playerId;
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "chain", mode: "normal", format: "ffa3" });
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g", player, deck);
  const changes: string[] = [];
  const makeHost = (w: DuelGameWorker) => {
    const host = createDuelHost({
      db, secret: SECRET, dataDirectory: DATA, searchCards: () => [], pollIntervalMs: 60_000,
      createWorker: () => w, now, onChange: (slug) => { changes.push(slug); },
    });
    hosts.push(host);
    return host;
  };
  let host = makeHost(worker);
  async function post(body: Record<string, unknown>, as = players[0]!) {
    const raw = JSON.stringify({ slug: session.slug, guildId: "g", playerId: as, ...body });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
    return { status: response.status, data: await response.json() as Record<string, any> };
  }
  expect((await post({ op: "start" })).status).toBe(200);
  changes.length = 0;
  return {
    db, duels, worker, players, outsider, slug: session.slug, post, changes,
    journal: () => duels.privateState(session.slug, "g").commands,
    restart: (w: DuelGameWorker) => { host = makeHost(w); },
  };
}

describe("chain-mode op", () => {
  it("journals a change that passes nothing and touches nothing else", async () => {
    const t = await table();
    const clock = JSON.stringify(t.duels.privateState(t.slug, "g").clock);
    const opponentBefore = JSON.stringify((await t.post({ op: "view" }, t.players[1]!)).data.engine);
    const spectatorBefore = JSON.stringify((await t.post({ op: "view", spectate: true }, t.players[0]!)).status);
    t.changes.length = 0;

    const result = await t.post({ op: "chain-mode", mode: "off" });
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    expect(result.data.engine.chainMode).toBe("off");
    expect(result.data.engine.revision).toBe(1);
    expect(t.changes).toEqual([]);
    expect(JSON.stringify(t.duels.privateState(t.slug, "g").clock)).toBe(clock);
    expect(t.journal()).toHaveLength(1);
    expect(t.journal()[0]).toMatchObject({ seat: 0, command: { promptId: "chain-mode:off", revision: 1, answer: {} } });
    // The opponent's view is byte-identical, mode field included.
    expect(JSON.stringify((await t.post({ op: "view" }, t.players[1]!)).data.engine)).toBe(opponentBefore);
    expect(spectatorBefore).toBe("409");
    expect(t.worker.calls).toEqual([{ seat: 0, mode: "off" }]);
  });

  it("passes the open window like an answer: revision, push, journal", async () => {
    const t = await table();
    const result = await t.post({ op: "chain-mode", mode: "off" }, t.players[1]!);
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    expect(result.data.engine.chainMode).toBe("off");
    expect(result.data.engine.revision).toBe(2);
    expect(result.data.engine.prompt).toBeNull();
    expect(t.changes).toEqual([t.slug]);
    expect(t.journal()).toHaveLength(1);
    expect(t.journal()[0]).toMatchObject({ seat: 1, command: { promptId: "chain-mode:off", revision: 1 } });
    // The next window is another seat's: its holder sees it, the toggler's mode is not shown to it.
    const holder = (await t.post({ op: "view" }, t.players[2]!)).data.engine;
    expect(holder.prompt).not.toBeNull();
    expect(holder.chainMode).toBe("auto");
  });

  it("refuses a bad mode, an unseated player and a switch the engine lacks", async () => {
    const t = await table();
    expect((await t.post({ op: "chain-mode", mode: "sometimes" })).status).toBe(400);
    expect((await t.post({ op: "chain-mode" })).status).toBe(400);
    expect((await t.post({ op: "chain-mode", mode: "off" }, t.outsider)).status).toBe(403);
    expect(t.journal()).toHaveLength(0);
    const bare = await table(new ScriptedWorker(false));
    expect((await bare.post({ op: "chain-mode", mode: "off" })).status).toBe(409);
    expect(bare.journal()).toHaveLength(0);
  });

  it("drops the worker when the engine throws after it set the mode, and journals nothing", async () => {
    const t = await table();
    t.worker.failNext = new Error("The core refused the automatic pass");
    const result = await t.post({ op: "chain-mode", mode: "off" }, t.players[1]!);
    expect(result.status).toBe(409);
    expect(t.worker.running).toBe(false);
    expect(t.journal()).toHaveLength(0);
    // The next request rebuilds the duel from the journal on a fresh worker, where the mode never changed.
    const fresh = new ScriptedWorker();
    t.restart(fresh);
    const view = await t.post({ op: "view" }, t.players[1]!);
    expect(view.status, JSON.stringify(view.data)).toBe(200);
    expect(view.data.engine.chainMode).toBe("auto");
  });

  it("does not pass a window when the seat's time runs out while the switch is decided", async () => {
    // Learn how many times the host asks for the time before the switch reaches the worker; the last of them is the moment
    // the switch is decided.
    const base = Date.now();
    let asked = 0;
    const baseline = new ScriptedWorker();
    baseline.onSetChainMode = () => { baselineAsked = asked; };
    let baselineAsked = -1;
    const first = await table(baseline, () => { asked += 1; return base; });
    expect((await first.post({ op: "chain-mode", mode: "off" }, first.players[1]!)).status).toBe(200);
    expect(baselineAsked).toBeGreaterThan(0);

    // The same requests again, with the time jumping past every deadline from that moment on.
    asked = 0;
    const late = new ScriptedWorker();
    const second = await table(late, () => { asked += 1; return asked >= baselineAsked ? base + 36_000_000 : base; });
    const result = await second.post({ op: "chain-mode", mode: "off" }, second.players[1]!);
    // Settling at that moment put the seat out (the scripted worker cannot drive the bots that follow, hence no 200).
    expect(result.status).not.toBe(200);
    expect(second.duels.privateState(second.slug, "g").setup?.surrenderedSeats).toEqual([1]);
    expect(late.calls).toEqual([]);
    // No switch was journaled (the entries that are there are the autopilot answers of the seat that is out).
    expect(second.journal().filter((input) => input.command.promptId.startsWith("chain-mode:"))).toEqual([]);
  });

  it("leaves last_activity_at alone for a change that passes nothing, and moves it for one that passes a window", async () => {
    const t = await table();
    const activity = () => (t.db.prepare("select last_activity_at as at from duels where web_slug = ?").get(t.slug) as { at: string | null }).at;
    t.db.prepare("update duels set last_activity_at = '2001-01-01 00:00:00' where web_slug = ?").run(t.slug);
    expect((await t.post({ op: "chain-mode", mode: "always" })).status).toBe(200);
    expect(t.journal()).toHaveLength(1);
    expect(activity()).toBe("2001-01-01 00:00:00");
    expect((await t.post({ op: "chain-mode", mode: "off" }, t.players[1]!)).status).toBe(200);
    expect(t.journal()).toHaveLength(2);
    expect(activity()).not.toBe("2001-01-01 00:00:00");
  });

  it("numbers replay frames by the frames emitted, so skipped mode changes leave no gap", async () => {
    const t = await table();
    expect((await t.post({ op: "chain-mode", mode: "always" })).status).toBe(200); // passes nothing: no frame
    expect((await t.post({ op: "chain-mode", mode: "off" }, t.players[1]!)).status).toBe(200); // passes the window: a frame
    expect((await t.post({ op: "chain-mode", mode: "off" })).status).toBe(200); // passes nothing
    const view = (await t.post({ op: "view" }, t.players[2]!)).data.engine as DuelEngineView;
    const answered = await t.post({ op: "respond", command: { promptId: view.prompt!.id, revision: view.revision, answer: { choice: "pass" } } }, t.players[2]!);
    expect(answered.status, JSON.stringify(answered.data)).toBe(200);
    expect((await t.post({ op: "chain-mode", mode: "always" }, t.players[1]!)).status).toBe(200); // passes nothing
    expect(t.journal()).toHaveLength(5);
    t.duels.complete(t.slug, "g", 0, "Test end");
    t.restart(new ScriptedWorker());
    const replay = await t.post({ op: "replay" });
    expect(replay.status, JSON.stringify(replay.data)).toBe(200);
    const steps = (replay.data.frames as Array<{ step: number }>).map((frame) => frame.step);
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it("does nothing for the mode the seat already has", async () => {
    const t = await table();
    expect((await t.post({ op: "chain-mode", mode: "auto" })).status).toBe(200);
    expect(t.worker.calls).toEqual([]);
    expect(t.journal()).toHaveLength(0);
  });

  it("refuses every change once the journal holds its limit, and says so", async () => {
    const t = await table();
    for (let index = 0; index < CHAIN_MODE_JOURNAL_LIMIT; index += 1) {
      t.duels.recordCommand(t.slug, "g", 0, { promptId: `chain-mode:${index % 2 ? "always" : "auto"}`, revision: 1, answer: {} }, null);
    }
    const result = await t.post({ op: "chain-mode", mode: "off" });
    expect(result.status).toBe(409);
    expect(String(result.data.error ?? result.data.message)).toMatch(/limit/i);
    expect(t.worker.calls).toEqual([]);
    expect(t.journal()).toHaveLength(CHAIN_MODE_JOURNAL_LIMIT);
    // Answers still work.
    const view = (await t.post({ op: "view" }, t.players[1]!)).data.engine as DuelEngineView;
    const answered = await t.post({ op: "respond", command: { promptId: view.prompt!.id, revision: view.revision, answer: { choice: "pass" } } }, t.players[1]!);
    expect(answered.status).toBe(200);
  });

  it("starts from the duel setting and rebuilds every change from the journal", async () => {
    expect(defaultChainMode({ stopAtEveryWindow: false })).toBe("auto");
    const t = await table();
    expect((await t.post({ op: "chain-mode", mode: "always" })).status).toBe(200);
    expect((await t.post({ op: "chain-mode", mode: "off" }, t.players[1]!)).status).toBe(200);
    expect((await t.post({ op: "chain-mode", mode: "off" })).status).toBe(200);
    const rebuilt = new ScriptedWorker();
    t.restart(rebuilt);
    const view = await t.post({ op: "view" });
    expect(view.status, JSON.stringify(view.data)).toBe(200);
    // Replayed in order, each at the revision it was journaled at; the second one passed the window of seat 1.
    expect(rebuilt.calls).toEqual([{ seat: 0, mode: "always" }, { seat: 1, mode: "off" }, { seat: 0, mode: "off" }]);
    expect(view.data.engine.chainMode).toBe("off");
    expect(rebuilt.revision).toBe(2);
  });

  it("interrupts a rebuild whose saved revision does not match instead of guessing", async () => {
    const t = await table();
    expect((await t.post({ op: "chain-mode", mode: "off" })).status).toBe(200);
    const drifted = new ScriptedWorker();
    drifted.revision = 5;
    t.restart(drifted);
    expect((await t.post({ op: "view" })).status).toBe(409);
    expect(t.duels.get(t.slug, "g").status).toBe("interrupted");
  });
});
