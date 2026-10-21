import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { createServer } from "node:net";
// Build shared and duel-server first. Every application write goes to a fresh scratch copy.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    database: { type: "string" },
    data: { type: "string" },
    output: { type: "string" },
    port: { type: "string", default: "4023" },
    "inspect-port": { type: "string", default: "9223" },
    short: { type: "boolean", default: false },
    single: { type: "boolean", default: false },
    snapshot: { type: "boolean", default: false },
  },
});
if (!values.database || !values.data || !values.output)
  throw new Error(
    "Required: --database SOURCE.sqlite --data ENGINE_DIRECTORY --output NEW_SCRATCH_DIRECTORY",
  );
const directory = resolve(values.output),
  engine = resolve(values.data),
  label = directory.split("/").at(-1);
const port = Number(values.port),
  inspectPort = Number(values["inspect-port"]);
if (directory === engine || directory.startsWith(`${engine}/`))
  throw new Error("Output must be outside the read-only engine directory");
if (
  [port, inspectPort].some(
    (p) =>
      !Number.isInteger(p) || p < 1024 || p > 65535 || p === 4003 || p === 3000,
  ) ||
  port === inspectPort
)
  throw new Error(
    "Choose distinct free ports above 1023, excluding 3000 and 4003",
  );
for (const candidate of [port, inspectPort])
  await new Promise((done, fail) => {
    const listener = createServer();
    listener.once("error", fail);
    listener.listen(candidate, "127.0.0.1", () => listener.close(done));
  });
fs.mkdirSync(directory, { recursive: true });
if (fs.existsSync(`${directory}/bot.sqlite`))
  throw new Error(
    "Output already contains a database; choose a fresh scratch directory",
  );
const source = new Database(resolve(values.database), {
  readonly: true,
  fileMustExist: true,
});
try {
  await source.backup(`${directory}/bot.sqlite`);
} finally {
  source.close();
}
const probe = fileURLToPath(new URL("./memory-probe.mjs", import.meta.url));
const { openDatabase } = await import(
  `${root}/packages/shared/dist/db/index.js`
);
const { signedRequestHeaders } = await import(
  `${root}/packages/shared/dist/internal-auth/index.js`
);
const { emptyCardQuery } = await import(
  `${root}/packages/shared/dist/duels/index.js`
);
const { buildPracticeBotDeck } = await import(
  `${root}/packages/duel-server/dist/practice-bot.js`
);
const db = openDatabase(`${directory}/bot.sqlite`);
// Only the disposable copy is migrated and seeded. Use the existing integration fixture's actor shape.
const userBase = db
  .prepare("SELECT coalesce(max(id),0)+1 AS id FROM users")
  .get().id;
const playerBase = db
  .prepare("SELECT coalesce(max(id),0)+1 AS id FROM players")
  .get().id;
