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
  async setChainMode(seat: number, mode: DuelChainMode): Promise<boolean> {
    this.calls.push({ seat, mode });
    this.modes[seat] = mode;
    if (mode === "off" && this.holder === seat) {
      this.holder = 2;
      this.revision += 1;
      return true;
    }
    return false;
  }
  async close() { this.running = false; }
}

async function table(worker = new ScriptedWorker()) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const players = [0, 1, 2].map((seat) =>
    Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(`u${seat}`, `P${seat}`).lastInsertRowid));
  const outsider = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', 'out', 'Out')").run().lastInsertRowid);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "chain", mode: "normal", format: "ffa3" });
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g", player, deck);
  const changes: string[] = [];
  const makeHost = (w: DuelGameWorker) => {
    const host = createDuelHost({
      db, secret: SECRET, dataDirectory: DATA, searchCards: () => [], pollIntervalMs: 60_000,
      createWorker: () => w, onChange: (slug) => { changes.push(slug); },
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
