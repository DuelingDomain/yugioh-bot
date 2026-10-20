import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import type { DuelDeck } from "../packages/shared/src/duels/index.js";
import type { DeckSuggestionLegality } from "../packages/shared/src/services/deck-suggestions.js";

// Default: isolated HTTP backend. --next: real production Next process and authenticated route.
// Authoritative admission and suggestion scans run in the signed duel host.
// Actual Next retains only its bounded completed-result cache; RSS gates measure Next alone.
const scriptPath = resolve(process.argv[1]!);
const root = resolve(dirname(scriptPath), "..");
const { values } = parseArgs({ options: {
  catalog: { type: "string", default: "/tmp/deck-suggestions-quality-catalog.sqlite" },
  engine: { type: "string", default: "/home/sulman633/repos/yugioh-bot/data/duel-engine" },
  fixture: { type: "string", default: join(root, "packages/shared/tests/fixtures/deck-suggestions-quality.json") },
  output: { type: "string", default: join(tmpdir(), "deck-suggestions-benchmark") },
  samples: { type: "string", default: "60" },
  warmup: { type: "string", default: "6" },
  baseline: { type: "string", default: "12" },
  decks: { type: "string", default: "blue-eyes,domain" },
  profile: { type: "boolean", default: false },
  check: { type: "boolean", default: false },
  next: { type: "boolean", default: false },
  "next-dist": { type: "string", default: ".next-deck-suggestions-perf" },
  worker: { type: "string" },
  scope: { type: "string" },
  help: { type: "boolean", default: false },
} });
const engineDirectory = resolve(values.engine!);
const sourceDatabasePath = resolve(values.catalog!);
let databasePath = sourceDatabasePath;
const outputDirectory = resolve(values.output!);
const progress = (message: string) => process.stderr.write(`[deck-suggestions-benchmark] ${message}\n`);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const quantile = (samples: number[], q: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * q) - 1]!;
const SESSION_SECRET = "benchmark-only-synthetic-session-key-0123456789";
const HOST_SECRET = "benchmark-only-internal-key";
const GUILD = "deck-suggestions-benchmark";
const USER = 99999901;
const webAllocatorEnvironment = Object.fromEntries(["MALLOC_TRIM_THRESHOLD_", "MALLOC_ARENA_MAX"]
  .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]!]));
type Memory = ReturnType<typeof process.memoryUsage>;
type HostStats = {
  operations: Record<string, number>;
  rows: { computed: number; notModified: number; failed: number };
  outside: { computed: number; notModified: number; failed: number };
};
type Fixture = { id: string; format: "normal" | "domain"; fullDeck: DuelDeck; trimmedDeck: DuelDeck };
type Scenario = { id: string; format: "normal" | "domain"; deck: DuelDeck; banlist: string; derivation: string; initialScopeMs: number };
const childEvents: object[] = [];
const stoppingPids = new Set<number>();
function observeChild(child: ChildProcess, role: string) {
  const record = (event: string, details: object = {}) => {
    const entry = { at: new Date().toISOString(), role, pid: child.pid, event, expectedStop: stoppingPids.has(child.pid!), ...details };
    childEvents.push(entry); progress(`Child ${JSON.stringify(entry)}`);
    appendFileSync(join(outputDirectory, `child-${role}-${child.pid}.log`), `${JSON.stringify(entry)}\n`);
  };
  record("spawn");
  child.on("error", error => record("error", { error: String(error) }));
  child.on("exit", (code, signal) => record("exit", { code, signal }));
  child.on("close", (code, signal) => record("close", { code, signal }));
  child.on("disconnect", () => record("disconnect"));
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]] as const) {
    stream?.on("data", bytes => appendFileSync(join(outputDirectory, `child-${role}-${child.pid}.log`), `[${name}] ${bytes}`));
  }
}
function describeError(error: unknown): object {
  if (!(error instanceof Error)) return { message: String(error) };
  const details = error as Error & Record<string, unknown>;
  return { name: error.name, message: error.message, stack: error.stack,
    ...Object.fromEntries(["code", "errno", "syscall", "address", "port", "socket"].filter(key => details[key] !== undefined).map(key => [key, details[key]])),
    ...(error.cause === undefined ? {} : { cause: describeError(error.cause) }) };
}

async function json(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
async function call<T = any>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result as T;
}
async function retainedMemory() {
  if (!global.gc) throw new Error("Worker must run with --expose-gc");
  const readings: Memory[] = [];
  for (let at = 0; at < 3; at++) {
    global.gc(); await pause(40); readings.push(process.memoryUsage());
  }
  return { ...readings.at(-1)!, rssSamples: readings.map(memory => memory.rss) };
}

