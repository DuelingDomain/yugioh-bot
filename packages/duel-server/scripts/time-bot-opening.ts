import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { DuelRoom } from "@yugidraft/shared/duels";
import type { DuelHost } from "../src/host.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";

// Run with DUEL_DATA_DIR pointing at a read-only engine bundle. No service or disk DB is used.
// --checkout compares another checkout without changing it. --engine accepts pinned or legacy.
const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1]!;
};
const checkout = resolve(argument("--checkout", fileURLToPath(new URL("../../../", import.meta.url))));
const engine = argument("--engine", "pinned");
const mode = argument("--mode", "normal");
const runs = Number(argument("--runs", "3"));
if (!["pinned", "legacy"].includes(engine) || !["normal", "domain"].includes(mode) || !Number.isInteger(runs) || runs < 1) {
  throw new Error("Expected --engine pinned|legacy, --mode normal|domain and a positive --runs");
}
const dataDirectory = process.env.DUEL_DATA_DIR;
if (!dataDirectory) throw new Error("Set DUEL_DATA_DIR to a read-only engine bundle");
process.env.DUEL_1V1_ENGINE = engine;
process.env.DUEL_STANDARD_1V1_ENGINE = engine;
const fromCheckout = (file: string) => import(pathToFileURL(resolve(checkout, file)).href);
const [{ migrate }, { createDuelService }, { createDuelHost }, { GameWorker }, { buildPracticeBotDeck }, { seedIdentity }] = await Promise.all([
  fromCheckout("packages/shared/src/db/index.ts"), fromCheckout("packages/shared/src/services/index.ts"),
  fromCheckout("packages/duel-server/src/host.ts"), fromCheckout("packages/duel-server/src/worker-client.ts"),
  fromCheckout("packages/duel-server/src/practice-bot.ts"), fromCheckout("packages/duel-server/tests/helpers/identity.ts"),
]);
const secret = "isolated-opening-benchmark";
const guildId = "opening-benchmark";
const samples: Record<string, number>[] = [];
for (let run = 1; run <= runs; run++) {
  const db = new Database(":memory:");
  migrate(db);
  const { playerId } = seedIdentity(db, { guildId, name: "Opening benchmark" });
  const service = createDuelService(db);
  const table = service.create({ guildId, organizerPlayerId: playerId, name: "Opening benchmark", mode,
    settings: { turnSeconds: 0 } });
  service.setDeck(table.slug, guildId, playerId, buildPracticeBotDeck(mode, dataDirectory));
  service.markReady(table.slug, guildId, playerId);
  const times: Record<string, number> = {};
  let firstView: Promise<DuelRoom> | undefined;
  let accept!: (room: DuelRoom) => void;
  let reject!: (error: unknown) => void;
  const available = new Promise<DuelRoom>((yes, no) => { accept = yes; reject = no; });
  let host: DuelHost;
  const post = async (op: string, extra = {}): Promise<DuelRoom> => {
    const raw = JSON.stringify({ op, guildId, slug: table.slug, playerId, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", body: raw, headers: { "content-type": "application/json",
        "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") },
    }));
    const room = await response.json() as DuelRoom;
    if (!response.ok) throw new Error(`Opening benchmark request failed (${response.status}): ${JSON.stringify(room)}`);
    return room;
  };
  host = createDuelHost({ db, dataDirectory, secret, searchCards: () => [], openingRps: true,
    random: () => 0.5, botStepDelayMs: 900, pollIntervalMs: 3_600_000, stallMs: 0,
    createWorker: () => {
      times.workerSpawn = performance.now();
      const worker: DuelGameWorker = new GameWorker();
      const create = worker.create.bind(worker);
      worker.create = async (options: GameOptions) => {
        times.createStart = performance.now();
        await create(options);
        times.createEnd = performance.now();
      };
      return worker;
    },
    onChange: () => {
      const opening = service.openingState(table.slug, guildId);
      if (opening?.phase === "choose") times.botWon ??= performance.now();
      if (opening?.phase === "start") times.choiceNotice ??= performance.now();
      if (service.get(table.slug, guildId).status === "active" && !firstView) {
        times.activeNotice = performance.now();
        // A client reads on the activation invalidation. Do not await the read inside the duel queue.
        firstView = post("view");
        void firstView.then(room => { times.firstView = performance.now(); accept(room); }, reject);
      }
    },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await post("add-bot");
    await post("start");
    const lost = await post("opening-pick", { move: "rock" });
    if (lost.opening?.phase !== "choose" || !("winnerSeat" in lost.opening) || lost.opening.winnerSeat !== 1) {
      throw new Error("Expected the bot to win with paper");
    }
    const room = await Promise.race([available, new Promise<never>((_, fail) => {
      timeout = setTimeout(() => fail(new Error("No active-view invalidation within 45 seconds")), 45_000);
    })]);
    if (room.session.status !== "active" || !room.engine) throw new Error("The first view is not active");
    const ms = (end: string, start: string) => Math.round((times[end]! - times[start]!) * 10) / 10;
    const sample = {
      botChoiceMs: ms("choiceNotice", "botWon"),
      admissionAndResourcesMs: ms("workerSpawn", "choiceNotice"),
      workerConstructionMs: ms("createStart", "workerSpawn"),
      workerCreateMs: ms("createEnd", "createStart"),
      clockAndActivationMs: ms("activeNotice", "createEnd"),
      firstViewMs: ms("firstView", "activeNotice"),
      totalMs: ms("firstView", "botWon"),
    };
    samples.push(sample);
    console.log(JSON.stringify({ run, engine, mode, ...sample }));
  } finally {
    clearTimeout(timeout);
    await host.close();
    db.close();
  }
}
console.log(JSON.stringify({ engine, mode, median: Object.fromEntries(Object.keys(samples[0]!).map(key => {
  const values = samples.map(sample => sample[key]!).sort((a, b) => a - b);
  return [key, values[Math.floor(values.length / 2)]];
})) }));
