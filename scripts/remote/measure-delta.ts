/** Real-stack measurement and proof harness for Remote Duels delivery (design F in
 * data/briefs/remote-duels/client-state-analysis-2026-11-06.md).
 *
 * What runs: the production web standalone build, the built ws server, real Socket.IO clients and real HTTP.
 * The room lives in a temporary SQLite file (WAL). Each web request makes a new service, as in production.
 * Login uses the E2E cookie. Two seats and one spectator play one scripted 1v1 game with real cards from cards.cdb.
 *
 * Build first (Node 22):
 *   npm run build --workspace=packages/shared && npm run build --workspace=packages/ws
 *   E2E_NEXT_DIST_DIR=.next-measure NEXT_PUBLIC_WS_URL=http://localhost:3482 E2E_AUTH=1 \
 *     E2E_AUTH_SECRET=measure-build-only-secret-0000000000000000 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k \
 *     npm run build --workspace=packages/web
 * Run (from the repo root):
 *   node --import tsx scripts/remote/measure-delta.ts                                  baseline numbers
 *   node --import tsx scripts/remote/measure-delta.ts --proof --patch                  patches: compare to GET, leak scan
 *   node --import tsx scripts/remote/measure-delta.ts --proof --patch --drop-every 40  also drop every 40th patch, check the repair
 *   node --import tsx scripts/remote/measure-delta.ts --selftest                       no servers: tests the comparator only
 * Options: --actions N (default 720) --root DIR (checkout with the builds) --dist DIR (default .next-measure) --csv FILE
 *   --cards cards.cdb --out DIR --keep --no-pin --quiet (no per-action lines) --quiet-ms N (settle time, default 12)
 * Exit code 1 when --proof finds a mismatch, a leak or a failed repair.
 *
 * Numbers: "web ms" and "ws ms" are on-CPU time of every thread of the process (/proc/<pid>/task/<tid>/schedstat) during the
 * action window, minus the idle rate measured before the run. "KB sent" is the UTF-8 JSON size of the socket events that the
 * three clients received, plus the HTTP body of the POST answer. "WAL KB" is the growth of the WAL (frames from the -shm header).
 * The proof GETs run after the window closes, so they do not count in these numbers.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { io as ioClient, type Socket } from "socket.io-client";

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string, fallback?: string) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback; };
const num = (name: string, fallback: number) => Number(opt(name, String(fallback)));
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

// ---------- pure helpers (tested by --selftest) ----------
type Json = any;
type PatchOp = { p: (string | number)[]; v?: unknown; d?: true; x?: [number, number, unknown[]] };
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The contract of packages/shared/src/remote/delta.ts, used only when the build under test has no applyPatch. */
function fallbackApplyPatch<T>(view: T, ops: readonly PatchOp[]): T {
  const bad = (m: string): never => { throw new Error("Bad patch: " + m); };
  const at = (node: any, path: (string | number)[], depth: number, op: PatchOp): any => {
    if (depth === path.length) {
      if (!op.x || !Array.isArray(node)) return bad("splice target");
      const [start, count, items] = op.x;
      if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > node.length) bad("splice range");
      return [...node.slice(0, start), ...items, ...node.slice(start + count)];
    }
    const step = path[depth], final = depth === path.length - 1 && !op.x;
    if (Array.isArray(node)) {
      if (final && step === "length") { if (op.d || typeof op.v !== "number" || op.v < 0 || op.v > node.length) bad("length"); return node.slice(0, op.v); }
      if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > node.length || (step === node.length && (!final || op.d))) bad("index");
      const copy = node.slice();
      if (final) { if (op.d) copy.splice(step as number, 1); else copy[step as number] = op.v; } else copy[step as number] = at(node[step as number], path, depth + 1, op);
      return copy;
    }
    if (isObj(node)) {
      if (typeof step !== "string" || ["__proto__", "constructor", "prototype"].includes(step)) bad("key");
      const copy: Record<string, unknown> = { ...node };
      if (final) { if (op.d) delete copy[step as string]; else copy[step as string] = op.v; }
      else { if (!Object.hasOwn(node, step as string)) bad("missing parent"); copy[step as string] = at(node[step as string], path, depth + 1, op); }
      return copy;
    }
    return bad("parent is not a container");
  };
  let cur: any = view;
  for (const op of ops) {
    if (!op || !Array.isArray(op.p)) bad("op");
    if (op.p.length === 0 && !op.x) { if (op.d) bad("root delete"); cur = op.v; } else cur = at(cur, op.p, 0, op);
  }
  return cur;
}