async function worker() {
  process.once("disconnect", () => process.exit(0));
  const started = performance.now();
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(databasePath, { readonly: values.worker !== "duel", fileMustExist: true });
  let closeHost: (() => Promise<void>) | undefined;
  let operate: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  if (values.worker === "scope" || values.worker === "duel") {
    const { deckSuggestionScope, inspectDeck } = await import("../packages/duel-server/src/deck-legality.js");
    const { defaultDuelSettings } = await import("../packages/shared/src/duels/settings.js");
    const host = values.worker === "duel" ? (await import("../packages/duel-server/src/host.js")).createDuelHost({ db,
      dataDirectory: engineDirectory, secret: HOST_SECRET, pollIntervalMs: 60_000, searchCards: () => [] }) : undefined;
    if (host) closeHost = () => host.close();
    const stats: HostStats = { operations: {}, rows: { computed: 0, notModified: 0, failed: 0 }, outside: { computed: 0, notModified: 0, failed: 0 } };
    operate = async (request, response) => {
      if (request.url === "/benchmark-host-stats") { send(response, stats); return; }
      if (request.url === "/memory") { send(response, await retainedMemory()); return; }
      if (host && request.url === "/internal/duel") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const input = JSON.parse(body.toString("utf8")) as { op?: string; suggestionQuery?: { op?: string } };
        const result = await host.handle(new Request(`http://${request.headers.host}${request.url}`, { method: "POST",
          headers: request.headers as Record<string, string>, body }));
        const bytes = Buffer.from(await result.arrayBuffer());
        const operation = input.op ?? "unknown";
        stats.operations[operation] = (stats.operations[operation] ?? 0) + 1;
        if (operation === "deck-suggestions") {
          const counts = input.suggestionQuery?.op === "suggestRows" ? stats.rows : stats.outside;
          const reply = JSON.parse(bytes.toString("utf8")) as { notModified?: boolean; result?: unknown };
          if (!result.ok) counts.failed++;
          else if (reply.notModified === true) counts.notModified++;
          else if (reply.result !== undefined) counts.computed++;
          else counts.failed++;
        }
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(bytes); return;
      }
      const input = await json(request);
      if (request.url === "/health") { send(response, { multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false }); return; }
      const mode = input.format === "domain" ? "domain" : "normal";
      if (request.url === "/validate") { send(response, inspectDeck(mode, input.deck, engineDirectory, defaultDuelSettings(mode))); return; }
      send(response, deckSuggestionScope(mode, engineDirectory, defaultDuelSettings(mode), { deckMaster: input.deckMaster }));
    };
  } else {
    const { createCardInsightService } = await import("../packages/shared/src/services/card-insights.js");
    let profile: import("node:inspector").Session | undefined;
    const post = (method: string) => new Promise<any>((done, reject) => profile!.post(method, (error, result) => error ? reject(error) : done(result)));
    operate = async (request, response) => {
      const input = await json(request);
      const service = createCardInsightService(db, { dataDirectory: engineDirectory });
      if (request.url === "/memory") { send(response, await retainedMemory()); return; }
      if (request.url === "/legacy-host-ping") { send(response, await call(`${values.scope}/health`, {})); return; }
      if (request.url === "/effect-search") {
        const start = performance.now();
        const result = service.effectSearch(input.text, undefined, { format: "normal", limit: 12 });
        send(response, { milliseconds: performance.now() - start, total: result.total }); return;
      }
      if (request.url === "/profile/start") {
        const { Session } = await import("node:inspector");
        profile = new Session(); profile.connect(); await post("Profiler.enable"); await post("Profiler.start");
        send(response, { ok: true }); return;
      }
      if (request.url === "/profile/stop") {
        const result = await post("Profiler.stop");
        writeFileSync(join(outputDirectory, "web.cpuprofile"), JSON.stringify(result.profile));
        profile!.disconnect(); profile = undefined; send(response, { ok: true }); return;
      }
      if (request.url !== "/suggest") throw new Error("Unknown benchmark endpoint");
      const started = performance.now();
      const legality = await call<DeckSuggestionLegality>(values.scope!, { format: input.scenario.format, deckMaster: input.scenario.deck.deckMaster });
      const admitted = performance.now();
      const result = service.suggestRows(input.scenario.deck, { format: input.scenario.format, banlist: input.scenario.banlist,
        deckMaster: input.scenario.deck.deckMaster, legality, ...(input.useCache ? {} : { cache: false }) });
      const finished = performance.now();
      send(response, { milliseconds: finished - started, scopeMs: admitted - started, serviceMs: finished - admitted,
        returnedCards: result.rows.reduce((count, row) => count + row.cards.length, 0), version: result.version,
        rowCounts: Object.fromEntries(result.rows.map(row => [row.id, row.cards.length])) });
    };
  }
  const server = createServer((request, response) => void operate(request, response).catch(error => send(response, { error: String(error) }, 500)));
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing worker address");
  process.send?.({ ready: true, url: `http://127.0.0.1:${address.port}`, pid: process.pid, initializationMs: performance.now() - started });
  const close = () => server.close(() => void (async () => { await closeHost?.(); db.close(); process.exit(0); })());
  process.once("SIGTERM", close); process.once("disconnect", close);
}