const actors = Array.from({ length: 3 }, (_, n) => ({
  guildId: "memory-integration",
  userId: userBase + n,
  playerId: playerBase + n,
}));
for (const a of actors) {
  db.prepare("insert into users(id,username,display_name) values(?,?,?)").run(
    a.userId,
    `memory-${a.userId}`,
    "Memory integration",
  );
  db.prepare(
    "insert into players(id,guild_id,user_id,display_name) values(?,?,?,?)",
  ).run(a.playerId, a.guildId, a.userId, "Memory integration");
}
db.close();
const deck = buildPracticeBotDeck("normal", engine);
const secret = "isolated-duel-memory-key";
const log = fs.openSync(`${directory}/server.log`, "w");
const child = spawn(
  "prlimit",
  [
    "--core=0",
    "--",
    process.execPath,
    "--expose-gc",
    `--inspect=127.0.0.1:${inspectPort}`,
    "--import",
    probe,
    "--import",
    `${root}/packages/duel-server/dist/instrument.js`,
    `${root}/packages/duel-server/dist/server.js`,
  ],
  {
    cwd: root,
    stdio: ["ignore", log, log],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      DOTENV_CONFIG_PATH: "/dev/null",
      SENTRY_DSN: "",
      DATABASE_PATH: `${directory}/bot.sqlite`,
      DUEL_DATA_DIR: engine,
      DUEL_INTERNAL_PORT: String(port),
      DUEL_INTERNAL_HOST: "127.0.0.1",
      DUEL_INTERNAL_SECRET: secret,
      DUEL_MAX_WORKERS: "12",
      DUEL_WORKER_HEAP_MB: "256",
      DUEL_IDLE_WORKER_MS: "2000",
      DUEL_BOT_STEP_MS: "20",
      DUEL_RPS_OPENING: "0",
      DUEL_1V1_ENGINE: "legacy",
      DUEL_STANDARD_1V1_ENGINE: "pinned",
      EFFECT_SEARCH: "1",
      DECK_SUGGESTIONS: "1",
      MEMORY_RUN: directory,
      ...(process.env.MALLOC_ARENA_MAX
        ? { MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX }
        : {}),
    },
  },
);
fs.writeFileSync(`${directory}/pid`, `${child.pid}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let sock;
let seq = 0;
const pending = new Map();
let stopped = false;
const stop = async () => {
  if (stopped) return;
  stopped = true;
  sock?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((done) => {
      const t = setTimeout(() => child.kill("SIGKILL"), 7000);
      child.once("exit", () => {
        clearTimeout(t);
        done();
      });
    });
  }
  fs.closeSync(log);
};
process.on("SIGTERM", () => void stop().then(() => process.exit(143)));
process.on("SIGINT", () => void stop().then(() => process.exit(130)));
const inspector = async () => {
  const info = await (
    await fetch(`http://127.0.0.1:${inspectPort}/json/list`)
  ).json();
  sock = new WebSocket(info[0].webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    sock.addEventListener("open", done, { once: true });
    sock.addEventListener("error", fail, { once: true });
  });
  sock.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error
        ? p.reject(new Error(JSON.stringify(m.error)))
        : p.resolve(m.result);
    }
  });
};
const command = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    sock.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (
    await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
  ).result.value;
