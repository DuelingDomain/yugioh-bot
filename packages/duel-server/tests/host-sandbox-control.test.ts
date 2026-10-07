import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelEngineView, type SandboxRun } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker, type DuelGameWorker, type GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "sandbox-test-secret";
const run: SandboxRun = { bots: { "1": "pass", "2": "pass", "3": "pass" } };
const board = { p0: { hand: [15025844], spells: [{ card: 83968380, pos: "set" }] } };
interface Control {
  promptSeat: number;
  phaseWindow?: boolean;
  phaseAfterAnswer?: boolean;
  announce?: boolean;
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
  }
  async view(viewer: number | null): Promise<DuelEngineView> {
    const seat = this.control.phaseWindow || this.control.phaseAfterAnswer || this.revision === 0 ? this.control.promptSeat : 0;
    const boundary = (this.control.phaseWindow && this.revision < 2) || (this.control.phaseAfterAnswer && this.revision > 0 && this.revision < 3);
    return { revision: this.revision, turn: 1, turnSeat: seat, phase: "main1", prioritySeat: seat,
      seats: Array.from({ length: seatCountFor(this.created?.format ?? "1v1") }, (_, index) => ({
        seat: index, lp: 8000, deckCount: 20, extraCount: 1,
        hand: [{ controller: index, location: 2, sequence: 0, position: 10, ...(viewer === index ? { code: 15025844 } : {}) }],
        extra: [{ controller: index, location: 64, sequence: 0, position: 10, ...(viewer === index ? { code: 84013237 } : {}) }],
        monsters: [], spells: [], graveyard: [], banished: [],
      })),
      prompt: viewer === seat ? { id: `prompt-${this.revision}`, seat, kind: this.control.announce ? "announce-card" : "choice", title: "Choose",
        options: boundary ? [{ id: "num:0", label: "Number", values: [0x53425800] }] : [{ id: "to_ep", label: "End turn" }], min: 1, max: 1, cancelable: false } : null,
      chain: [], events: [], log: [], result: null };
  }
  async answer() { this.revision++; }
  async search() { return [{ code: 15025844, name: "Mystical Elf", description: "", type: 1, attack: 800, defense: 2000, level: 4, attribute: 16, race: "Spellcaster" }]; }
  async close() { this.running = false; }
}

function setup(real = false, paced = false) {
  vi.stubEnv("DUEL_SCENARIOS", "0");
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const db = new Database(":memory:");
  migrate(db);
  const player = (id: string) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)",
  ).run(id, id).lastInsertRowid);
  const owner = player("owner"), other = player("other");
  const duels = createDuelService(db);
  const control: Control = { promptSeat: 0 };
  const workers: DuelGameWorker[] = [];
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [],
    botStepDelayMs: paced ? 1 : 0, pollIntervalMs: 3_600_000, idleWorkerMs: 3_600_000, stallMs: 0, queueBlockedMs: 0,
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
  return { db, duels, host, owner, other, workers, control, post, start };
}