async function startWorker(role: "scope" | "duel" | "web", scope?: string) {
  const child = spawn(process.execPath, ["--expose-gc", "--import", "tsx", scriptPath, "--worker", role,
    "--catalog", databasePath, "--engine", engineDirectory, "--output", outputDirectory, ...(scope ? ["--scope", scope] : [])], {
    cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"], env: { PATH: process.env.PATH, NODE_ENV: "production", EFFECT_SEARCH: "1", DECK_SUGGESTIONS: "1", DUEL_DATA_DIR: engineDirectory,
      ...(role === "web" ? webAllocatorEnvironment : {}) },
  });
  observeChild(child, role);
  child.stdout?.on("data", bytes => process.stderr.write(`[${role}] ${bytes}`));
  child.stderr?.on("data", bytes => process.stderr.write(`[${role}] ${bytes}`));
  const ready = await new Promise<{ url: string; pid: number; initializationMs: number }>((done, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`${role} startup timed out`)); }, 60_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`${role} exited before startup (${code})`)); });
    child.once("message", message => { clearTimeout(timer); done(message as any); });
  });
  return { child, ...ready };
}
async function stopWorker(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  stoppingPids.add(child.pid!);
  progress(`Stopping child PID ${child.pid} with SIGTERM`);
  await new Promise<void>(done => {
    const timer = setTimeout(() => { progress(`Child PID ${child.pid} did not exit; sending SIGKILL`); child.kill("SIGKILL"); }, 5_000);
    child.once("exit", () => { clearTimeout(timer); done(); }); child.kill("SIGTERM");
  });
}