const timings = [];
async function post(input, actor = actors[0]) {
  const body = JSON.stringify({ ...actor, ...input }),
    url = `http://127.0.0.1:${port}/internal/duel`;
  const start = performance.now();
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: signedRequestHeaders({
      url,
      method: "POST",
      body,
      secret,
      purpose: "duel-host",
    }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  timings.push({ op: input.op, ms: performance.now() - start });
  assert.equal(response.status, 200, `${input.op}: ${JSON.stringify(result)}`);
  return result;
}
const rows = [];
async function measure(stage, wait = 1500) {
  await pause(wait);
  const status = fs.readFileSync(`/proc/${child.pid}/status`, "utf8");
  const smaps = fs.readFileSync(`/proc/${child.pid}/smaps_rollup`, "utf8");
  const fields = Object.fromEntries(
    [...status.matchAll(/^(VmRSS|RssAnon|RssFile|Threads):\s+(\d+)/gm)].map(
      (m) => [m[1], Number(m[2]) * (m[1] === "Threads" ? 1 : 1024)],
    ),
  );
  const main = await evaluate("memoryProbe()");
  const threads = fs
    .readdirSync(directory)
    .filter((f) => /^thread-\d+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(`${directory}/${f}`)))
    .filter((v) => Date.now() - v.at < 1800);
  const row = {
    stage,
    pid: child.pid,
    ...fields,
    main,
    threads,
    smaps,
    timings: [...timings],
  };
  rows.push(row);
  fs.writeFileSync(`${directory}/results.json`, JSON.stringify(rows, null, 2));
  console.log(
    JSON.stringify({
      label,
      stage,
      rssMB: fields.VmRSS / 1e6,
      anonMB: fields.RssAnon / 1e6,
      threads: fields.Threads,
      isolates: threads.map((t) => ({
        id: t.threadId,
        heapMB: t.usage.heapUsed / 1e6,
        externalMB: t.usage.external / 1e6,
        bufferMB: t.usage.arrayBuffers / 1e6,
      })),
    }),
  );
}
try {
  for (let n = 0; n < 1200; n++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `server exited ${child.exitCode}: ${fs.readFileSync(`${directory}/server.log`, "utf8")}`,
      );
    if (
      fs
        .readFileSync(`${directory}/server.log`, "utf8")
        .includes("Private server listening")
    )
      break;
    await pause(100);
  }
  await inspector();
  assert.equal(
    await evaluate("process.pid"),
    child.pid,
    "Inspector must belong to the isolated server",
  );
  await measure("boot", 2500);
  await post({ op: "cards", query: "Blue-Eyes" });
  await post({
    op: "card-query",
    cardQuery: {
      ...emptyCardQuery(),
      text: "Blue-Eyes",
      scope: "name",
      sort: "newest",
    },
  });
  await measure("card-search");
  await post({
    op: "card-query",
    cardQuery: { ...emptyCardQuery(), text: "hand traps that negate" },
  });
  await post({
    op: "card-query",
    cardQuery: { ...emptyCardQuery(), text: "staples" },
  });
  await measure("effect-search");
  const suggest = () => ({
    op: "deck-suggestions",
    suggestionQuery: { op: "suggestRows", deck, format: "normal" },
  });
  if (!values.single) {
    await post(suggest());
    await measure("one-suggestion");
    await Promise.all([post(suggest(), actors[0]), post(suggest(), actors[1])]);
    await measure("two-suggestions");
  }
  await evaluate("global.gc();memoryProbe()");
  await measure("host-gc");
  if (values.short) {
    await measure("scanner-idle", 35000);
  } else {
    const first = await post({
      op: "start-test-duel",
      mode: "normal",
      deck,
      shuffle: false,
      goFirst: true,
    });
    assert.equal(first.room.session.status, "active");
    await measure("one-practice-duel");
    let room = first.room;
    const summon = room.engine.prompt.options.find((option) =>
      option.id.startsWith("summon:"),
    );
    assert.ok(summon);
    room = await post({
      op: "respond",
      slug: first.slug,
      command: {
        promptId: room.engine.prompt.id,
        revision: room.engine.revision,
        answer: { choice: summon.id },
      },
    });
    if (room.engine.prompt.kind === "places")
      room = await post({
        op: "respond",
        slug: first.slug,
        command: {
          promptId: room.engine.prompt.id,
          revision: room.engine.revision,
          answer: { selected: [room.engine.prompt.options[0].id] },
        },
      });
    assert.ok(
      room.engine.seats[0].monsters.some(
        (card) => card?.code === summon.card.code,
      ),
    );
    // Repeated valid chain-mode actions exercise engine calls and durable command writes.
    for (let n = 0; n < 12; n++)
      room = await post({
        op: "chain-mode",
        slug: first.slug,
        mode: n % 2 ? "auto" : "always",
      });
    fs.writeFileSync(`${directory}/room.json`, JSON.stringify(room, null, 2));
    await measure("duel-actions");
    if (values.single) {
      // Keep the one live duel active while the unchanged two-minute spare expires.
      // This also distinguishes steady live memory from the editor/scanner burst.
      for (let step = 0; step < 3; step++) {
        const until = Date.now() + 45_000;
        while (Date.now() < until) {
          await post({ op: "view", slug: first.slug });
          await pause(800);
        }
        await measure(`single-live-${(step + 1) * 45}s`, 0);
      }
    } else {
      const others = await Promise.all(
        actors.slice(1).map((actor) =>
          post(
            {
              op: "start-test-duel",
              mode: "normal",
              deck,
              shuffle: false,
              goFirst: true,
            },
            actor,
          ),
        ),
      );
      await measure("three-practice-duels");
      const all = [first, ...others];
      for (let n = 0; n < 3; n++)
        await post({ op: "surrender", slug: all[n].slug }, actors[n]);
      await measure("duels-ended");
      await measure("idle-worker-close", 35000);
      const replay = await post({ op: "replay", slug: first.slug });
      assert.ok(
        replay.frames?.length > 0,
        JSON.stringify(replay).slice(0, 300),
      );
      await measure("replay-rebuild");
      await measure("idle-after-replay", 40000);
      await measure("all-idle", 50000);
    }
  }
  fs.writeFileSync(
    `${directory}/timings.json`,
    JSON.stringify(timings, null, 2),
  );
  if (values.snapshot)
    await evaluate(
      `memorySnapshot(${JSON.stringify(`${directory}/main.heapsnapshot`)})`,
    );
  console.log(`${label} COMPLETE`);
} finally {
  await stop();
}
