import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelAnswer, DuelReplayV2, ReplayForkResult } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { getCurrentEngineResources } from "../src/engine-resource-resolver.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { compileBoard } from "../src/presets/board.js";
import { seedIdentity } from "./helpers/identity.js";
import { describeWithCores, needs } from "./support/cores.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

// Record with the pre-v8 Auto algorithm, independently of the compatibility flag.
// Actual replay runs in a real worker thread, which does not inherit this Vitest mock.
vi.mock("../src/chain-mode.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/chain-mode.js")>(),
  chainWindowPasses: (window: { forced: boolean; spe_count: number }, mode: string, phase?: string) =>
    !window.forced && (mode === "off" || mode === "auto" && window.spe_count === 0 && phase !== "draw" && phase !== "standby"),
}));

const HONEST = 37742478, DRAGON = 89631139, DEFENDER = 43096270;
const guildId = "damage-step-replay", secret = "damage-step-replay-secret";
afterEach(() => vi.unstubAllEnvs());

describeWithCores("v7 Damage Step replay compatibility", [needs.cards(), needs.standard(), needs.domain()], () => {
  it.each(["normal", "domain"] as const)("replays and verifies a %s Auto journal that skipped the defender's Honest", async mode => {
    vi.stubEnv("OWNER_USER_IDS", "201");
    const db = new Database(":memory:"); migrate(db);
    let host: DuelHost | undefined;
    const compiled = compileBoard({ mode, attackFirstTurn: true, skipOpeningDraw: true,
      p0: { monsters: [DRAGON], ...(mode === "domain" ? { deckMaster: "Mystical Elf" } : {}) },
      p1: { monsters: [DEFENDER], hand: [HONEST], ...(mode === "domain" ? { deckMaster: "Mystical Elf" } : {}) } }, DATA);
    const settings = { ...compiled.options.settings!, stopAtEveryWindow: false, turnSeconds: 0 };
    const seed = ["1", "2", "3", "4"];
    const game = await createEngineGame({ ...compiled.options, settings, seed, dataDirectory: DATA });
    try {
      for (const playerId of [201, 202]) seedIdentity(db, { guildId, userId: playerId, playerId });
      const service = createDuelService(db), session = service.create({ guildId, organizerPlayerId: 201,
        name: "v7 Auto Honest", mode, format: "1v1", settings });
      db.prepare("delete from duel_seats where duel_id=?").run(session.id);
      for (const [seat, deck] of compiled.options.decks.entries()) db.prepare(
        "insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
        .run(session.id, seat, 201 + seat, JSON.stringify(deck));
      const resources = getCurrentEngineResources(DATA, { mode, engine: "pinned" });
      const recordedIdentity = { ...resources.identity, hostRuleVersion: "duel-rules-7:null" };
      db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?")
        .run(JSON.stringify(seed), resources.bundleVersion, JSON.stringify({ engine: "pinned", firstTurnDraw: false,
          scriptErrorMode: "strict", startupScripts: compiled.options.startupScripts!.map(s => s.content),
          engineIdentity: recordedIdentity }), session.id);
      let attackedTurn = 0, finishedBattle = false;
      for (let guard = 0; guard < 100; guard++) {
        const view = [game.view(0), game.view(1)].find(v => v.prompt)!;
        const prompt = view.prompt!;
        if (!finishedBattle && attackedTurn === view.turn && prompt.options.some(o => o.id === "to_m2")) {
          finishedBattle = true;
          expect(game.view(1).seats[1]!.hand.some(c => c.code === HONEST)).toBe(true);
          expect(game.view(null).seats[1]!.lp).toBe(7000);
        }
        let answer: DuelAnswer;
        const action = prompt.options.find(o => o.id === "to_bp" || attackedTurn !== view.turn && o.id.startsWith("attack:") || o.id === "to_m2");
        if (action) {
          if (action.id.startsWith("attack:")) attackedTurn = view.turn;
          answer = { choice: action.id };
        } else if (/attack target/i.test(prompt.title) && prompt.kind === "choice") {
          answer = { choice: prompt.options.find(o => o.controller === 1 && o.location === 4)!.id };
        } else answer = chooseSurrenderedAnswer(prompt);
        service.recordCommand(session.slug, guildId, prompt.seat, { revision: view.revision, promptId: prompt.id, answer }, null);
        game.answer(prompt.seat, prompt.id, answer);
        if (game.view(null).result) break;
      }
      expect(finishedBattle).toBe(true);
      const final = game.view(null);
      expect(final.result?.winnerSeat).toBe(0);
      service.complete(session.slug, guildId, 0, final.result!.reason,
        { public: final, seat0: game.view(0), seat1: game.view(1) });
      host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      for (const unchecked of [true, false]) {
        const raw = JSON.stringify({ op: "replay", slug: session.slug, guildId, playerId: 201, version: 2, unchecked });
        const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: signedRequestHeaders({ url: "http://localhost/internal/duel", method: "POST", body: raw, secret, purpose: "duel-host" }) }));
        const body = await response.json();
        expect({ status: response.status, body }).toMatchObject({ status: 200,
          body: { verification: unchecked ? "unverified" : "verified" } });
      }
      expect(db.prepare("select result,reason from duel_replay_verifications where duel_id=?").get(session.id))
        .toEqual({ result: "verified", reason: null });
      expect(service.privateState(session.slug, guildId).setup?.engineIdentity).toEqual(recordedIdentity);
      const post = async (input: Record<string, unknown>) => {
        const raw = JSON.stringify({ slug: session.slug, guildId, playerId: 201, ...input });
        const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
          headers: signedRequestHeaders({ url: "http://localhost/internal/duel", method: "POST", body: raw, secret, purpose: "duel-host" }) }));
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return body;
      };
      const replay = await post({ op: "owner-replay", version: 2 }) as DuelReplayV2;
      const frame = replay.frames.find(f => f.cursor && f.view.phase === "main2")!;
      expect(frame).toBeDefined();
      const fork = await post({ op: "replay-fork", sourceVersion: replay.sourceVersion, cursor: frame.cursor,
        requestId: "v7-damage-step-fork" }) as ReplayForkResult;
      await host.close();
      host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
      const recovered = await post({ op: "view", slug: fork.slug, as: fork.initialSeat });
      expect(recovered.engine).toEqual(fork.room.engine);
      const restarted = await post({ op: "fork-restart", slug: fork.slug });
      expect(restarted.engine).toEqual(fork.room.engine);
    } finally { game.close(); await host?.close(); db.close(); }
  }, 30_000);
});