async function inspectorClient(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((done, reject) => { socket.addEventListener("open", () => done(), { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map<number, { done: (value: any) => void; reject: (error: Error) => void }>();
  socket.addEventListener("close", event => {
    const error = new Error(`Next inspector closed (${event.code}, ${event.reason})`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)), request = pending.get(message.id);
    if (!request) return; pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.done(message.result);
  });
  const command = (method: string, params: object = {}) => new Promise<any>((done, reject) => {
    const id = ++sequence; pending.set(id, { done, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { command, close: () => socket.close() };
}

async function startNext(scope: string) {
  const entry = join(root, "packages/web", values["next-dist"]!, "standalone/packages/web/server.js");
  if (!existsSync(entry)) throw new Error(`Build Next first with E2E_NEXT_DIST_DIR=${values["next-dist"]}: ${entry}`);
  for (const directory of [root, join(root, "packages/web"), dirname(entry)]) for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(join(directory, name))) throw new Error(`Refusing Next startup because an environment file exists in ${directory}`);
  }
  const reserve = createServer();
  await new Promise<void>(done => reserve.listen(0, "127.0.0.1", done));
  const address = reserve.address(); if (!address || typeof address === "string") throw new Error("No loopback port");
  const port = address.port; await new Promise<void>(done => reserve.close(() => done()));
  const started = performance.now();
  let inspectorUrl = "", stderr = "";
  // Lifecycle-only observation: no request hooks, retries, or changed close behavior.
  const lifecycleObserver = `import http from "node:http";
    const record = details => process.stderr.write("[benchmark-lifecycle] " + JSON.stringify({at:new Date().toISOString(),pid:process.pid,...details}) + "\\n");
    for (const signal of ["SIGTERM","SIGINT"]) process.prependListener(signal,()=>record({event:"signal",signal}));
    const close = http.Server.prototype.close;
    http.Server.prototype.close = function(...args) { record({event:"http-server-close",address:this.address(),stack:new Error().stack?.split("\\n").slice(2).join("\\n")}); return Reflect.apply(close,this,args); };
    process.once("disconnect",()=>{record({event:"disconnect"});process.exit(0)});`;
  const child = spawn(process.execPath, ["--expose-gc", "--inspect=127.0.0.1:0", "--trace-exit", "--trace-uncaught",
    "--report-uncaught-exception", "--report-on-fatalerror", `--report-directory=${outputDirectory}`, "--import",
    `data:text/javascript,${encodeURIComponent(lifecycleObserver)}`, entry], { cwd: dirname(entry), stdio: ["ignore", "pipe", "pipe", "ipc"], env: {
      PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", E2E_AUTH: "1", E2E_AUTH_SECRET: SESSION_SECRET,
      E2E_NEXT_DIST_DIR: values["next-dist"], NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "", DATABASE_PATH: databasePath,
      DUEL_DATA_DIR: engineDirectory, EFFECT_SEARCH: "1", DECK_SUGGESTIONS: "1", DISCORD_GUILD_ID: GUILD,
      DUEL_INTERNAL_URL: scope, DUEL_INTERNAL_SECRET: HOST_SECRET, PORT: String(port), HOSTNAME: "127.0.0.1",
      WS_INTERNAL_URL: "http://127.0.0.1:0", WS_INTERNAL_SECRET: HOST_SECRET, BOT_ANNOUNCE_URL: "http://127.0.0.1:0", BOT_ANNOUNCE_SECRET: HOST_SECRET,
      ...webAllocatorEnvironment,
    } });
  observeChild(child, "next");
  child.stdout?.on("data", bytes => process.stderr.write(`[next] ${bytes}`));
  child.stderr?.on("data", bytes => { stderr = `${stderr}${bytes}`.slice(-16_384); inspectorUrl = /Debugger listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1] ?? inspectorUrl; process.stderr.write(`[next] ${bytes}`); });
  const url = `http://127.0.0.1:${port}`;
  let cookie = "";
  try {
    while (performance.now() - started < 120_000) {
      if (child.exitCode !== null) throw new Error(`Next exited (${child.exitCode})`);
      try {
        const response = await fetch(`${url}/api/test-auth/session`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: SESSION_SECRET, userId: USER }), signal: AbortSignal.timeout(2_000) });
        if (response.ok) { cookie = response.headers.get("set-cookie")?.split(";")[0] ?? ""; break; }
      } catch { /* Startup has not bound the socket yet. */ }
      await pause(200);
    }
    if (!cookie || !inspectorUrl) throw new Error("Next did not provide an authenticated session and loopback inspector");
    const inspector = await inspectorClient(inspectorUrl);
    const api = async (path: string, body: object) => {
      const start = performance.now();
      const response = await fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(`Next HTTP ${response.status}: ${JSON.stringify(result)}`);
      return { result, httpMs: performance.now() - start };
    };
    const request = async (path: string, body: any = {}) => {
      if (path === "/memory") {
        const readings: Memory[] = [];
        for (let at = 0; at < 3; at++) {
          const value = await inspector.command("Runtime.evaluate", { expression: "global.gc(); JSON.stringify(process.memoryUsage())", returnByValue: true });
          readings.push(JSON.parse(value.result.value)); await pause(40);
        }
        return { ...readings.at(-1)!, rssSamples: readings.map(memory => memory.rss) };
      }
      if (path === "/legacy-host-ping") return (await api("/api/duels/cards", { codes: [89631139], mode: "normal" })).result;
      if (path === "/effect-search") {
        const measured = await api("/api/cards/insights", { op: "effectSearch", text: body.text, format: "normal", limit: 12 });
        return { milliseconds: measured.httpMs, total: measured.result.total };
      }
      if (path === "/profile/start") { await inspector.command("Profiler.enable"); await inspector.command("Profiler.start"); return { ok: true }; }
      if (path === "/profile/stop") { const value = await inspector.command("Profiler.stop"); writeFileSync(join(outputDirectory, "web.cpuprofile"), JSON.stringify(value.profile)); return { ok: true }; }
      const measured = await api("/api/cards/insights", { op: "suggestRows", deck: body.scenario.deck,
        format: body.scenario.format, banlist: body.scenario.banlist });
      return { milliseconds: measured.httpMs, httpMs: measured.httpMs, returnedCards: measured.result.rows.reduce((n: number, row: any) => n + row.cards.length, 0),
        version: measured.result.version, rowCounts: Object.fromEntries(measured.result.rows.map((row: any) => [row.id, row.cards.length])) };
    };
    return { child, url, pid: child.pid!, initializationMs: performance.now() - started, request, closeInspector: inspector.close };
  } catch (error) { await stopWorker(child); throw error; }
}

async function benchmark() {
  const samples = Number(values.samples), warmup = Number(values.warmup), baselineCount = Number(values.baseline);
  if (!Number.isInteger(samples) || samples < 30 || !Number.isInteger(warmup) || warmup < 1 || !Number.isInteger(baselineCount) || baselineCount < 1) {
    throw new Error("Use at least 30 samples, one warmup, and one baseline query");
  }
  for (const path of [databasePath, join(engineDirectory, "cards.cdb"), values.fixture!]) if (!existsSync(path)) throw new Error(`Missing benchmark input: ${path}`);
  mkdirSync(outputDirectory, { recursive: true });
  const sourcePaths = ["packages/shared/src/services/card-insight-catalog.ts", "packages/shared/src/services/card-insights.ts",
    "packages/shared/src/services/deck-suggestions.ts", "packages/shared/src/services/deck-suggestion-hooks.ts",
    "packages/shared/src/cards/effects/name-match.ts", "packages/shared/src/cards/effects/synergy.ts",
    "packages/shared/src/cards/effects/effect-match.ts", "packages/shared/src/duels/card-query.ts",
    "packages/shared/src/cards/effects/deck-summon.ts", "packages/duel-server/src/deck-legality.ts",
    "packages/duel-server/src/host.ts", "packages/shared/src/services/deck-suggestion-query.ts",
    "packages/web/src/lib/deck-suggestions.ts", "packages/web/src/lib/duel-host.ts",
    "packages/web/app/api/cards/insights/route.ts", "packages/web/app/api/cards/resolve/route.ts",
    "packages/web/app/api/decks/cards/route.ts", "scripts/deck-suggestions-benchmark.ts"];
  const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, sha(readFileSync(join(root, path)))]));
  const sourceBefore = sourceHashes();
  const fixtureBytes = readFileSync(values.fixture!), fixtureSha256 = sha(fixtureBytes);
  const fixtures = JSON.parse(fixtureBytes.toString("utf8")).fixtures as Fixture[];
  const selected = values.decks!.split(",").map(id => {
    const fixture = fixtures.find(fixture => fixture.id === id);
    if (!fixture) throw new Error(`Unknown fixture ${id}`); return fixture;
  });
  const partial: Record<string, any> = { status: "running", startedAt: new Date().toISOString(), samples, warmup, baselineCount,
    actualNext: !!values.next, sourceDatabasePath, engineDirectory, fixtureSha256, sourceBefore, webAllocatorEnvironment };
  const checkpoint = (stage: string, details: object = {}) => {
    Object.assign(partial, details, { stage, checkpointAt: new Date().toISOString(), childEvents });
    writeFileSync(join(outputDirectory, "report.partial.json"), JSON.stringify(partial, null, 2) + "\n");
  };
  checkpoint("initialization");
  const children: ChildProcess[] = [];
  let closeInspector = () => {};
  try {
    const { default: Database } = await import("better-sqlite3");
    if (values.next) {
      const source = new Database(sourceDatabasePath, { readonly: true, fileMustExist: true });
      const runtimePath = join(outputDirectory, `next-runtime-${process.pid}.sqlite`);
      try { await source.backup(runtimePath); } finally { source.close(); }
      databasePath = runtimePath;
      const runtime = new Database(databasePath);
      try {
        runtime.prepare("INSERT INTO users(id,username,display_name) VALUES(?,?,?)").run(USER, "benchmark-only", "Benchmark");
        runtime.prepare("INSERT INTO players(guild_id,user_id,display_name) VALUES(?,?,?)").run(GUILD, USER, "Benchmark");
      } finally { runtime.close(); }
    }
    const host = await startWorker(values.next ? "duel" : "scope"); children.push(host.child);
    const next = values.next ? await startNext(host.url) : undefined;
    const web = next ?? await startWorker("web", host.url); children.push(web.child);
    if (next) closeInspector = next.closeInspector;
    const webRequest = async (path: string, body?: unknown): Promise<any> => next ? next.request(path, body) : call(`${web.url}${path}`, body);
    progress(`${values.next ? "Actual Next production" : "HTTP web backend"} PID ${web.pid}; separate legality PID ${host.pid}`);
    const hostStats = () => call<HostStats>(`${host.url}/benchmark-host-stats`);
    const initializedMemory = await webRequest("/memory");
    checkpoint("initialized", { initialization: { webPid: web.pid, legalityHostPid: host.pid, webMs: web.initializationMs,
      legalityHostMs: host.initializationMs, webMemory: initializedMemory } });
    const { createInsightCatalog } = await import("../packages/shared/src/services/card-insight-catalog.js");
    const { isExtraDeckCard } = await import("../packages/shared/src/cards/effects/card.js");
    const { defaultDuelSettings } = await import("../packages/shared/src/duels/settings.js");
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const catalog = createInsightCatalog(db, engineDirectory);
    const metadata = { catalogCards: (db.prepare("SELECT count(*) n FROM card_catalog").get() as { n: number }).n,
      tagRows: (db.prepare("SELECT count(*) n FROM card_tags").get() as { n: number }).n,
      artifacts: db.prepare("SELECT artifact_version,manifest_hash,tags,profiles FROM card_tag_artifact_imports").all() };
    const scenarios: Scenario[] = [], variants: Scenario[] = [];
    const uncachedVariants = new Map<string, Scenario[]>();
    try {
      for (const fixture of selected) {
        const master = fixture.format === "domain" ? fixture.trimmedDeck.deckMaster : undefined;
        const initialScopeStart = performance.now();
        const scope = await call<DeckSuggestionLegality>(host.url, { format: fixture.format, deckMaster: master });
        const initialScopeMs = performance.now() - initialScopeStart;
        const allowed = new Set(scope.allowed), held = new Map<number, number>();
        const main: number[] = [], extra: number[] = [];
        const add = (raw: number, section: "main" | "extra") => {
          const code = catalog.canonical(raw), candidate = catalog.candidate(code);
          if (!candidate || !allowed.has(code) || isExtraDeckCard(candidate.card) !== (section === "extra")) return false;
          const group = scope.copyGroups?.[code] ?? code, max = scope.limits[code] ?? (fixture.format === "domain" ? 1 : 3);
          if ((held.get(group) ?? 0) >= max) return false;
          held.set(group, (held.get(group) ?? 0) + 1); (section === "main" ? main : extra).push(code); return true;
        };
        for (const code of fixture.fullDeck.main) { if (main.length < 60) add(code, "main"); }
        // Prefer additional copies of the source deck's own cards up to the real copy limit.
        for (let copy = 0; copy < 3 && main.length < 60; copy++) for (const code of fixture.fullDeck.main) {
          if (main.length < 60) add(code, "main");
        }
        for (const code of scope.allowed) { if (main.length < 60) add(code, "main"); }
        if (main.length !== 60) throw new Error(`${fixture.id}: cannot build 60 admitted Main Deck cards`);
        for (const code of fixture.fullDeck.extra) { if (extra.length < 15) add(code, "extra"); }
        const scenario: Scenario = { id: fixture.id, format: fixture.format, deck: { main, extra, side: [], ...(master ? { deckMaster: master } : {}) },
          banlist: defaultDuelSettings(fixture.format).banlist, initialScopeMs,
          derivation: "Canonical published Main Deck cards filtered through authoritative admission; duplicate source cards up to copy limits, then admitted catalog Main Deck cards until 60; retained admitted source Extra Deck cards; empty Side Deck." };
        const validation = await call<{ issues: unknown[] }>(`${host.url}/validate`, { format: fixture.format, deck: scenario.deck });
        if (validation.issues.length) throw new Error(`${fixture.id}: benchmark deck failed the authoritative validator: ${JSON.stringify(validation.issues)}`);
        scenarios.push(scenario);
        const derived: Scenario[] = [];
        for (const code of scope.allowed) {
          if (held.has(scope.copyGroups?.[code] ?? code)) continue;
          if (fixture.format === "domain" && !isExtraDeckCard(catalog.candidate(code)!.card)) continue;
          derived.push({ ...scenario, deck: fixture.format === "normal" ? { ...scenario.deck, side: [code] }
            : { ...scenario.deck, extra: [...scenario.deck.extra.slice(0, 14), code] } });
          if (derived.length === Math.max(64, samples + warmup + 1) + 3) break;
        }
        if (derived.length < samples + warmup + 1) throw new Error(`${fixture.id}: insufficient distinct legal request variants`);
        uncachedVariants.set(fixture.id, derived);
        if (fixture.format === "normal" && !variants.length) variants.push(...derived.slice(0, 64));
      }
    } finally { catalog.close(); db.close(); }
    if (variants.length !== 64) throw new Error("Select a normal fixture to measure 64 distinct cached decks");
    checkpoint("decks-validated", { input: { sourceDatabasePath, databasePath, engineDirectory, fixturePath: resolve(values.fixture!),
      fixtureSha256, ...metadata, scenarios } });

    const baselineQueries = ["draw cards", "negate monster effects", "special summon dragon monsters", "destroy spells and traps", "banish cards", "search warrior monsters"];
    const baselineTimes: number[] = [];
    for (let at = 0; at < baselineCount; at++) {
      const reading = await webRequest("/effect-search", { text: baselineQueries[at % baselineQueries.length] });
      baselineTimes.push(reading.milliseconds);
      if ((at + 1) % 4 === 0) progress(`Existing effect-search warmup ${at + 1}/${baselineCount}`);
    }
    const beforeTransportMemory = await webRequest("/memory");
    progress(`Effect-search baseline before HTTP transport RSS ${beforeTransportMemory.rss} bytes`);
    // Existing card-query/facets/details already use this same host fetch transport.
    // Warm its runtime using tiny capabilities-shaped replies, never the Suggestions scorer or scope payload.
    for (let at = 0; at < 3; at++) await webRequest("/legacy-host-ping", {});
    const baseline = await webRequest("/memory");
    const hostBaselineMemory = values.next ? await call(`${host.url}/memory`) : undefined;
    progress(`Effect-search plus existing host transport baseline RSS ${baseline.rss} bytes`);
    checkpoint("baseline", { baseline: { warmupCalls: baselineCount, queries: baselineQueries, timingsMs: baselineTimes,
      beforeTransportMemory, existingHostTransportWarmupCalls: 3, memory: baseline },
      ...(hostBaselineMemory ? { signedHost: { baselineMemory: hostBaselineMemory } } : {}) });
    const timing: any[] = [];
    for (const scenario of scenarios) {
      const hostBefore = values.next ? await hostStats() : undefined;
      let uncachedAt = 0;
      const measure = async (useCache = false, variant = scenario) => {
        if (values.next && !useCache) variant = uncachedVariants.get(scenario.id)![uncachedAt++]!;
        const start = performance.now(), result = await webRequest("/suggest", { scenario: variant, useCache });
        return { ...result, httpMs: performance.now() - start, ...(values.next ? { variant: variant.deck.side[0] ?? variant.deck.extra.at(-1) } : {}) };
      };
      const cold = await measure();
      progress(`${scenario.id} first suggestion ${cold.serviceMs === undefined ? "" : `${cold.serviceMs.toFixed(1)}ms service, `}${cold.httpMs.toFixed(1)}ms HTTP`);
      for (let at = 0; at < warmup; at++) await measure();
      const measured = [];
      for (let at = 0; at < samples; at++) {
        measured.push(await measure());
        if ((at + 1) % 5 === 0) {
          progress(`${scenario.id} uncached ${at + 1}/${samples}; ${values.next ? "HTTP" : "service"} p95 ${quantile(measured.map(sample => sample.serviceMs ?? sample.httpMs), 0.95).toFixed(1)}ms`);
          checkpoint(`timing-${scenario.id}`, { timing, inProgress: { id: scenario.id, cold, warmupCalls: warmup, samples: measured } });
        }
      }
      const hostAfter = values.next ? await hostStats() : undefined;
      const hostComputedRequests = hostAfter && hostBefore ? hostAfter.rows.computed - hostBefore.rows.computed : undefined;
      if (values.next && hostComputedRequests !== samples + warmup + 1) {
        throw new Error(`${scenario.id}: expected ${samples + warmup + 1} genuine signed-host computations, observed ${hostComputedRequests}`);
      }
      timing.push({ id: scenario.id, format: scenario.format, mainCards: scenario.deck.main.length, extraCards: scenario.deck.extra.length,
        cold, warmupCalls: warmup, sampleCount: samples, serviceP50Ms: values.next ? null : quantile(measured.map(sample => sample.serviceMs), 0.5),
        serviceP95Ms: values.next ? null : quantile(measured.map(sample => sample.serviceMs), 0.95), httpP95Ms: quantile(measured.map(sample => sample.httpMs), 0.95),
        scopeP95Ms: values.next ? null : quantile(measured.map(sample => sample.scopeMs), 0.95),
        cacheBypass: values.next ? "Distinct legal Side/Extra Deck variants; each miss computed by signed host with its service cache disabled" : "cache:false",
        ...(values.next ? { hostComputedRequests, hostBefore, hostAfter } : {}), samples: measured });
      checkpoint(`timing-${scenario.id}-complete`, { timing, inProgress: undefined });
    }
    const afterUncached = await webRequest("/memory");
    const cacheMemory: any[] = [];
    checkpoint("uncached-memory", { timing, memory: { afterUncached, cacheSamples: cacheMemory } });
    for (let at = 0; at < variants.length; at++) {
      await webRequest("/suggest", { scenario: variants[at], useCache: true });
      if ((at + 1) % 8 === 0) {
        const memory = await webRequest("/memory"); cacheMemory.push({ decks: at + 1, ...memory });
        progress(`Distinct cached decks ${at + 1}/64; web RSS ${memory.rss} bytes`);
        checkpoint(`cache-${at + 1}`, { memory: { afterUncached, cacheSamples: cacheMemory } });
      }
    }
    const cacheReplayHostBefore = values.next ? await hostStats() : undefined;
    const cachedTimes = [];
    for (const scenario of variants) { const result = await webRequest("/suggest", { scenario, useCache: true }); cachedTimes.push(result.serviceMs ?? result.httpMs); }
    const cacheReplayHostAfter = values.next ? await hostStats() : undefined;
    const cacheReplay = cacheReplayHostBefore && cacheReplayHostAfter ? {
      computedRequests: cacheReplayHostAfter.rows.computed - cacheReplayHostBefore.rows.computed,
      notModifiedRequests: cacheReplayHostAfter.rows.notModified - cacheReplayHostBefore.rows.notModified,
      failedRequests: cacheReplayHostAfter.rows.failed - cacheReplayHostBefore.rows.failed,
    } : undefined;
    if (cacheReplay && (cacheReplay.computedRequests !== 0 || cacheReplay.notModifiedRequests !== 64 || cacheReplay.failedRequests !== 0)) {
      throw new Error(`Expected 64 version-validated web cache hits without host recomputation: ${JSON.stringify(cacheReplay)}`);
    }
    const after64Cache = await webRequest("/memory");
    const hostAfter64Memory = values.next ? await call(`${host.url}/memory`) : undefined;
    const maximumRetainedRss = Math.max(afterUncached.rss, after64Cache.rss, ...cacheMemory.map(memory => memory.rss));
    const extraRetainedRss = Math.max(0, maximumRetainedRss - baseline.rss);
    const thresholds = { uncachedP95Below400Ms: timing.every(measurement => (measurement.serviceP95Ms ?? measurement.httpP95Ms) < 400),
      uncachedHttpP95Below400Ms: timing.every(measurement => measurement.httpP95Ms < 400), retainedWebRssBelow5MiB: extraRetainedRss < 5 * 1024 * 1024 };
    checkpoint("memory-complete", { memory: { afterUncached, cacheSamples: cacheMemory, after64Cache, maximumRetainedRss,
      extraRetainedRss, cachedDecks: 64, cachedRequestP95Ms: quantile(cachedTimes, 0.95), cacheReplay }, thresholds });
    let profileSummary;
    if (values.profile) {
      await webRequest("/profile/start", {});
      for (let at = 0; at < 3; at++) await webRequest("/suggest", { scenario: values.next ? uncachedVariants.get(scenarios[0]!.id)!.at(-at - 1) : scenarios[0], useCache: false });
      await webRequest("/profile/stop", {});
      const profile = JSON.parse(readFileSync(join(outputDirectory, "web.cpuprofile"), "utf8"));
      const frames = new Map<string, any>();
      for (const node of profile.nodes as any[]) if (node.hitCount) {
        const key = JSON.stringify(node.callFrame), known = frames.get(key);
        if (known) known.hitCount += node.hitCount; else frames.set(key, { ...node, hitCount: node.hitCount });
      }
      const sampled = [...frames.values()].sort((a, b) => b.hitCount - a.hitCount);
      const total = sampled.reduce((sum, node) => sum + node.hitCount, 0);
      profileSummary = sampled.slice(0, 15).map(node => {
        const frame = node.callFrame;
        let sourceExcerpt: string | undefined;
        if (frame.url.startsWith("file:") && /\.[cm]?[jt]s$/.test(frame.url)) try {
          const line = readFileSync(new URL(frame.url), "utf8").split("\n")[frame.lineNumber] ?? "";
          sourceExcerpt = line.slice(Math.max(0, frame.columnNumber - 50), frame.columnNumber + 250);
        } catch { /* Source text is optional; the raw CPU profile remains inspectable. */ }
        return { name: frame.functionName, file: frame.url.replace(root, ""), line: frame.lineNumber + 1,
          column: frame.columnNumber, samples: node.hitCount, share: node.hitCount / total, sourceExcerpt };
      });
    }
    const finalHostStats = values.next ? await hostStats() : undefined;
    const sourceAfter = sourceHashes(), sourceChangedDuringRun = JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)
      || fixtureSha256 !== sha(readFileSync(values.fixture!));
    const report = { measuredAt: new Date().toISOString(), method: values.next ? "Actual Next.js standalone production server, E2E authentication, unchanged insights HTTP route and signed duel-host suggestion scans. Web-only RSS sampled through loopback Node inspector."
      : "Isolated Node HTTP web-backend harness using production services; separate authoritative legality HTTP process. Not a Next.js RSS measurement.",
      limitations: [values.next ? "Uses loopback HTTP and synthetic E2E authentication; excludes browser rendering, Clerk network calls and TLS. Separate service timing is not instrumented."
        : "Excludes Next.js, authentication, browser rendering and TLS overhead.", "RSS is actual process.memoryUsage().rss after 3 forced GCs; allocator retention and concurrent machine load affect results.",
        "Engine files and source catalog are read-only; Next authentication uses its own disposable database backup. Benchmark decks are derived legal 60-card inputs.", "Scope preparation is recorded separately; first suggestion timing is cold for suggestion scoring with the legality host already warm.",
        "Suggestion scans and tag decoding run in the existing duel host; the <5 MiB RSS gate applies to the Next web process. Host memory is reported separately without a gate."],
      node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
      webAllocatorEnvironment, ...(values.next ? { signedHost: { stats: finalHostStats, baselineMemory: hostBaselineMemory, after64Memory: hostAfter64Memory,
        retainedRssChange: hostAfter64Memory.rss - hostBaselineMemory.rss }, cacheReplay } : {}),
      input: { sourceDatabasePath, databasePath, engineDirectory, fixturePath: resolve(values.fixture!), fixtureSha256, ...metadata, scenarios },
      initialization: { webPid: web.pid, legalityHostPid: host.pid, webMs: web.initializationMs, legalityHostMs: host.initializationMs, webMemory: initializedMemory },
      baseline: { warmupCalls: baselineCount, queries: baselineQueries, timingsMs: baselineTimes, beforeTransportMemory,
        existingHostTransportWarmupCalls: 3, memory: baseline }, timing,
      memory: { afterUncached, cacheSamples: cacheMemory, after64Cache, maximumRetainedRss, extraRetainedRss, extraRetainedMiB: extraRetainedRss / (1024 * 1024),
        extraVersusNoTransportRss: Math.max(0, maximumRetainedRss - beforeTransportMemory.rss),
        cacheOnlyRetainedRss: Math.max(0, maximumRetainedRss - afterUncached.rss),
        cachedDecks: 64, cachedServiceP95Ms: values.next ? null : quantile(cachedTimes, 0.95), cachedRequestP95Ms: quantile(cachedTimes, 0.95) }, thresholds,
      sourceChangedDuringRun, sourceBefore, sourceAfter, childEvents, ...(profileSummary ? { profileSummary } : {}) };
    writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n");
    progress(`Report: ${join(outputDirectory, "report.json")}`);
    process.stdout.write(JSON.stringify({ timing: timing.map(({ samples, ...summary }) => summary), extraRetainedRss,
      extraRetainedMiB: extraRetainedRss / (1024 * 1024), cachedServiceP95Ms: report.memory.cachedServiceP95Ms, thresholds, sourceChangedDuringRun, profileSummary }, null, 2) + "\n");
    if (values.check && (sourceChangedDuringRun || !Object.values(thresholds).every(Boolean))) process.exitCode = 1;
    checkpoint("complete", { status: "complete", thresholds, sourceChangedDuringRun, sourceAfter });
  } catch (error) {
    checkpoint("failed", { status: "failed", failedAt: partial.stage, error: describeError(error), sourceAfter: sourceHashes() });
    throw error;
  } finally {
    closeInspector(); await Promise.allSettled(children.map(stopWorker));
    checkpoint(partial.stage, { childrenClosed: true });
  }
}

if (values.help) {
  console.log("node --import tsx scripts/deck-suggestions-benchmark.ts --catalog /tmp/catalog.sqlite --engine /read-only/engine --output /tmp/benchmark [--samples 60] [--profile] [--check] [--next --next-dist .next-deck-suggestions-perf]\nDefault measures an isolated Node HTTP backend. --next measures the prebuilt real Next standalone server and signed duel host. No environment files are loaded; Next startup refuses an environment file if present. Children exit before command completion.");
} else {
  void (values.worker ? worker() : benchmark()).catch(error => { console.error(error); process.exitCode = 1; if (values.worker) process.exit(1); });
}
