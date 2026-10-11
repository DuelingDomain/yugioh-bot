import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelEngineView, DuelReplayV2, DuelRoom, ReplayForkResult, ReplayJournalEntry } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createReplayCursorCodec, replaySourceVersion } from "../src/replay-cursor.js";
import { multiScriptsFolderHash, pinnedEngineVersion, repoMultiScriptsDirectory } from "../src/multi-scripts.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { seedIdentity } from "./helpers/identity.js";
import { replaySource } from "./support/replay-fixtures.js";

describeWithCores("long stored journals", [needs.cards(DATA), needs.scripts(DATA), needs.installedMulti(DATA)], () => {
  it("handles 1,500-command FFA4 replays, size rejection/cache, fork recovery and restart through the host", async () => {
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
    let host: DuelHost | undefined, workerCount = 0;
    const secret = "long-journal-test", codec = createReplayCursorCodec(secret);
    const startHost = () => host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [], pollIntervalMs: 60_000,
      createWorker: () => { workerCount++; return new GameWorker(); } });
    async function request<T>(input: Record<string, unknown>) {
      const raw = JSON.stringify({ ...owner, ...input });
      const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
        headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
      const text = await response.text();
      return { response, data: JSON.parse(text) as T, bytes: Buffer.byteLength(text) };
    }
    async function post<T>(input: Record<string, unknown>): Promise<T> {
      const result = await request<T>(input); expect(result.response.status).toBe(200); return result.data;
    }
    async function measuredReplay<T>(label: string, slug: string, status: number) {
      const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
      const startRss = process.memoryUsage().rss; let peakRss = startRss;
      const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
      try {
        await new Promise(resolve => setTimeout(resolve, 20));
        const at = performance.now();
        const result = await request<T>({ op: "replay", version: 2, visibility: "public", slug, ...(status === 413 ? { playerId: 1, userId: 201 } : {}) });
        metrics[`${label}Ms`] = performance.now() - at; metrics[`${label}Bytes`] = result.bytes;
        await new Promise(resolve => setTimeout(resolve, 20));
        metrics[`${label}P99Ms`] = delay.percentile(99) / 1e6;
        metrics[`${label}MaxMs`] = delay.max / 1e6;
        metrics[`${label}PeakRssBytes`] = peakRss; metrics[`${label}RssDeltaBytes`] = peakRss - startRss;
        expect(result.response.status).toBe(status);
        expect(metrics[`${label}Ms`]).toBeLessThan(28_000);
        return result.data;
      } finally { clearInterval(sample); delay.disable(); }
    }
    try {
      let at = performance.now();
      let shortBoards!: { public: DuelEngineView; seats: DuelEngineView[] };
      for (let step = 0; step < 1500; step++) {
        const view = [0, 1, 2, 3].map(seat => direct.view(seat)).find(view => view.prompt)!;
        expect(view, `command ${step}`).toBeDefined();
        const prompt = view.prompt!, answer = chooseSurrenderedAnswer(prompt);
        const command = { promptId: prompt.id, revision: view.revision, answer };
        direct.answer(prompt.seat, prompt.id, answer);
        source.commands.push({ storedSeq: step + 1, seat: prompt.seat, command });
        if (step === 39) shortBoards = { public: direct.view(null), seats: [0, 1, 2, 3].map(seat => direct.view(seat)) };
      }
      metrics.generateMs = performance.now() - at;
      const duels = createDuelService(db);
      const storeSource = (name: string, commands: ReplayJournalEntry[], boards: typeof shortBoards) => {
        const session = duels.create({ guildId: owner.guildId, organizerPlayerId: 1, name, mode: "normal", format: "ffa4", settings: source.session.settings });
        db.prepare("delete from duel_seats where duel_id = ?").run(session.id);
        for (let seat = 0; seat < 4; seat++) db.prepare("insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
          .run(session.id, seat, seat + 1, JSON.stringify(source.decks[seat]));
        db.prepare("update duels set status = 'active', seed_json = ?, bundle_version = ?, setup_json = ? where id = ?")
          .run(JSON.stringify(source.seed), source.bundleVersion, JSON.stringify(source.setup), session.id);
        db.transaction(() => {
          for (const input of commands) duels.recordCommand(session.slug, owner.guildId, input.seat, input.command, null);
        })();
        duels.interrupt(session.slug, owner.guildId, "Long fixture end", boards);
        return session;
      };
      // Same real engine and 800-card decks: a long journal of private no-ops stays small enough to serve.
      const compactCommands = source.commands.slice(0, 40);
      for (let step = 40; step < 1500; step++) compactCommands.push({ storedSeq: step + 1, seat: 0,
        command: { promptId: "chain-mode:always", revision: shortBoards.public.revision, answer: {} } });
      const compact = storeSource("Long compact fixture", compactCommands, shortBoards);
      const boards = { public: direct.view(null), seats: [0, 1, 2, 3].map(seat => direct.view(seat)) };
      const session = storeSource("Long oversized fixture", source.commands, boards);
      const state = duels.privateState(session.slug, owner.guildId);
      source.session = state.session; source.commands = state.commands;
      const sourceVersion = replaySourceVersion(source);
      const before = db.prepare("select * from duels where id = ?").get(session.id);
      const beforeCommands = db.prepare("select * from duel_commands where duel_id = ? order by seq").all(session.id);
      startHost();
      // The whole episode supplies enough samples for p99. A cached error alone can finish in one tick.
      const replayDelay = monitorEventLoopDelay({ resolution: 1 }); replayDelay.enable();
      try {
        const replay = await measuredReplay<DuelReplayV2>("replay", compact.slug, 200);
        expect(replay.frames.length).toBeGreaterThan(40);
        expect(replay.frames.length).toBeLessThan(1500);
        expect(replay.frames[0]!.cursor).toBeTypeOf("string");
        expect(codec.open(replay.frames[0]!.cursor!).prefixCount).toBe(0);
        const builtWorkers = workerCount;
        const cached = await measuredReplay<DuelReplayV2>("cachedReplay", compact.slug, 200);
        expect(cached.frames.map(frame => frame.frameId)).toEqual(replay.frames.map(frame => frame.frameId));
        expect(workerCount).toBe(builtWorkers);
        const tooLarge = await measuredReplay<{ code: string; finalBoard: string; error: string }>("oversizedReplay", session.slug, 413);
        expect(tooLarge).toMatchObject({ code: "REPLAY_TOO_LARGE", finalBoard: "available" });
        expect(tooLarge.error).toContain("16 MiB limit");
        const rejectedWorkers = workerCount;
        await measuredReplay("cachedSizeError", session.slug, 413); expect(workerCount).toBe(rejectedWorkers);
        metrics.hostReplayP99Ms = replayDelay.percentile(99) / 1e6;
        metrics.hostReplayMaxMs = replayDelay.max / 1e6;
        process.stdout.write(`HOST_REPLAY_METRICS ${JSON.stringify(metrics)}\n`);
        expect(metrics.hostReplayP99Ms).toBeLessThan(20);
        metrics.compactFrames = replay.frames.length;
      } finally { replayDelay.disable(); }
      const saved = await post<DuelRoom>({ op: "view", slug: session.slug });
      expect(saved.engine?.seats).toEqual(boards.public.seats);
      expect(db.prepare("select * from duels where id = ?").get(session.id)).toEqual(before);
      expect(db.prepare("select * from duel_commands where duel_id = ? order by seq").all(session.id)).toEqual(beforeCommands);
      // Use the owner's actual HTTP checkpoint response; no hand-sealed cursor can bypass the UI contract.
      const ownerReplay = await post<DuelReplayV2>({ op: "owner-replay", slug: session.slug, visibility: "public" });
      expect(ownerReplay.capabilities?.canFork).toBe(true);
      expect(ownerReplay.frames).toHaveLength(1);
      expect(ownerReplay.forkSteps).toHaveLength(source.commands.length + 2);
      const checkpoint = ownerReplay.forkSteps!.filter(step => step.cursor !== null).at(-1)!;
      const cursor = checkpoint.cursor!;
      expect(codec.open(cursor).prefixCount).toBe(source.commands.length);
      expect(ownerReplay.sourceVersion).toBe(sourceVersion);
      metrics.ownerSteps = ownerReplay.forkSteps!.length;
      at = performance.now();
      const launch = await post<ReplayForkResult>({ op: "replay-fork", slug: session.slug, cursor, sourceVersion, requestId: "long-fixture" });
      metrics.launchMs = performance.now() - at; expect(metrics.launchMs).toBeLessThan(28_000);
      await host!.close(); startHost(); at = performance.now();
      const recovered = await post<DuelRoom>({ op: "view", slug: launch.slug, as: launch.initialSeat });
      metrics.recoveryMs = performance.now() - at;
      expect(recovered.engine).toEqual(launch.room.engine);
      at = performance.now();
      const restarted = await post<DuelRoom>({ op: "fork-restart", slug: launch.slug });
      metrics.restartMs = performance.now() - at; expect(metrics.restartMs).toBeLessThan(28_000);
      expect(restarted.engine).toEqual(launch.room.engine);
      metrics.commands = source.commands.length;
      process.stdout.write(`LONG_JOURNAL_METRICS ${JSON.stringify(metrics)}\n`);
    } finally { await host?.close(); direct.close(); db.close(); vi.unstubAllEnvs(); }
  }, 240_000);
});
