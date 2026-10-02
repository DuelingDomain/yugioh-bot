import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { MULTIPLAYER_TABLES_OFF_MESSAGE, seatCountFor, type DuelAnswer, type DuelCardInfo, type DuelDeck, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "flag-secret";

/** A fake core that counts the games the host asks it to make. */
class FakeWorker implements DuelGameWorker {
  created: GameOptions | null = null;
  private stopped = false;
  get running() { return !this.stopped; }
  async create(options: GameOptions) { this.created = options; }
  async view(seat: number | null): Promise<DuelEngineView> {
    return {
      revision: 1, turn: 1, turnSeat: 0, phase: "main1",
      seats: Array.from({ length: seatCountFor(this.created?.format ?? "1v1") }, (_, index) => ({
        seat: index, lp: 8000, hand: [], deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
      })),
      prompt: seat === 0 ? { id: "p1", seat: 0, kind: "choice", title: "Main", options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } } : null,
      chain: [], events: [], log: [], result: null,
    } as unknown as DuelEngineView;
  }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {}
  async search(): Promise<DuelCardInfo[]> { return []; }
  async close() { this.stopped = true; }
}

const hosts: DuelHost[] = [];
const saved = process.env.MULTIPLAYER_TABLES;
beforeEach(() => { delete process.env.MULTIPLAYER_TABLES; });
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
  if (saved === undefined) delete process.env.MULTIPLAYER_TABLES;
  else process.env.MULTIPLAYER_TABLES = saved;
});

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(new Request("http://localhost/internal/duel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-announce-signature": signature },
    body: raw,
  }));
  return { status: response.status, data: (await response.json()) as Record<string, any> };
}

function rotated(deck: DuelDeck, by: number): DuelDeck {
  return { ...deck, main: [...deck.main.slice(by), ...deck.main.slice(0, by)] };
}

/** A full table: a human at seat 0 and a practice bot at every other seat. */
async function table(format: DuelFormat) {
  const db = new Database(":memory:");
  migrate(db);
  const player = Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", "u0", "P0").lastInsertRowid);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: player, name: "Duel", mode: "normal", format });
  const worker = new FakeWorker();
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker });
  hosts.push(host);
  const organizer = { slug: session.slug, guildId: "g1", playerId: player };
  for (let seat = 1; seat < seatCountFor(format); seat += 1) {
    // Seed an existing lobby directly: bot fill through the host is itself gated when tables are off.
    duels.addPracticeBot(session.slug, "g1", player, buildPracticeBotDeck("normal", DATA), seat);
  }
  duels.setDeck(session.slug, "g1", player, rotated(buildPracticeBotDeck("normal", DATA), 1));
  return { host, worker, organizer, duels };
}

describe("duel host with MULTIPLAYER_TABLES off", () => {
  it.each<DuelFormat>(["tag", "ffa3", "ffa4"])("refuses to start a %s table and makes no game", async (format) => {
    const t = await table(format);
    const started = await post(t.host, { op: "start", ...t.organizer });
    expect(started.status).toBe(403);
    expect(started.data.error).toBe(MULTIPLAYER_TABLES_OFF_MESSAGE);
    expect(t.worker.created).toBeNull();
    expect(t.duels.get(t.organizer.slug, "g1").status).toBe("lobby");
  });

  it("starts a 1v1 table as before, with no format option", async () => {
    const t = await table("1v1");
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    expect(t.worker.created).not.toHaveProperty("format");
  });

  it("treats 0, off and false as off", async () => {
    for (const value of ["0", "off", "false", ""]) {
      process.env.MULTIPLAYER_TABLES = value;
      const t = await table("ffa3");
      expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(403);
    }
  });
});

describe("duel host with MULTIPLAYER_TABLES on", () => {
  it.each(["1", "true", "on"])("starts a 4-seat table when the flag is %j", async (value) => {
    process.env.MULTIPLAYER_TABLES = value;
    const t = await table("ffa4");
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    expect(t.worker.created?.format).toBe("ffa4");
  });

  it("reads the flag at each start, not once when the host is made", async () => {
    const t = await table("ffa3");
    process.env.MULTIPLAYER_TABLES = "1";
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
  });
});