const manualRun = { ...run, bots: { ...run.bots, "1": "manual" as const } };
describe("sandbox seat control", () => {
  it.each([0, 1])("automatically answers empty phase hooks for Manual seat %i", async (seat) => {
    const t = setup();
    t.control.promptSeat = seat;
    t.control.phaseWindow = true;
    const slug = await t.start({ run: manualRun });
    const result = await t.post("view", { slug, as: seat });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.prompt.options[0].id).toBe("to_ep");
    const commands = t.duels.privateState(slug, "g").commands;
    expect(commands).toHaveLength(2);
    expect(commands.every((entry) => entry.seat === seat && entry.command.answer.choice === "num:0")).toBe(true);
  });
  it.each([false, true])("passes empty hooks after a Manual response (paced=%s)", async (paced) => {
    const t = setup(false, paced);
    t.control.promptSeat = 1;
    t.control.phaseAfterAnswer = true;
    const slug = await t.start({ run: manualRun });
    const before = (await t.post("view", { slug, as: 1 })).data.engine;
    const result = await t.post("respond", { slug, as: 1, command: {
      promptId: before.prompt.id, revision: before.revision, answer: { choice: "to_ep" },
    } });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.revision).toBe(3);
    expect(result.data.engine.prompt.options[0].id).toBe("to_ep");
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(3);
  });
  it("acts as seat 1, reveals hands, journals that seat, and switches back", async () => {
    const t = setup(); t.control.promptSeat = 1;
    const slug = await t.start({ board: { p1: { hand: [15025844] } }, run: manualRun });
    const room = await t.post("view", { slug, as: 1, reveal: true });
    expect(room.status, room.data.error).toBe(200);
    expect(room.data.mySeat).toBe(1);
    expect(room.data.myDeck.main).toContain(15025844);
    expect(room.data.engine.prompt.seat).toBe(1);
    expect(room.data.engine.seats.every((s: any) => s.hand[0]?.code && s.extra[0]?.code)).toBe(true);
    expect(room.data.sandbox.run.bots["1"]).toBe("manual");
    const answer = await t.post("respond", { slug, as: 1, command: {
      promptId: room.data.engine.prompt.id, revision: room.data.engine.revision, answer: { choice: "to_ep" },
    } });
    expect(answer.status, answer.data.error).toBe(200);
    expect(answer.data.mySeat).toBe(1);
    expect(t.duels.privateState(slug, "g").commands[0].seat).toBe(1);
    const back = (await t.post("view", { slug, as: 0, reveal: false })).data;
    expect(back.mySeat).toBe(0);
    expect(back.engine.prompt.seat).toBe(0);
    expect(back.engine.seats[1].hand[0].code).toBeUndefined();
  });
  it("passes at once when control changes, and persists recovery modes", async () => {
    const t = setup(); t.control.promptSeat = 1;
    const slug = await t.start({ run: manualRun });
    const changed = await t.post("sandbox-control", { slug, seat: 1, control: "pass" });
    expect(changed.status, changed.data.error).toBe(200);
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(1);
    expect((await t.post("view", { slug, as: 1 })).status).toBe(409);
    expect((await t.post("sandbox-control", { slug, seat: 1, control: "manual" })).status).toBe(200);
    await t.workers[0].close();
    expect((await t.post("view", { slug, as: 1 })).status).toBe(200);
    expect(t.duels.privateState(slug, "g").setup?.sandbox?.run.bots["1"]).toBe("manual");
  });
  it.each([1, 2, 3])("searches announce-card choices as Manual seat %i", async (seat) => {
    const t = setup(); t.control.promptSeat = seat; t.control.announce = true;
    const slug = await t.start({ board: { format: "ffa4" }, run: { bots: { "1": "manual", "2": "manual", "3": "manual" } } });
    const result = await t.post("cards", { slug, as: seat, query: "Mystical" });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.cards[0].code).toBe(15025844);
    expect((await t.post("cards", { slug, query: "Mystical" })).status).toBe(409);
    expect((await t.post("cards", { slug, as: seat, query: "Mystical", playerId: t.other })).status).toBe(403);
    expect((await t.post("cards", { slug, as: 4, query: "Mystical" })).status).toBe(400);
    const regular = t.duels.create({ guildId: "g", organizerPlayerId: t.owner, name: "Normal", mode: "normal" });
    expect((await t.post("cards", { slug: regular.slug, as: seat, query: "Mystical" })).status).toBe(409);
  });
  it("surrenders the acting seat", async () => {
    const t = setup(), slug = await t.start({ run: manualRun });
    const result = await t.post("surrender", { slug, as: 1 });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.session.winnerSeat).toBe(0);
    expect(result.data.mySeat).toBe(1);
  });
  it("returns the last real state after the safe step limit", async () => {
    const t = setup(), slug = await t.start();
    const result = await t.post("sandbox-next-turn", { slug });
    expect(result.status, result.data.error).toBe(200);
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(128);
    expect(result.data.engine).toMatchObject({ phase: "main1", turn: 1, revision: 128 });
  });
  it("still drives a recovered bot when no phase walk stopped it", async () => {
    const t = setup(); t.control.promptSeat = 1;
    const slug = await t.start({ run: manualRun });
    const saved = t.duels.privateState(slug, "g").setup!;
    t.duels.setSetup(slug, "g", { ...saved, sandbox: { ...saved.sandbox!, run } });
    await t.workers[0].close();
    expect((await t.post("view", { slug })).status).toBe(200);
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(1);
    expect(t.duels.privateState(slug, "g").commands[0].seat).toBe(1);
  });
  it("uses practice control at once and restores it on recovery", async () => {
    const t = setup(); t.control.promptSeat = 1;
    const slug = await t.start({ run: manualRun });
    const result = await t.post("sandbox-control", { slug, seat: 1, control: "practice" });
    expect(result.status, result.data.error).toBe(200);
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(1);
    expect(t.duels.privateState(slug, "g").setup?.sandbox?.run.bots["1"]).toBe("practice");
    await t.workers[0].close();
    expect((await t.post("view", { slug })).status).toBe(200);
    expect((await t.post("view", { slug, as: 1 })).status).toBe(409);
  });
  it("returns the correct final seat view without leaking hidden cards", async () => {
    const t = setup(), slug = await t.start({ run: manualRun });
    await t.post("surrender", { slug, as: 1 });
    const room = (await t.post("view", { slug, as: 1, reveal: false })).data;
    expect(room.mySeat).toBe(1);
    expect(room.engine.seats[0].hand[0].code).toBeUndefined();
    expect(room.engine.seats[1].hand[0].code).toBe(15025844);
    const revealed = (await t.post("view", { slug, as: 0, reveal: true })).data;
    expect(revealed.engine.seats.every((s: any) => s.hand[0]?.code && s.extra[0]?.code)).toBe(true);
    expect(revealed.engine.prompt).toBeNull();
  });
  it("rejects unauthorized overrides, reveal, control, and phase operations", async () => {
    const t = setup(), slug = await t.start();
    const regular = t.duels.create({ guildId: "g", organizerPlayerId: t.owner, name: "Regular", mode: "normal" }).slug;
    for (const [op, args] of [
      ["view", { as: 1 }], ["view", { reveal: true }], ["respond", { as: 1 }], ["surrender", { as: 1 }],
      ["sandbox-control", { seat: 1, control: "pass" }], ["sandbox-phase", { to: "battle" }], ["sandbox-next-turn", {}],
    ] as const) {
      expect((await t.post(op, { slug, playerId: t.other, ...args })).status).toBe(403);
      expect((await t.post(op, { slug: regular, ...args })).status).toBe(409);
    }
    expect((await t.post("view", { slug, playerId: t.other, spectate: true })).status).toBe(403);
    for (const extra of [{ as: "1" }, { as: 4 }, { reveal: "true" }]) expect((await t.post("view", { slug, ...extra })).status).toBe(400);
    for (const extra of [{ seat: 0, control: "pass" }, { seat: 2, control: "manual" }, { seat: 1, control: "bad" }]) {
      expect((await t.post("sandbox-control", { slug, ...extra })).status).toBe(400);
    }
    expect((await t.post("sandbox-phase", { slug, to: "draw" })).status).toBe(400);
  });
});
describeWithCores("sandbox real phase control", [needs.standard(DATA), needs.cards(DATA)], () => {
  it("accepts Continue at a stopped phase hook before driving normal play", async () => {
    const t = setup(true), slug = await t.start({ board: { attackFirstTurn: true }, run: manualRun });
    await t.post("sandbox-next-turn", { slug });
    const walked = (await t.post("view", { slug, as: 1 })).data.engine;
    expect(walked.prompt.options[0].id).toBe("num:0");
    const result = await t.post("respond", { slug, as: 1, command: {
      promptId: walked.prompt.id, revision: walked.revision, answer: { choice: "num:0" },
    } });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.revision).toBeGreaterThan(walked.revision);
    expect(result.data.engine.prompt?.title).not.toBe("Continue this phase");
  }, 30_000);
  it("walks 1v1 through battle, main2, and end with journaled phase answers", async () => {
    const t = setup(true), slug = await t.start({ board: { attackFirstTurn: true, startAt: "main1" } });
    for (const to of ["main1", "battle", "main2", "end"]) {
      const result = await t.post("sandbox-phase", { slug, to });
      expect(result.status, result.data.error).toBe(200);
      expect(result.data.engine.phase).toBe(to === "battle" ? "battle_start" : to);
    }
    const choices = t.duels.privateState(slug, "g").commands.map((c) => (c.command.answer as { choice?: string }).choice).filter(Boolean);
    expect(choices).toEqual(expect.arrayContaining(["to_bp", "to_m2", "to_ep"]));
  }, 30_000);
  it("resumes a Practice seat after Next turn so it plays its cards", async () => {
    const t = setup(true);
    const slug = await t.start({ board: { p1: { hand: [15025844] } },
      run: { ...run, bots: { ...run.bots, "1": "practice" } } });
    const result = await t.post("sandbox-next-turn", { slug });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.seats[1].monsters.some((card: unknown) => card !== null)).toBe(true);
    expect(result.data.engine.turnSeat).toBe(0);
    expect(t.duels.privateState(slug, "g").commands.at(-1)?.command).not.toMatchObject({ note: "sandbox: phase walk" });
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine).toEqual(result.data.engine);
  }, 30_000);
  it("preserves the opening Draw effect window", async () => {
    const t = setup(true), slug = await t.start();
    const first = (await t.post("view", { slug })).data.engine;
    expect(first.phase).toBe("draw");
    expect(first.seats[0].hand).toHaveLength(2);
    expect(first.prompt.options.some((option: any) => option.card?.code === 83968380)).toBe(true);
  }, 30_000);
  it("passes empty opening hooks and replays phase commands on recovery and restart", async () => {
    const t = setup(true), slug = await t.start({ board: { attackFirstTurn: true, startAt: "main1" } });
    const first = (await t.post("view", { slug })).data.engine;
    expect(first.phase).toBe("main1");
    expect(first.seats[0].hand).toHaveLength(1);
    expect(first.prompt.title).not.toBe("Continue this phase");
    const walked = (await t.post("sandbox-phase", { slug, to: "main2" })).data.engine;
    expect(walked.phase).toBe("main2");
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine).toEqual(walked);
    const restarted = await t.post("sandbox-restart", { slug });
    expect(restarted.status, restarted.data.error).toBe(200);
    expect((await t.post("view", { slug: restarted.data.slug })).data.engine).toEqual(first);
  }, 30_000);
  it("does not skip a blocked Battle Phase or move back to an earlier phase", async () => {
    const t = setup(true), slug = await t.start({ board: {} });
    const battle = await t.post("sandbox-phase", { slug, to: "battle" });
    expect(battle.status, battle.data.error).toBe(200);
    expect(battle.data.engine.phase).toBe("main1");
    const count = t.duels.privateState(slug, "g").commands.length;
    const back = await t.post("sandbox-phase", { slug, to: "standby" });
    expect(back.data.engine.phase).toBe("main1");
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(count);
  }, 30_000);
  it("stops on another Manual seat's effect and exposes it only to that seat", async () => {
    const t = setup(true), slug = await t.start({ board: { p1: { spells: [{ card: 83968380, pos: "set" }] } }, run: manualRun });
    const result = await t.post("sandbox-phase", { slug, to: "main1", reveal: true });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.phase).toBe("draw");
    expect(result.data.engine.prioritySeat).toBe(1);
    expect(result.data.engine.prompt).toBeNull();
    const other = await t.post("view", { slug, as: 1, reveal: true });
    expect(other.data.engine.prompt.seat).toBe(1);
    expect(JSON.stringify(other.data.engine.prompt)).toContain("83968380");
    const count = t.duels.privateState(slug, "g").commands.length;
    await t.post("sandbox-phase", { slug, to: "main1", as: 1 });
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(count);
  }, 30_000);
  it("stops at a Standby trigger so the owner can act", async () => {
    const t = setup(true), slug = await t.start({ board: { p0: { grave: [12538374] } } }); // Treeborn Frog
    const result = await t.post("sandbox-phase", { slug, to: "main1" });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.phase).toBe("standby");
    expect(result.data.engine.prompt).not.toBeNull();
    expect(JSON.stringify(result.data.engine.prompt)).toContain("12538374");
    const count = t.duels.privateState(slug, "g").commands.length;
    await t.post("sandbox-phase", { slug, to: "main1" });
    expect(t.duels.privateState(slug, "g").commands).toHaveLength(count);
  }, 30_000);
});
describeWithCores("sandbox multi phase control", [needs.installedMulti(DATA), needs.cards(DATA)], () => {
  it("walks ffa3 to the next turn without skipping it with bots", async () => {
    const t = setup(true), slug = await t.start({ board: { format: "ffa3", attackFirstTurn: true } });
    const first = (await t.post("view", { slug })).data.engine;
    const result = await t.post("sandbox-next-turn", { slug });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data.engine.turn).toBe(first.turn + 1);
    expect(result.data.engine.turnSeat).toBe(1);
    expect(result.data.engine.phase).toBe("draw");
    expect((await t.post("view", { slug })).data.engine).toEqual(result.data.engine);
    await t.workers[0].close();
    expect((await t.post("view", { slug })).data.engine).toEqual(result.data.engine);
  }, 30_000);
});
