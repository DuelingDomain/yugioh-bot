import { seedIdentity, seedUser } from "../../shared/tests/helpers/identity.js";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelAnswer, DuelCardInfo, DuelChainMode, DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost } from "../src/host.js";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { compileBoard } from "./support/board.js";
import { describeWithCores, needs } from "./support/cores.js";
import { Session } from "./support/session.js";
import { JET_CASES, JET_CODE, type JetCase } from "./scenarios/multiplayer/jet-dragon.js";

/** Start at a real destruction prompt. Only setup is scripted; all messages and answers use the real core. */
class JetWorker implements DuelGameWorker {
  game: EngineGame | null = null;
  running = true;
  constructor(readonly entry: JetCase) {}
  async create(options: GameOptions) {
    const compiled = compileBoard(this.entry.scenario.setup);
    this.game = await createEngineGame({ ...options, ...compiled.options, dataDirectory: DATA,
      seed: ["1", "2", "3", "4"], settings: { ...compiled.options.settings!, stopAtEveryWindow: false } });
    const session = new Session(this.entry.scenario, this.game);
    session.reachMainPhase(); session.startRecording();
    for (const [index, step] of this.entry.scenario.steps.entries()) {
      session.run(step, index + 1);
      if (step.op === "expectPrompt") break;
    }
  }
  async view(seat: number | null) { return this.game!.view(seat); }
  async answer(seat: number, id: string, answer: DuelAnswer) { this.game!.answer(seat, id, answer); }
  async setChainMode(seat: number, mode: DuelChainMode) { return this.game!.setChainMode(seat, mode); }
  async search(): Promise<DuelCardInfo[]> { return []; }
  async close() { this.running = false; this.game?.close(); }
}

describeWithCores("host routes real hand/GY destruction triggers", [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
  for (const entry of JET_CASES.filter(entry => entry.role === "defender")) {
    it(entry.scenario.id, async () => {
      const db = new Database(":memory:"); migrate(db);
      const count = entry.scenario.setup.format === "1v1" ? 2 : entry.scenario.setup.format === "ffa3" ? 3 : 4;
      const players = Array.from({ length: count }, (_, seat) => seedIdentity(db, { guildId: "fixture", name: `P${seat}`, userId: seedUser(db, `p${seat}`).userId, discordUserId: seedUser(db, `p${seat}`).discordUserId ?? `p${seat}` }).playerId);
      const service = createDuelService(db);
      const room = service.create({ guildId: "fixture", organizerPlayerId: players[0]!, name: "Jet fixture", mode: entry.scenario.setup.mode!, format: entry.scenario.setup.format!, settings: { validateDeck: false } });
      for (const player of players.slice(1)) service.takeSeat(room.slug, "fixture", player);
      const decks = compileBoard(entry.scenario.setup).options.decks;
      for (const [seat, player] of players.entries()) {
        const deck = decks[seat]!;
        service.setDeck(room.slug, "fixture", player, { ...deck, main: [...deck.main, ...Array(40 - deck.main.length).fill(15025844)] });
      }
      const worker = new JetWorker(entry);
      const secret = "local-hand-test";
      const host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000, createWorker: () => worker });
      const post = async (seat: number, body: Record<string, unknown>) => {
        const raw = JSON.stringify({ slug: room.slug, guildId: "fixture", playerId: players[seat], ...body });
        const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
        return { status: response.status, data: await response.json() as { engine: DuelEngineView } };
      };
      try {
        const started = await post(0, { op: "start" }); expect(started.status, JSON.stringify(started.data)).toBe(200);
        const views = await Promise.all(players.map((_, seat) => post(seat, { op: "view" })));
        const own = views[entry.owner]!.data.engine;
        expect(own.chainMode).toBe("auto"); expect(own.prompt?.source?.code).toBe(JET_CODE);
        expect(own.prompt?.source?.zone).toMatchObject({ controller: entry.owner, location: entry.from === "hand" ? 2 : 16 });
        for (const [seat, view] of views.entries()) {
          expect(view.status).toBe(200);
          if (seat !== entry.owner) expect(view.data.engine.prompt).toBeNull();
        }
        const answer = { choice: own.prompt!.options.find(option => option.id === "yes" || option.card?.code === JET_CODE)!.id };
        const command = { promptId: own.prompt!.id, revision: own.revision, answer };
        const wrong = await post((entry.owner + 1) % count, { op: "respond", command });
        expect(wrong.status).toBe(409); expect(service.privateState(room.slug, "fixture").commands).toHaveLength(0);
        const accepted = await post(entry.owner, { op: "respond", command }); expect(accepted.status).toBe(200);
        expect(service.privateState(room.slug, "fixture").commands).toMatchObject([{ seat: entry.owner, command }]);
      } finally { await host.close(); db.close(); }
    });
  }
});
