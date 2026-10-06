import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelChainMode, DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { currentMultiWasm, describeWithCores, needs } from "./support/cores.js";

// A rebuild from the journal gives the same duel when the journal holds chain mode changes (real engine, multi core).
const multiWasmPath = currentMultiWasm();
const SECRET = "chain-mode-real";

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
  async setChainMode(seat: number, mode: DuelChainMode) { return this.game!.setChainMode(seat, mode); }
  async search(query: string): Promise<DuelCardInfo[]> { return this.game!.searchCards(query); }
  async close() {
    this.stopped = true;
    this.game?.close();
  }
}

const hosts: DuelHost[] = [];
afterEach(async () => { while (hosts.length > 0) await hosts.pop()!.close(); });

describeWithCores("chain mode in a duel on the multi core (real engine)", [needs.multi(multiWasmPath), needs.installedMulti(DATA)], () => {
  it("replays Auto, Off and a pass in order, and a rebuilt host shows the same duel", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const players = [0, 1, 2].map((index) =>
      seedIdentity(db, { guildId: "g1", name: `P${index}`, userId: seedUser(db, `u${index}`).userId, discordUserId: seedUser(db, `u${index}`).discordUserId ?? `u${index}` }).playerId);
    const duels = createDuelService(db);
    const session = duels.create({ guildId: "g1", organizerPlayerId: players[0]!, name: "Duel", mode: "normal", format: "ffa3" });
    for (const player of players.slice(1)) duels.takeSeat(session.slug, "g1", player);
    const deck = buildPracticeBotDeck("normal", DATA);
    for (const player of players) duels.setDeck(session.slug, "g1", player, deck);
    const makeHost = () => {
      const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => new RealEngineWorker() });
      hosts.push(host);
      return host;
    };
    const post = async (host: DuelHost, body: Record<string, unknown>, seat: number) => {
      const raw = JSON.stringify({ slug: session.slug, guildId: "g1", playerId: players[seat], ...body });
      const response = await host.handle(new Request("http://localhost/internal/duel", {
        method: "POST",
        headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") },
        body: raw,
      }));
      return { status: response.status, data: (await response.json()) as Record<string, any> };
    };
    const views = async (host: DuelHost) => Promise.all([0, 1, 2].map(async (seat) => (await post(host, { op: "view" }, seat)).data.engine as DuelEngineView));

    const host = makeHost();
    expect((await post(host, { op: "start" }, 0)).status).toBe(200);
    const holder = (await views(host)).findIndex((view) => view.prompt);
    expect(holder).toBeGreaterThanOrEqual(0);
    const other = (holder + 1) % 3;

    expect((await post(host, { op: "chain-mode", mode: "auto" }, other)).status).toBe(200);
    expect((await post(host, { op: "chain-mode", mode: "off" }, other)).status).toBe(200);
    const open = (await views(host))[holder]!;
    const answered = await post(host, { op: "respond", command: { promptId: open.prompt!.id, revision: open.revision, answer: { choice: open.prompt!.options[0]!.id } } }, holder);
    expect(answered.status, JSON.stringify(answered.data)).toBe(200);
    expect((await post(host, { op: "chain-mode", mode: "auto" }, holder)).status).toBe(200);

    const live = await views(host);
    expect(live[other]!.chainMode).toBe("off");
    expect(live[holder]!.chainMode).toBe("auto");
    // Nobody sees another seat's mode.
    expect(JSON.stringify(live.filter((_, seat) => seat !== other).map((view) => view.chainMode))).not.toContain("off");

    const rebuilt = await views(makeHost());
    expect(rebuilt).toEqual(live);
    const journal = duels.privateState(session.slug, "g1").commands.map((entry) => entry.command.promptId);
    expect(journal.filter((id) => id.startsWith("chain-mode:"))).toEqual(["chain-mode:auto", "chain-mode:off", "chain-mode:auto"]);
  }, 60_000);
});
