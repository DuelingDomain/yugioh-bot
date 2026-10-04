import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

// Task ELIM: the host removes a seat while a prompt is open, then rebuilds the duel from the journal.
// The worker below runs the real engine in this process, on a multi core that has Debug.EliminateDuelist.
const multiWasmPath = currentMultiWasm();
const SECRET = "eliminate-secret";

class RealEngineWorker implements DuelGameWorker {
  game: EngineGame | null = null;
  private stopped = false;
  get running() { return !this.stopped; }
  async create(options: GameOptions) {
    const bytes = readFileSync(multiWasmPath);
    const multiWasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.game = await createEngineGame({ ...options, multiWasmBinary });
  }
  async view(seat: number | null) { return this.game!.view(seat); }
  async answer(seat: number, promptId: string, answer: DuelAnswer) { this.game!.answer(seat, promptId, answer); }
  async eliminate(seat: number, reason: number, atTurnEnd = false) { this.game!.eliminate(seat, reason, atTurnEnd); }
  async search(query: string): Promise<DuelCardInfo[]> { return this.game!.searchCards(query); }
  async close() {
    this.stopped = true;
    this.game?.close();
  }
}

const hosts: DuelHost[] = [];
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.close();
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

function makeHost(db: Database.Database, worker: DuelGameWorker): DuelHost {
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker });
  hosts.push(host);
  return host;
}

/** A table of humans only (no bots: every prompt waits for a human or an elimination). */
async function table(format: DuelFormat, humans: number) {
  const db = new Database(":memory:");
  migrate(db);
  const players: number[] = [];
  for (let index = 0; index < humans; index += 1) {
    players.push(Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", `u${index}`, `P${index}`).lastInsertRowid));
  }
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Duel", mode: "normal", format });
  const worker = new RealEngineWorker();
  const host = makeHost(db, worker);
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g1", player);
  const deck = buildPracticeBotDeck("normal", DATA);
  for (const player of players) duels.setDeck(session.slug, "g1", player, deck);
  const organizer = { slug: session.slug, guildId: "g1", playerId: players[0]! };
  const view = async (h: DuelHost, seat: number) => (await post(h, { op: "view", slug: session.slug, guildId: "g1", playerId: players[seat] })).data.engine as DuelEngineView;
  return { db, duels, host, worker, players, organizer, slug: session.slug, view };
}

/** The seat that holds the open prompt. */
async function holderOf(t: Awaited<ReturnType<typeof table>>, seats: number): Promise<number> {
  for (let seat = 0; seat < seats; seat += 1) if ((await t.view(t.host, seat)).prompt) return seat;
  throw new Error("No prompt is open");
}

describeWithCores("host eliminates a seat while a prompt is open (real engine)", [needs.multi(multiWasmPath), needs.installedMulti(DATA)], () => {
  it("removes the seat that holds the prompt, and a rebuild from the journal gives the same view", async () => {
    const t = await table("ffa3", 3);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    const holder = await holderOf(t, 3);
    expect((await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[holder] })).status).toBe(200);
    const live = await Promise.all([0, 1, 2].map((seat) => t.view(t.host, seat)));
    expect(live[0]!.seats[holder]!.eliminated).toBe(true);
    expect(live[0]!.result ?? null).toBeNull();
    expect(live.some((view) => view.prompt)).toBe(true);
    const state = t.duels.privateState(t.slug, "g1");
    expect(state.commands.map((entry) => entry.command.promptId)).toEqual(["eliminate:0"]);
    expect(live[0]).toMatchObject({ turn: 2, turnSeat: 1 });
    // The engine finishes the leaver's prompt as part of the immediate loss command.
    expect(state.commands).toHaveLength(1);

    const worker2 = new RealEngineWorker();
    const host2 = makeHost(t.db, worker2);
    const rebuilt = await Promise.all([0, 1, 2].map((seat) => t.view(host2, seat)));
    expect(rebuilt).toEqual(live);
  }, 60_000);

  it("removes another seat at once, keeps the living prompt, and recovers the same view", async () => {
    const t = await table("ffa4", 4);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    const holder = await holderOf(t, 4);
    const leaver = (holder + 2) % 4;
    const before = await t.view(t.host, holder);
    expect((await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[leaver] })).status).toBe(200);
    const during = await t.view(t.host, holder);
    expect(during.prompt?.id).toBe(before.prompt?.id);
    expect(during.seats[leaver]).toMatchObject({ eliminated: true, pendingElimination: false });
    expect(t.duels.get(t.slug, "g1").status).toBe("active");

    // Rebuild with the prompt still open: same view, with no pending loss.
    const worker2 = new RealEngineWorker();
    const host2 = makeHost(t.db, worker2);
    expect(await t.view(host2, holder)).toEqual(during);

    // The holder can still end its turn after the loss.
    const answered = await post(host2, {
      op: "respond", slug: t.slug, guildId: "g1", playerId: t.players[holder],
      command: { promptId: during.prompt!.id, revision: during.revision, answer: { choice: "to_ep" } },
    });
    expect(answered.status).toBe(200);
    const after = await Promise.all([0, 1, 2, 3].map((seat) => t.view(host2, seat)));
    expect(after[0]!.seats[leaver]!.eliminated).toBe(true);
    expect(after[0]!.seats[leaver]!.pendingElimination).toBe(false);

    const worker3 = new RealEngineWorker();
    const host3 = makeHost(t.db, worker3);
    const rebuilt = await Promise.all([0, 1, 2, 3].map((seat) => t.view(host3, seat)));
    expect(rebuilt).toEqual(after);
  }, 60_000);

  it.each(["ffa3", "ffa4"] as const)("%s: ends the duel at once when all other seats surrender", async (format) => {
    const count = format === "ffa3" ? 3 : 4;
    const t = await table(format, count);
    expect((await post(t.host, { op: "start", ...t.organizer })).status).toBe(200);
    const holder = await holderOf(t, count);
    const others = Array.from({ length: count }, (_, seat) => seat).filter((seat) => seat !== holder);
    for (const [index, seat] of others.entries()) {
      expect((await post(t.host, { op: "surrender", slug: t.slug, guildId: "g1", playerId: t.players[seat] })).status).toBe(200);
      if (index < others.length - 1) expect(t.duels.get(t.slug, "g1").status).toBe("active");
    }
    const session = t.duels.get(t.slug, "g1");
    expect(session.status).toBe("completed");
    expect(session.winnerSeat).toBe(holder);
    for (let seat = 0; seat < count; seat++) {
      const view = await t.view(t.host, seat);
      expect(view.result?.winnerSeat).toBe(holder);
      expect(view.prompt).toBeNull();
    }
  }, 60_000);
});
