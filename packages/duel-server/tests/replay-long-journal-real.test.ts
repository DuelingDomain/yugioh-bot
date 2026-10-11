import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelRoom, ReplayForkResult } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildReplayFrames } from "../src/replay-builder.js";
import { createReplayCursorCodec, replaySourceVersion } from "../src/replay-cursor.js";
import { multiScriptsFolderHash, pinnedEngineVersion, repoMultiScriptsDirectory } from "../src/multi-scripts.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { seedIdentity } from "./helpers/identity.js";
import { replaySource } from "./support/replay-fixtures.js";

describeWithCores("long stored journals", [needs.cards(DATA), needs.scripts(DATA), needs.installedMulti(DATA)], () => {
  it("replays, forks, recovers and restarts a 1,500-command FFA4 journal", async () => {
    vi.stubEnv("OWNER_USER_IDS", "101");
    const db = new Database(":memory:"); migrate(db);
    const owner = { guildId: "test-guild", playerId: 61, userId: 101 };
    seedIdentity(db, owner);
    for (let seat = 0; seat < 4; seat++) seedIdentity(db, { guildId: owner.guildId, playerId: seat + 1, userId: seat + 201 });
    const source = replaySource("ffa4"); source.commands = [];
    source.decks = Array.from({ length: 4 }, () => ({ main: Array(800).fill(15025844), extra: [], side: [] }));
    source.session.settings = { ...source.session.settings, validateDeck: false, shuffleDeck: false, turnSeconds: 0 };
    const bundleVersion = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")).bundleVersion as string;
    const overlay = repoMultiScriptsDirectory();
    source.bundleVersion = pinnedEngineVersion(bundleVersion, 4, multiScriptsFolderHash(overlay));
    const direct = await createEngineGame({ mode: "normal", format: "ffa4", decks: source.decks, seed: source.seed,
      dataDirectory: DATA, settings: source.session.settings, firstTurnDraw: false, scriptErrorMode: "tolerant" });
    const metrics: Record<string, number> = {};
    let host: DuelHost | undefined;
    const secret = "long-journal-test";
    const startHost = () => host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000 });
    async function post<T>(input: Record<string, unknown>): Promise<T> {
      const raw = JSON.stringify({ ...owner, ...input });
      const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
        headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
      const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200); return result as T;
    }
    try {
      let at = performance.now();
      for (let step = 0; step < 1500; step++) {
        const view = [0, 1, 2, 3].map(seat => direct.view(seat)).find(view => view.prompt)!;
        expect(view, `command ${step}`).toBeDefined();
        const prompt = view.prompt!, answer = chooseSurrenderedAnswer(prompt);
        const command = { promptId: prompt.id, revision: view.revision, answer };
        direct.answer(prompt.seat, prompt.id, answer);
        source.commands.push({ storedSeq: step + 1, seat: prompt.seat, command });
      }
      metrics.generateMs = performance.now() - at;
      const duels = createDuelService(db);
      const session = duels.create({ guildId: owner.guildId, organizerPlayerId: 1, name: "Long fixture", mode: "normal", format: "ffa4", settings: source.session.settings });
      db.prepare("delete from duel_seats where duel_id = ?").run(session.id);
      for (let seat = 0; seat < 4; seat++) db.prepare("insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
        .run(session.id, seat, seat + 1, JSON.stringify(source.decks[seat]));
      db.prepare("update duels set status = 'active', seed_json = ?, bundle_version = ?, setup_json = ? where id = ?")
        .run(JSON.stringify(source.seed), source.bundleVersion, JSON.stringify(source.setup), session.id);
      for (const input of source.commands) duels.recordCommand(session.slug, owner.guildId, input.seat, input.command, null);
      duels.interrupt(session.slug, owner.guildId, "Long fixture end");
      const state = duels.privateState(session.slug, owner.guildId);
      source.session = state.session; source.commands = state.commands;
      const sourceVersion = replaySourceVersion(source);
      at = performance.now();
      const frames = await buildReplayFrames({ source, sourceVersion, resources: { dataDirectory: DATA, bundleVersion, multiScriptsDirectory: overlay },
        codec: createReplayCursorCodec(secret), dataSeat: null, finalView: null, createWorker: () => new GameWorker() });
      metrics.replayMs = performance.now() - at; metrics.replayBytes = Buffer.byteLength(JSON.stringify(frames));
      metrics.commands = source.commands.length; metrics.frames = frames.length;
      expect(frames.length).toBeGreaterThan(1500);
      startHost(); at = performance.now();
      const launch = await post<ReplayForkResult>({ op: "replay-fork", slug: session.slug,
        cursor: frames.at(-2)!.cursor, sourceVersion, requestId: "long-fixture" });
      metrics.launchMs = performance.now() - at;
      await host!.close(); startHost(); at = performance.now();
      const recovered = await post<DuelRoom>({ op: "view", slug: launch.slug, as: launch.initialSeat });
      metrics.recoveryMs = performance.now() - at;
      expect(recovered.engine).toEqual(launch.room.engine);
      at = performance.now();
      const restarted = await post<DuelRoom>({ op: "fork-restart", slug: launch.slug });
      metrics.restartMs = performance.now() - at;
      expect(restarted.engine).toEqual(launch.room.engine);
      process.stdout.write(`LONG_JOURNAL_METRICS ${JSON.stringify(metrics)}\n`);
    } finally { await host?.close(); direct.close(); db.close(); vi.unstubAllEnvs(); }
  }, 240_000);
});