/** Differences between two JSON values as "path" strings (at most `limit`). */
function jsonDiffs(a: Json, b: Json, path = "", out: string[] = [], limit = 20): string[] {
  if (out.length >= limit || a === b) return out;
  if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] === undefined && b[key] === undefined) continue;
      jsonDiffs(a[key], b[key], path ? path + "." + key : key, out, limit);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length(${a.length}!=${b.length})`);
    for (let i = 0; i < Math.min(a.length, b.length) && out.length < limit; i++) jsonDiffs(a[i], b[i], `${path}[${i}]`, out, limit);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path || "(root)");
  return out;
}

/** Keys that the browser adds to the room itself. A patch never touches them. */
const CLIENT_KEYS = new Set(["mySeat", "isDeveloper", "spectator", "spectatorCount"]);
const flatRoom = (room: any) => Object.fromEntries(Object.entries(room).filter(([k]) => !CLIENT_KEYS.has(k)));
const flatSnapshot = (snap: any) => ({ ...snap.table, state: snap.state, events: snap.events });

/** What one client holds. `patch` returns "applied", "gap" (base does not match: repair with one GET) or "bad" (the ops did not fit). */
class Held {
  view: any = null; seq = 0;
  constructor(private apply: <T>(v: T, ops: readonly PatchOp[]) => T) {}
  setFull(view: any, seq = view?.lastSeq ?? 0) { if (!this.view || seq >= this.seq) { this.view = view; this.seq = seq; } }
  force(view: any) { this.view = view; this.seq = view.lastSeq; }
  patch(m: { seq: number; base: number; ops: PatchOp[] }): "applied" | "gap" | "bad" {
    if (!this.view || m.base !== this.seq) return "gap";
    try { this.view = this.apply(this.view, m.ops); this.seq = m.seq; return "applied"; } catch { return "bad"; }
  }
}

/** True when `fact` occurs in `text` as a whole number (ids) or as a plain substring (names). */
const hasFact = (text: string, fact: number | string) => typeof fact === "number" ? new RegExp(`(?<![0-9])${fact}(?![0-9])`).test(text) : text.includes(fact);
/**
 * Leak test for one observer: a fact of the moved card may be in what the server sent only when the observer's own view (GET after
 * the move) holds it too. `conclusive` is true when at least one fact is truly hidden after the move, so the test could fail.
 */
function leakCheck(facts: (number | string)[], sent: string, viewAfter: string) {
  const leaked = facts.filter(f => hasFact(sent, f) && !hasFact(viewAfter, f));
  return { leaked, conclusive: facts.some(f => !hasFact(viewAfter, f)) };
}

/** Paths in a JSON value whose key or leaf holds the fact (for the report of an inconclusive check). */
function factPaths(value: Json, fact: number | string, path = "", out: string[] = []): string[] {
  if (out.length >= 3) return out;
  if (isObj(value)) for (const [k, v] of Object.entries(value)) factPaths(v, fact, path ? path + "." + k : k, out);
  else if (Array.isArray(value)) value.forEach((v, i) => factPaths(v, fact, `${path}[${i}]`, out));
  else if (value !== undefined && value !== null && hasFact(String(value), fact)) out.push(path);
  return out;
}

// ---------- selftest ----------
function selftest() {
  const results: string[] = [];
  const ok = (name: string, fn: () => void) => { fn(); results.push("PASS " + name); };
  const base = { slug: "t", lastSeq: 5, state: { seats: [{ n: 1, cards: [{ ref: "a", zone: "monster", cardId: 111 }] }, { n: 2, cards: [] }] }, events: [{ id: "e1" }, { id: "e2" }] };
  ok("fallback applies set, delete, splice, length and root replace", () => {
    const v1 = fallbackApplyPatch(base, [{ p: ["lastSeq"], v: 6 }, { p: ["state", "seats", 0, "cards", 0, "cardId"], d: true }, { p: ["events"], x: [0, 1, [{ id: "e3" }]] }, { p: ["events", "length"], v: 1 }]);
    assert.deepEqual(v1.events, [{ id: "e3" }]); assert.equal(v1.lastSeq, 6); assert.equal(v1.state.seats[0].cards[0].cardId, undefined);
    assert.equal(base.lastSeq, 5, "input stays unchanged");
    assert.deepEqual(fallbackApplyPatch(base, [{ p: [], v: { x: 1 } }]), { x: 1 });
  });
  ok("fallback refuses a bad path", () => {
    assert.throws(() => fallbackApplyPatch(base, [{ p: ["state", "nope", "x"], v: 1 }]));
    assert.throws(() => fallbackApplyPatch(base, [{ p: ["events", 9], v: 1 }]));
    assert.throws(() => fallbackApplyPatch(base, [{ p: ["__proto__", "x"], v: 1 }]));
  });
  ok("held view: apply, gap after a dropped patch, bad ops, repair", () => {
    const h = new Held(fallbackApplyPatch); h.force(flatRoom(base));
    assert.equal(h.patch({ seq: 6, base: 5, ops: [{ p: ["lastSeq"], v: 6 }] }), "applied"); assert.equal(h.seq, 6);
    assert.equal(h.patch({ seq: 8, base: 7, ops: [{ p: ["lastSeq"], v: 8 }] }), "gap"); assert.equal(h.seq, 6, "a gap changes nothing");
    assert.equal(h.patch({ seq: 7, base: 6, ops: [{ p: ["state", "x", "y"], v: 1 }] }), "bad");
    h.force({ ...flatRoom(base), lastSeq: 8 }); assert.equal(h.seq, 8);
    assert.equal(h.patch({ seq: 8, base: 8, ops: [] }), "applied", "same sequence patches are allowed");
  });
  ok("comparator finds a changed card, a missing key and a length change", () => {
    const other = structuredClone(flatRoom(base)) as any;
    assert.deepEqual(jsonDiffs(flatRoom(base), other), []);
    other.state.seats[0].cards[0].cardId = 222; other.extra = 1; other.events.push({ id: "e3" });
    const diffs = jsonDiffs(flatRoom(base), other);
    assert(diffs.includes("state.seats[0].cards[0].cardId") && diffs.includes("extra") && diffs.some(d => d.startsWith("events.length")), diffs.join());
  });
  ok("flat views ignore the browser keys", () => {
    const room = { ...flatRoom(base), mySeat: 0, spectator: false, isDeveloper: false, spectatorCount: 1 };
    assert.deepEqual(jsonDiffs(flatRoom(room), flatRoom(base)), []);
    assert.deepEqual(flatSnapshot({ table: { slug: "t", lastSeq: 5 }, state: 1, events: [] }), { slug: "t", lastSeq: 5, state: 1, events: [] });
  });
  ok("leak scan flags a hidden id and a hidden name, passes clean and public data", () => {
    const hidden = { ops: [{ p: ["state", "seats", 0, "cards", 0], v: { ref: "L0", zone: "hand", cardId: 70781052 } }] };
    const after = JSON.stringify({ cards: [{ ref: "L0", zone: "hand" }] });
    assert.deepEqual(leakCheck([70781052, "Summoned Skull"], JSON.stringify(hidden), after).leaked, [70781052]);
    assert.deepEqual(leakCheck([70781052, "Summoned Skull"], JSON.stringify({ ops: [{ p: ["x"], v: "Summoned Skull" }] }), after).leaked, ["Summoned Skull"]);
    const clean = leakCheck([70781052, "Summoned Skull"], JSON.stringify({ ops: [{ p: ["state", "seats", 0, "cards", 0, "cardId"], d: true }] }), after);
    assert.deepEqual(clean.leaked, []); assert(clean.conclusive);
    assert.deepEqual(leakCheck([70781052], JSON.stringify({ n: 170781052 }), after).leaked, [], "a longer number is not the id");
    assert.deepEqual(leakCheck([70781052], hidden.ops[0].v.cardId + "", JSON.stringify({ log: "70781052" })).leaked, [], "a fact the viewer sees is no leak");
    assert.equal(leakCheck([70781052], "{}", JSON.stringify({ log: "70781052" })).conclusive, false);
  });
  ok("a dropped patch is repaired by the next one (state machine)", () => {
    let server = flatRoom(base) as any;
    const h = new Held(fallbackApplyPatch); h.force(server);
    let dropped = 0, repairs = 0, mismatches = 0;
    for (let seq = 6; seq <= 130; seq++) {
      const next = { ...server, lastSeq: seq, events: [...server.events, { id: "e" + seq }].slice(-3) };
      const m = { seq, base: seq - 1, ops: [{ p: ["lastSeq"], v: seq } as PatchOp, { p: ["events"], x: [0, server.events.length, next.events] } as PatchOp] };
      server = next;
      if (seq % 40 === 0) { dropped++; continue; }
      if (h.patch(m) !== "applied") { repairs++; h.force(server); }
      if (jsonDiffs(h.view, server).length) mismatches++;
    }
    assert.equal(dropped, 3); assert.equal(repairs, 3); assert.equal(mismatches, 0);
  });
  console.log(results.join("\n") + `\nselftest passed (${results.length} checks)`);
}
if (flag("--selftest")) { selftest(); process.exit(0); }

// ---------- stack ----------
const root = resolve(opt("--root", resolve(dirname(fileURLToPath(import.meta.url)), "../.."))!);
const distDir = opt("--dist", ".next-measure")!;
const webDir = join(root, "packages/web", distDir, "standalone/packages/web");
const wsMain = join(root, "packages/ws/dist/server.js");
const ACTIONS = num("--actions", 720), QUIET_MS = num("--quiet-ms", 12), DROP_EVERY = num("--drop-every", 0);
const PROOF = flag("--proof"), PATCH = flag("--patch"), VERBOSE = !flag("--quiet");
const ports = { web: 3481, ws: 3482, wsInternal: 4482 };
const guildId = "900000000000000001";
const secrets = { auth: "measure-auth-" + "a1b2c3d4e5f6".repeat(4), ws: "measure-ws-" + "f6e5d4c3b2a1".repeat(4) };
const kids: ChildProcess[] = [];
const killAll = () => { for (const k of kids) if (k.pid && k.exitCode === null) { try { process.kill(k.pid, "SIGTERM"); } catch { /* gone */ } } };
process.on("exit", killAll);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { killAll(); process.exit(130); });

const gitSha = (() => {
  try {
    const sha = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim();
    return sha + (dirty ? "+dirty" : "");
  } catch { return "unknown"; }
})();

async function portFree(port: number) {
  await new Promise<void>((done, fail) => { const probe = createServer(); probe.once("error", fail); probe.listen(port, "127.0.0.1", () => probe.close(() => done())); });
}

const stat = (v: number[]) => {
  if (!v.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...v].sort((a, b) => a - b);
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
};
const f = (n: number, d = 2) => n.toFixed(d);

// ---------- /proc readers ----------
const loadAvg = () => readFileSync("/proc/loadavg", "utf8").trim().split(" ").slice(0, 3).join(" ");
function descendants(rootPid: number) {
  const kidsOf = new Map<number, number[]>();
  for (const dir of readdirSync("/proc")) {
    if (!/^\d+$/.test(dir)) continue;
    try {
      const s = readFileSync(`/proc/${dir}/stat`, "utf8");
      const ppid = Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]);
      const list = kidsOf.get(ppid) ?? []; list.push(Number(dir)); kidsOf.set(ppid, list);
    } catch { /* process ended */ }
  }
  const out = [rootPid]; const walk = (p: number) => { for (const c of kidsOf.get(p) ?? []) { out.push(c); walk(c); } }; walk(rootPid);
  return out;
}
const commCache = new Map<string, string>();
/** On-CPU nanoseconds of every thread of the given processes, keyed "pid/tid comm". */
function cpuByThread(pids: number[]) {
  const out = new Map<string, number>();
  for (const pid of pids) {
    let tids: string[]; try { tids = readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tids) {
      try {
        const ns = Number(readFileSync(`/proc/${pid}/task/${tid}/schedstat`, "utf8").split(" ")[0]);
        const id = `${pid}/${tid}`;
        let comm = commCache.get(id); if (!comm) { comm = readFileSync(`/proc/${pid}/task/${tid}/comm`, "utf8").trim(); commCache.set(id, comm); }
        out.set(`${id} ${comm}`, ns);
      } catch { /* thread ended */ }
    }
  }
  return out;
}
const sumMap = (m: Map<string, number>) => { let t = 0; for (const v of m.values()) t += v; return t; };
const writeBytes = (pids: number[]) => pids.reduce((t, pid) => { try { return t + Number(/write_bytes: (\d+)/.exec(readFileSync(`/proc/${pid}/io`, "utf8"))![1]); } catch { return t; } }, 0);

// ---------- HTTP ----------
type Account = { userId: number; name: string; cookie: string };
const base = `http://localhost:${ports.web}`;
async function http(account: Account | null, method: string, path: string, body?: unknown) {
  const t = performance.now();
  const res = await fetch(base + path, { method, headers: { ...(account ? { cookie: account.cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, json, bytes: buf.length, ms: performance.now() - t, timing: res.headers.get("server-timing") ?? "", setCookie: res.headers.getSetCookie?.() ?? [] };
}
async function must(account: Account | null, method: string, path: string, body?: unknown, ok = [200, 201]) {
  const r = await http(account, method, path, body);
  if (!ok.includes(r.status)) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  return r;
}

// ---------- socket viewers ----------
class Viewer {
  sock!: Socket; held: Held; seq = 0;
  bytes = 0; events = { patch: 0, private: 0, changed: 0 }; stale = false; droppedAt = 0; gaps = 0; bads = 0; repairs = 0; drops = 0; patchBytes = 0; fullBytes = 0;
  sent: string[] = []; sentState: string[] = []; capture = false; lastEvent = 0; repairing: Promise<void> | null = null;
  constructor(public name: string, public account: Account, public seat: number | null, private slug: string, private applyFn: any, private counters: { n: number }) {
    this.held = new Held(applyFn);
  }
  /** The view the server would send now: a GET for a seat, the spectate answer for a spectator. */
  async fetchView() {
    const r = this.seat === null ? await must(this.account, "POST", `/api/remote/${this.slug}/spectate`) : await must(this.account, "GET", `/api/remote/${this.slug}`);
    return flatRoom(r.json) as any;
  }
  async repair(reason: string) {
    if (this.repairing) return this.repairing;
    this.repairing = (async () => {
      await sleep(Math.random() * 20); // the browser jitters the repair GET
      const view = await this.fetchView();
      if (!this.held.view || view.lastSeq >= this.held.seq) this.held.force(view);
      this.repairs++; this.stale = false;
    })().finally(() => { this.repairing = null; });
    void reason;
    return this.repairing;
  }
  private note(kind: "patch" | "private" | "changed", payload: unknown) {
    const text = JSON.stringify(payload), n = Buffer.byteLength(text);
    this.bytes += n; this.events[kind]++; this.lastEvent = performance.now();
    if (kind === "patch") this.patchBytes += n; else this.fullBytes += n;
    if (this.capture) {
      this.sent.push(text);
      // The same payload without the event log: a card seen in an old public event is no leak of a new hidden fact.
      const p = payload as any;
      this.sentState.push(JSON.stringify(kind === "patch" ? { ...p, ops: p.ops.filter((op: PatchOp) => op.p[0] !== "events") } : { ...p, events: undefined }));
    }
  }
  async connect(patch: boolean) {
    const sock = this.sock = ioClient(`http://localhost:${ports.ws}`, { transports: ["websocket"], forceNew: true, reconnection: false });
    sock.on("remote:private", (snap: any) => {
      this.note("private", snap);
      if (snap.table.slug !== this.slug) return;
      if (DROP_EVERY && !PATCH && armed.on && ++this.counters.n % DROP_EVERY === 0) { this.drops++; this.droppedAt = snap.table.lastSeq; this.stale = true; return; }
      this.held.setFull(flatSnapshot(snap), snap.table.lastSeq); this.stale = false;
    });
    sock.on("remote:patch", (m: any) => {
      this.note("patch", m);
      if (m.slug !== this.slug) return;
      if (DROP_EVERY && armed.on && ++this.counters.n % DROP_EVERY === 0) { this.drops++; this.droppedAt = m.seq; this.stale = true; return; }
      const r = this.held.patch(m);
      if (r === "gap") { this.gaps++; void this.repair("gap"); } else if (r === "bad") { this.bads++; void this.repair("bad"); }
      else this.stale = false;
    });
    sock.on("remote:changed", (snap: any) => {
      this.note("changed", snap);
      if (snap.table.slug === this.slug && snap.table.lastSeq > this.held.seq && !this.stale) void this.repair("changed");
    });
    await new Promise<void>((done, fail) => { sock.once("connect", done); sock.once("connect_error", fail); });
    const conn = await must(this.account, "GET", `/api/remote/${this.slug}/connection`);
    await new Promise<void>((done, fail) => sock.emit("remote:join", { token: conn.json.token, ...(patch ? { patch: 1 } : {}) }, (a: any) => a?.ok ? done() : fail(new Error("join refused " + JSON.stringify(a)))));
    this.held.force(await this.fetchView());
  }
  /** Reached the given sequence, or lost it on purpose. */
  reached(seq: number) { return this.held.seq >= seq || (this.stale && this.droppedAt >= seq); }
}
const armed = { on: false };

// ---------- main ----------
async function main() {
  for (const [label, file] of [["web standalone build", join(webDir, "server.js")], ["ws build", wsMain], ["shared build", join(root, "packages/shared/dist/db/index.js")]])
    if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}. Build first (see the header of this file).`);
  const cardsPath = opt("--cards") ?? [join(root, "data/duel-engine/cards.cdb"), resolve(root, "../../data/duel-engine/cards.cdb")].find(existsSync);
  if (!cardsPath || !existsSync(cardsPath)) throw new Error("cards.cdb not found. Pass --cards.");
  for (const port of Object.values(ports)) await portFree(port);

  const out = mkdtempSync(join(opt("--out", process.env.TMPDIR || tmpdir())!, "measure-delta-"));
  const dataDir = join(out, "duel-engine"); mkdirSync(dataDir);
  copyFileSync(cardsPath, join(dataDir, "cards.cdb")); writeFileSync(join(dataDir, "strings.conf"), "");
  const dbPath = join(out, "measure.sqlite");
  writeFileSync(join(out, "pids.txt"), "");

  // Real cards: 80 different Main Deck cards and 30 Extra Deck cards from cards.cdb.
  const cat = new Database(join(dataDir, "cards.cdb"), { readonly: true });
  const rows = cat.prepare("select d.id as id, d.type as type, t.name as name from datas d left join texts t on t.id=d.id where d.ot&1!=0 and d.alias=0 and d.type&16384=0 and d.id<100000000 order by d.id").all() as { id: number; type: number; name: string }[];
  cat.close();
  const extraMask = 0x40 | 0x2000 | 0x800000 | 0x4000000;
  const nameOf = new Map(rows.map(r => [r.id, r.name]));
  const main = rows.filter(r => !(r.type & extraMask)).slice(0, 80).map(r => r.id), extra = rows.filter(r => r.type & extraMask).slice(0, 30).map(r => r.id);
  assert.equal(main.length, 80); assert.equal(extra.length, 30);

  // Seed users and decks with the shared services, as the E2E stack does.
  const shared = (p: string) => import(pathToFileURL(join(root, "packages/shared/dist", p)).href);
  const { openDatabase } = await shared("db/index.js");
  const { createSavedDeckService, createPlayerService } = await shared("services/index.js");
  let applyFn: any = fallbackApplyPatch, applier = "fallback (build has no applyPatch)";
  try { const remote = await shared("remote/index.js"); if (typeof remote.applyPatch === "function") { applyFn = remote.applyPatch; applier = "shared applyPatch"; } } catch { /* keep fallback */ }
  const accounts: Account[] = ["Measure A", "Measure B", "Measure Watcher"].map((name, i) => ({ userId: 201 + i, name, cookie: "" }));
  const savedDeck: number[] = [];
  {
    const db = openDatabase(dbPath);
    const decks = createSavedDeckService(db), players = createPlayerService(db);
    db.transaction(() => {
      for (const a of accounts) {
        db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)").run(a.userId, a.name, a.name, "9000000000000" + a.userId);
        players.findOrCreate(guildId, a.userId, a.name);
      }
    })();
    for (let seat = 0; seat < 2; seat++) {
      const saved = decks.create(guildId, accounts[seat].userId, { name: "Measured deck " + seat, mode: "normal", deck: { main: main.slice(seat * 40, seat * 40 + 40), extra: extra.slice(seat * 15, seat * 15 + 15), side: [] } });
      savedDeck.push(saved.id);
    }
    db.pragma("wal_checkpoint(TRUNCATE)"); db.close();
  }

  // Processes. prlimit blocks core dumps; taskset gives each server its own core when the host has room.
  const cores = cpus().length, pin = !flag("--no-pin") && cores >= 6;
  const spawnServer = (name: string, cmd: string[], cwd: string, env: Record<string, string>, cpu: number) => {
    const wrapped = ["--core=1:1", ...(pin ? ["taskset", "-c", String(cpu)] : []), ...cmd];
    const log = openSync(join(out, name + ".log"), "w");
    const child = spawn("prlimit", wrapped, { cwd, env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env }, stdio: ["ignore", log, log] });
    kids.push(child); writeFileSync(join(out, "pids.txt"), kids.map(k => k.pid).join("\n"));
    return child;
  };
  const common = {
    NODE_ENV: "production", DATABASE_PATH: dbPath, DUEL_DATA_DIR: dataDir, DOTENV_CONFIG_PATH: join(out, "none.env"), DOTENV_CONFIG_QUIET: "true",
    REMOTE_DUELS: "1", OWNER_USER_IDS: "", DISCORD_GUILD_ID: guildId, WEB_URL: base, TMPDIR: out,
  };
  const ws = spawnServer("ws", [process.execPath, wsMain], root, { ...common, WS_PORT: String(ports.ws), WS_INTERNAL_PORT: String(ports.wsInternal), WS_INTERNAL_SECRET: secrets.ws }, 2);
  const stub = join(root, "packages/e2e/stack/fetch-stub.mjs");
  const web = spawnServer("web", [process.execPath, "server.js"], webDir, {
    ...common, PORT: String(ports.web), HOSTNAME: "localhost", NODE_OPTIONS: `--import=${stub}`,
    E2E_AUTH: "1", E2E_AUTH_SECRET: secrets.auth, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k", E2E_MANUAL: "0",
    WS_INTERNAL_URL: `http://127.0.0.1:${ports.wsInternal}`, WS_INTERNAL_SECRET: secrets.ws, DISCORD_BOT_ENABLED: "0", BOT_ANNOUNCE_URL: "", BOT_ANNOUNCE_SECRET: "",
    CARD_IMAGE_CACHE_DIR: join(out, "card-images"),
  }, 3);
  const until = async (label: string, probe: () => Promise<boolean>, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await probe().catch(() => false)) return; await sleep(250); }
    throw new Error(`${label} did not start; see ${out}/*.log`);
  };
  await until("ws", async () => (await fetch(`http://localhost:${ports.ws}/socket.io/?EIO=4&transport=polling`)).status === 200);
  await until("web", async () => (await fetch(`${base}/api/auth/session`)).status < 500);

  let failed = false;
  try {
    for (const a of accounts) {
      const r = await http(null, "POST", "/api/test-auth/session", { userId: a.userId, secret: secrets.auth });
      assert.equal(r.status, 200, "E2E login failed: " + JSON.stringify(r.json));
      a.cookie = r.setCookie.map(c => c.split(";")[0]).join("; ");
    }
    // Table: create, join, decks, ready, start, watch.
    const [A, B, W] = accounts;
    const created = await must(A, "POST", "/api/remote", { gameId: "ygo", seatCount: 2, bestOf: 3, visibility: "public", rules: { banlist: "none" }, showCardsSetFromDeck: false });
    const slug: string = created.json.slug;
    await must(B, "POST", `/api/remote/${slug}/seat`, {});
    for (let seat = 0; seat < 2; seat++) {
      await must(accounts[seat], "POST", `/api/remote/${slug}/deck`, { savedDeckId: savedDeck[seat] });
      await must(accounts[seat], "POST", `/api/remote/${slug}/ready`, { ready: true });
    }
    const started = await must(A, "POST", `/api/remote/${slug}/start`, {});
    await must(W, "POST", `/api/remote/${slug}/spectate`);
    let lastSeq: number = started.json.lastSeq;

    const counters = { n: 0 };
    const viewers = [new Viewer("seat0", A, 0, slug, applyFn, counters), new Viewer("seat1", B, 1, slug, applyFn, counters), new Viewer("watch", W, null, slug, applyFn, counters)];
    for (const v of viewers) await v.connect(PATCH);

    // ---- one action ----
    const dbShm = dbPath + "-shm";
    const wal = () => { const fd = openSync(dbShm, "r"); const b = Buffer.alloc(48); readSync(fd, b, 0, 48, 0); closeSync(fd); return { frames: b.readUInt32LE(16), salt: b.subarray(32, 40).toString("hex") }; };
    const webPids = descendants(web.pid!), wsPids = descendants(ws.pid!);
    let index = 0;
    type Row = { n: number; type: string; seq: number; webMs: number; wsMs: number; postMs: number; sockKB: number; httpKB: number; walKB: number; ok: boolean; note: string };
    const rows: Row[] = [];
    const threadTotals = new Map<string, number>();
    const mismatch = { count: 0, paths: new Map<string, number>(), actionsWithMismatch: 0, compared: 0, staleSkipped: 0, samples: [] as string[] };
    const leaks = { scenarios: [] as { step: string; observer: string; conclusive: boolean; leaked: (string | number)[]; status: string }[], failures: 0 };
    let idleRate = { web: 0, ws: 0 };
    const act = async (proposal: any, seat: number, o: { measured: boolean; leak?: { step: string; facts: (number | string)[] } }) => {
      const key = "action-" + index++;
      const body = { baseSeq: lastSeq, action: { actorSeat: seat, idempotencyKey: key, ...proposal } };
      for (const v of viewers) { v.bytes = 0; v.sent = []; v.sentState = []; v.capture = !!o.leak; }
      const w0 = wal(), c0w = cpuByThread(webPids), c0s = cpuByThread(wsPids), t0 = performance.now();
      const r = await http(seat === 0 ? A : B, "POST", `/api/remote/${slug}/actions`, body);
      const ok = r.status === 200;
      let seq = lastSeq;
      if (ok) {
        seq = r.json.lastSeq; lastSeq = seq;
        const end = performance.now() + 5000;
        while (performance.now() < end && !viewers.every(v => v.reached(seq))) await sleep(2);
        while (performance.now() - Math.max(t0, ...viewers.map(v => v.lastEvent)) < QUIET_MS) await sleep(2);
        while (viewers.some(v => v.repairing)) await sleep(2);
      }
      const t1 = performance.now(), c1w = cpuByThread(webPids), c1s = cpuByThread(wsPids), w1 = wal();
      const walFrames = w1.salt === w0.salt ? w1.frames - w0.frames : w1.frames;
      const wallMs = t1 - t0;
      const cpu = (a: Map<string, number>, b: Map<string, number>, idle: number, role: string) => {
        for (const [k, ns] of b) { const d = Math.max(0, ns - (a.get(k) ?? ns)); threadTotals.set(role + " " + k, (threadTotals.get(role + " " + k) ?? 0) + (o.measured ? d : 0)); }
        return Math.max(0, (sumMap(b) - sumMap(a)) / 1e6 - idle * wallMs);
      };
      const webMs = cpu(c0w, c1w, idleRate.web, "web"), wsMs = cpu(c0s, c1s, idleRate.ws, "ws");
      const sockKB = viewers.reduce((t, v) => t + v.bytes, 0) / 1024, httpKB = r.bytes / 1024;
      const row: Row = { n: index - 1, type: proposal.type, seq, webMs, wsMs, postMs: r.ms, sockKB, httpKB, walKB: (walFrames * 4120) / 1024, ok, note: ok ? "" : `HTTP ${r.status} ${r.json?.error ?? ""}` };
      if (o.measured) {
        rows.push(row);
        if (VERBOSE) console.log(`act ${String(row.n).padStart(4)} ${proposal.type.padEnd(11)} seq ${String(seq).padStart(5)}  web ${f(webMs).padStart(6)} ms  ws ${f(wsMs).padStart(6)} ms  post ${f(r.ms, 1).padStart(6)} ms  sent ${f(sockKB + httpKB, 1).padStart(6)} KB (sock ${f(sockKB, 1)} http ${f(httpKB, 1)})  wal ${f(row.walKB, 1).padStart(5)} KB${ok ? "" : "  REJECTED " + row.note}`);
      }
      if (ok && PROOF) await prove(row, o.leak);
      return row;
    };

    // ---- proof: compare every client to a GET, scan for hidden facts ----
    async function prove(row: Row, leak?: { step: string; facts: (number | string)[] }) {
      armed.on = true;
      const after: string[] = [], afterState: string[] = [];
      let bad = false;
      for (const v of viewers) {
        const truth = await v.fetchView();
        after.push(JSON.stringify(truth)); afterState.push(JSON.stringify({ ...truth, events: undefined }));
        if (v.stale) { mismatch.staleSkipped++; continue; } // a dropped message: the next one must repair it
        mismatch.compared++;
        const diffs = jsonDiffs(v.held.view, truth);
        if (diffs.length) {
          bad = true; mismatch.count++;
          for (const d of diffs) { const k = v.name + " " + d.replace(/\[\d+\]/g, "[]").split(".").slice(0, 3).join("."); mismatch.paths.set(k, (mismatch.paths.get(k) ?? 0) + 1); }
          if (mismatch.samples.length < 6) mismatch.samples.push(`action ${row.n} seq ${row.seq} ${v.name}: ${diffs.slice(0, 3).join(", ")}`);
        }
      }
      if (bad) mismatch.actionsWithMismatch++;
      if (leak) {
        const observers = [[viewers[1], after[1], afterState[1]], [viewers[2], after[2], afterState[2]]] as const;
        for (const [v, view, viewState] of observers) {
          // Full payload against the full GET view; if that view already shows the fact (old public events), repeat without events.
          let res = leakCheck(leak.facts, v.sent.join("\n"), view);
          if (!res.conclusive) res = leakCheck(leak.facts, v.sentState.join("\n"), viewState);
          if (!res.conclusive && process.env.MEASURE_DEBUG) console.log("  debug: view shows", JSON.stringify(leak.facts), "at", factPaths(JSON.parse(view), leak.facts[0]).join(" | "));
          const status = res.leaked.length ? "LEAK" : res.conclusive ? "clean" : "no extra (GET view already holds it)";
          leaks.scenarios.push({ step: leak.step, observer: v.name, conclusive: res.conclusive, leaked: res.leaked, status });
          if (res.leaked.length) leaks.failures++;
        }
      }
    }

    // ---- script: the same mix as scripts/remote/measure-undo-once.ts, over HTTP ----
    const seatCard = (seat: number, n: number) => (n === 13 ? extra[seat * 15] : main[seat * 40 + n]);
    for (let seat = 0; seat < 2; seat++) for (let n = 0; n < 14; n++) {
      const zone = n < 3 ? "monster" : n < 6 ? "spell-trap" : n < 11 ? "graveyard" : n < 13 ? "banished" : "extra";
      await act({ type: "twin.place", seat, zone, card: { ref: `s${seat}-${n}`, cardId: seatCard(seat, n), faceUp: n < 3 || (n >= 6 && n < 13), ...(n < 6 ? { slot: (n % 3) + 1 } : {}) } }, seat, { measured: false });
    }
    const proposal = (step: number) => {
      const within = step % 40, seat = Math.floor(step / 40) % 2;
      if ([8, 18, 28].includes(within)) return { seat, action: { type: "hand.count", value: within === 18 ? 6 : 5 } };
      if ([9, 19, 29].includes(within)) return { seat, action: { type: "undo", targetActionId: "action-" + (index - 1) } };
      if (within === 36) return { seat, action: { type: "phase.set", phase: "main2" } };
      if (within === 37 || within === 38) return { seat, action: { type: "lp.change", seat, delta: within === 37 ? -100 : 100, reason: "effect" } };
      if (within === 39) return { seat, action: { type: "turn.end" } };
      return { seat, action: { type: "twin.flip", seat, cardRef: `s${seat}-${3 + (within % 3)}`, faceUp: within % 2 === 0 } };
    };
    for (let i = 0; i < 120; i++) { const p = proposal(i); await act(p.action, p.seat, { measured: false }); }

    // Leak block: a public card of seat 0 becomes hidden three ways. Seat 1 and the spectator must learn nothing about it.
    const leakBlock = async (round: number) => {
      const ids = [main[20 + round * 3], main[21 + round * 3], main[22 + round * 3]];
      const facts = (id: number): (number | string)[] => [id, ...(nameOf.get(id) && nameOf.get(id)!.length >= 6 ? [nameOf.get(id)!] : [])];
      const ref = (k: number) => `L${round}-${k}`;
      const flipAt = round === 0 ? { zone: "monster", slot: 4 } : { zone: "spell-trap", slot: 5 }; // the flipped card stays on the field
      const steps: [string, any, (number | string)[]?][] = [
        ["place face-up", { type: "twin.place", seat: 0, zone: flipAt.zone, card: { ref: ref(0), cardId: ids[0], faceUp: true, slot: flipAt.slot } }],
        ["flip face-down", { type: "twin.flip", seat: 0, cardRef: ref(0), faceUp: false }, facts(ids[0])],
        ["place face-up", { type: "twin.place", seat: 0, zone: "monster", card: { ref: ref(1), cardId: ids[1], faceUp: true, slot: 5 } }],
        ["field to hand (hand.add)", { type: "hand.add", cardId: ids[1], source: "field" }, facts(ids[1])],
        ["place face-up", { type: "twin.place", seat: 0, zone: "spell-trap", card: { ref: ref(2), cardId: ids[2], faceUp: true, slot: 4 } }],
        ["move to hand (twin.move)", { type: "twin.move", seat: 0, zone: "hand", cardRef: ref(2) }, facts(ids[2])],
      ];
      for (const [step, proposalBody, hidden] of steps) {
        const row = await act(proposalBody, 0, { measured: true, leak: hidden ? { step: `${step} (round ${round})`, facts: hidden } : undefined });
        if (!row.ok) { leaks.scenarios.push({ step: `${step} (round ${round})`, observer: "both", conclusive: false, leaked: [], status: "step rejected: " + row.note }); }
      }
    };

    // ---- idle rate: servers with no traffic ----
    const i0w = sumMap(cpuByThread(webPids)), i0s = sumMap(cpuByThread(wsPids)), it0 = performance.now();
    await sleep(4000);
    const idleMs = performance.now() - it0;
    idleRate = { web: (sumMap(cpuByThread(webPids)) - i0w) / 1e6 / idleMs, ws: (sumMap(cpuByThread(wsPids)) - i0s) / 1e6 / idleMs };

    const loadStart = loadAvg(), io0 = writeBytes([...webPids, ...wsPids]), measureStart = performance.now(), frames0 = wal();
    armed.on = PROOF || DROP_EVERY > 0;
    let leakDone = 0;
    for (let i = 0; i < ACTIONS; i++) {
      if (PROOF && (i === 20 || i === Math.floor(ACTIONS / 2)) && leakDone < 2) { await leakBlock(leakDone++); continue; }
      const p = proposal(i + 120); await act(p.action, p.seat, { measured: true });
    }
    const loadEnd = loadAvg(), wallS = (performance.now() - measureStart) / 1000, ioBytes = writeBytes([...webPids, ...wsPids]) - io0;

    // A final poll, like the 30 s refresh of the browser: anything still stale must repair to the server view.
    let pollRepairs = 0, pollMismatch = 0;
    if (PROOF) for (const v of viewers) {
      if (v.stale) { await v.repair("poll"); pollRepairs++; }
      if (jsonDiffs(v.held.view, await v.fetchView()).length) pollMismatch++;
    }

    // ---- report ----
    const okRows = rows.filter(r => r.ok), rejected = rows.length - okRows.length;
    const S = (pick: (r: Row) => number) => stat(okRows.map(pick));
    const web_ = S(r => r.webMs), ws_ = S(r => r.wsMs), post_ = S(r => r.postMs), sock_ = S(r => r.sockKB), http_ = S(r => r.httpKB), tot_ = S(r => r.sockKB + r.httpKB), wal_ = S(r => r.walKB);
    const line = (name: string, s: ReturnType<typeof stat>, unit: string) => `  ${name.padEnd(22)} mean ${f(s.mean).padStart(8)}  p50 ${f(s.p50).padStart(8)}  p95 ${f(s.p95).padStart(8)}  max ${f(s.max).padStart(8)} ${unit}`;
    console.log(`\n=== measure-delta summary ===`);
    console.log(`code ${gitSha} | mode ${PATCH ? "patch sockets" : "full snapshots"}${PROOF ? " + proof" : ""}${DROP_EVERY ? ` + drop every ${DROP_EVERY}` : ""} | applier ${applier}`);
    console.log(`host ${cpus()[0].model.trim()} x${cores} | node ${process.version} | pin ${pin ? "web cpu3, ws cpu2" : "off"} | load avg start ${loadStart} end ${loadEnd}`);
    console.log(`measured ${okRows.length} actions (${rejected} rejected) in ${f(wallS, 1)} s | idle subtracted: web ${f(idleRate.web * 1000, 1)} ms/s, ws ${f(idleRate.ws * 1000, 1)} ms/s`);
    console.log(line("web CPU ms/action", web_, "ms")); console.log(line("ws CPU ms/action", ws_, "ms"));
    console.log(line("web+ws CPU ms/action", stat(okRows.map(r => r.webMs + r.wsMs)), "ms"));
    console.log(line("POST wall", post_, "ms"));
    console.log(line("KB sent (sock+http)", tot_, "KB")); console.log(line("  socket events", sock_, "KB")); console.log(line("  POST answer", http_, "KB"));
    console.log(line("WAL growth", wal_, "KB"));
    console.log(`  disk writes (web+ws, /proc io write_bytes): ${f(ioBytes / okRows.length / 1024, 1)} KB/action`);
    const events = viewers.map(v => `${v.name} patch ${v.events.patch} private ${v.events.private} changed ${v.events.changed} bytes patch ${f(v.patchBytes / 1024, 0)} KB full ${f(v.fullBytes / 1024, 0)} KB`);
    console.log("  events per client:\n    " + events.join("\n    "));
    const perThread = [...threadTotals.entries()].map(([k, ns]) => [k, ns / 1e6 / okRows.length] as const).filter(([, ms]) => ms > 0.02).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log("  CPU per thread (ms/action before idle subtraction; main thread has tid = pid):\n    " + perThread.map(([k, ms]) => `${k}: ${f(ms)}`).join("\n    "));
    if (PROOF) {
      const dropped = viewers.reduce((t, v) => t + v.drops, 0), gaps = viewers.reduce((t, v) => t + v.gaps, 0), repairs = viewers.reduce((t, v) => t + v.repairs, 0), bads = viewers.reduce((t, v) => t + v.bads, 0);
      console.log(`\n=== proof ===`);
      console.log(`compared ${mismatch.compared} client views to a GET (${mismatch.staleSkipped} skipped as stale after a drop): ${mismatch.count} mismatches in ${mismatch.actionsWithMismatch} actions`);
      for (const [k, n] of [...mismatch.paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${n}x ${k}`);
      for (const s of mismatch.samples) console.log("  e.g. " + s);
      console.log(`dropped ${dropped} messages | gaps seen ${gaps} | bad patches ${bads} | repair GETs ${repairs} (final poll repairs ${pollRepairs}) | mismatch after final poll ${pollMismatch}`);
      console.log(`hidden facts (public card made hidden; seat 1 and spectator): ${leaks.scenarios.length} checks, ${leaks.failures} leaks`);
      for (const s of leaks.scenarios) console.log(`  ${s.status.padEnd(8)} ${s.observer.padEnd(6)} ${s.step}${s.leaked.length ? "  leaked " + JSON.stringify(s.leaked) : ""}`);
      const dropOk = !DROP_EVERY || (dropped > 0 && pollMismatch === 0 && mismatch.count === 0);
      const leakOk = leaks.scenarios.length > 0 && leaks.failures === 0 && leaks.scenarios.some(s => s.conclusive);
      if (mismatch.count || pollMismatch || bads || !dropOk || !leakOk) failed = true;
      console.log(`PROOF ${failed ? "FAILED" : "PASSED"}${leakOk ? "" : " (leak scan: no conclusive check)"}`);
    }
    const csv = opt("--csv");
    if (csv) {
      writeFileSync(csv, "n,type,seq,web_ms,ws_ms,post_ms,sock_kb,http_kb,wal_kb,ok\n" + rows.map(r => [r.n, r.type, r.seq, f(r.webMs, 3), f(r.wsMs, 3), f(r.postMs, 2), f(r.sockKB, 2), f(r.httpKB, 2), f(r.walKB, 2), r.ok].join(",")).join("\n") + "\n");
      console.log(`per-action rows: ${csv}`);
    }
    void frames0;
    for (const v of viewers) v.sock.disconnect();
  } finally {
    killAll();
    await sleep(1500);
    for (const k of kids) if (k.pid && k.exitCode === null) { try { process.kill(k.pid, "SIGKILL"); } catch { /* gone */ } }
    if (!flag("--keep")) rmSync(out, { recursive: true, force: true }); else console.log("kept " + out);
  }
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); killAll(); process.exitCode = 1; });
