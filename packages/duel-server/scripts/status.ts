/**
 * One table for the state of all multi-player work: C++ core gates, lock slots, patch series, core builds,
 * differential, fuzz, scenarios, Playwright, running jobs.
 *
 *   npx tsx packages/duel-server/scripts/status.ts [--watch] [--json]
 *
 * Writes <repo>/.status/STATUS.md and <repo>/.status/index.html (plain HTML, meta refresh 10 s, file:// links, no server)
 * on every refresh. --watch refreshes every 10 s and appends one JSON line per state change to <repo>/.status/events.jsonl
 * ({ts, kind, key, from, to, detail}). --json prints the model as JSON.
 * The data comes from files the runners leave (see scripts/lib/status-model.ts) and from `ps`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { freemem, loadavg, totalmem } from "node:os";
import { join, resolve } from "node:path";
import {
  GATE_LOGS,
  type AgentInfo,
  type CensusSite,
  type E2eMultiEntry,
  type FuzzNSummary,
  type StuckState,
  type DifferentialSummary,
  type FailureSummary,
  type FuzzSummary,
  type GateInfo,
  type GateProvenance,
  type NduelSummary,
  type PlaywrightJson,
  type Snapshot,
  type StatusEvent,
  type Row,
  type Section,
  type VitestJson,
  agentRows,
  compareMbox,
  censusDelta,
  coreTaskRow,
  e2eMultiRow,
  emptyStuckState,
  etimeToMs,
  fuzzNRow,
  issueRows,
  manualRow,
  nextLowCpu,
  nextTrees,
  orphanedVitestWorkers,
  parsePsAll,
  stuckRows,
  differentialModeRows,
  differentialRow,
  diffSnapshots,
  e2eRow,
  failureEvidenceRow,
  findOverlaps,
  fuzzRow,
  gate4bEta,
  gateStaleReason,
  gatesFromLogs,
  newestRead,
  nduelRow,
  ownerRow,
  parseAgents,
  parseHistory,
  parseOwner,
  parsePs,
  parsePsStats,
  parseWait,
  provenanceText,
  queueRows,
  readJson,
  renderHtml,
  renderSections,
  scenariosRow,
  secondsPerSeed,
  seedsFromDetail,
  snapshotOfSections,
  subtreeStats,
  sumNumstat,
  summarizeGates,
  formatAge,
} from "./lib/status-model.js";

const PKG = resolve(import.meta.dirname, "..");
const REPO = resolve(PKG, "../..");
const P1 = join(PKG, "domain-core/.build/phase1");
const STATUS_DIR = join(REPO, ".status");
const PKG_STATUS_DIR = join(PKG, ".status");
const HARNESS_DIR = join(PKG, "domain-core/.build/harness");

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};
const mtimeOf = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};
const listDir = (path: string): string[] => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const etimeMs = etimeToMs;

function psText(): string {
  try {
    return execFileSync("ps", ["-eo", "pid=,ppid=,etime=,args="], { encoding: "utf8", maxBuffer: 16 << 20 });
  } catch {
    return "";
  }
}

function psStatsText(): string {
  try {
    return execFileSync("ps", ["-eo", "pid=,ppid=,pcpu=,rss="], { encoding: "utf8", maxBuffer: 16 << 20 });
  } catch {
    return "";
  }
}

interface GateResultFile extends GateProvenance {
  tag: string;
  patch: string;
  startedAt?: string;
  updatedAt: string;
  status: "running" | "pass" | "fail";
  gates: (GateInfo & { startedAt?: string | null; durationS?: number | null })[];
  firstFailingSeed: number | null;
}

/** First line of harness/FROZEN-ID (the id), or null. */
const harnessId = (): string | null => readText(join(HARNESS_DIR, "FROZEN-ID"))?.split("\n")[0]?.trim() || null;

/** Median seconds per seed over the gate 4b runs that passed, from every gate-result.json. */
function pastSecondsPerSeed(): number | null {
  const samples: { durationS: number | null; seeds: number | null }[] = [];
  for (const tag of listDir(P1)) {
    const r = readJson<GateResultFile>(readText(join(P1, tag, "gate-result.json"))).data;
    const g = r?.gates.find((x) => x.name === "diffn" && x.status === "pass");
    if (r && g) samples.push({ durationS: g.durationS ?? null, seeds: r.seeds ?? seedsFromDetail(g.detail) });
  }
  return secondsPerSeed(samples);
}

function phase1Rows(now: number, jobs: ReturnType<typeof parsePs>): Row[] {
  const rows: Row[] = [];
  const curHarness = harnessId();
  const spp = pastSecondsPerSeed();
  for (const tag of listDir(P1).sort()) {
    const dir = join(P1, tag);
    if (tag === "locks" || !statSync(dir).isDirectory()) continue;
    const logNames = GATE_LOGS.map((n) => ({ n, path: join(dir, `gate-${n}.log`) })).filter((l) => existsSync(l.path));
    const hasOut = existsSync(join(dir, "out"));
    const resultPath = join(dir, "gate-result.json");
    if (!hasOut && logNames.length === 0 && !existsSync(resultPath)) continue;
    const patch = listDir(join(dir, "out")).find((f) => f.endsWith(".patch")) ?? "(no patch)";
    const patchPath = join(dir, "out", patch);
    const curPatchSha = patch === "(no patch)" ? null : sha256(readFileSync(patchPath));
    const next = `bash packages/duel-server/domain-core/.build/phase1/gate.sh ${tag}`;
    const links = [
      ...(existsSync(resultPath) ? [{ label: "gate-result.json", path: resultPath }] : []),
      ...logNames.map((l) => ({ label: `gate-${l.n}.log`, path: l.path })),
      ...listDir(join(dir, "failures")).sort().slice(0, 8).map((f) => ({ label: `failure ${f}`, path: join(dir, "failures", f) })),
    ];
    const result = readJson<GateResultFile>(readText(resultPath));
    const gateJob = jobs.find((j) => j.kind === "gate" && new RegExp(`gate\\.sh\\s+${tag}(\\s|$)`).test(j.command));
    const gateAlive = gateJob !== undefined;
    if (result.ok && result.data) {
      const r = result.data;
      const age = now - Date.parse(r.updatedAt);
      const { state, reason } = summarizeGates(r.gates);
      const seed = r.firstFailingSeed != null ? ` (first seed ${r.firstFailingSeed})` : "";
      const item = tag;
      if (r.status === "running" && !gateAlive) rows.push({ item, state: "STALE", ageMs: age, reason: `gate.sh is not running; last: ${reason}`, next, links });
      else if (r.status === "running") {
        const g4b = r.gates.find((g) => g.name === "diffn" && g.status === "running");
        let eta = "";
        if (g4b?.startedAt) {
          const seeds = r.seeds ?? Number(/gate\.sh\s+\S+\s+(\d+)/.exec(gateJob?.command ?? "")?.[1] ?? 100);
          const left = gate4bEta(spp, seeds, (now - Date.parse(g4b.startedAt)) / 1000);
          eta = left === null ? "; ETA unknown (no past run)" : `; ETA ${formatAge(left * 1000)} (${spp?.toFixed(1)} s/seed, ${seeds} seeds)`;
        }
        rows.push({ item, state: "RUNNING", ageMs: age, reason: `${reason}${eta}`, links });
      } else if (r.status === "pass") {
        const stale = gateStaleReason(r, { patchSha256: curPatchSha, harnessId: curHarness });
        if (stale) rows.push({ item, state: "STALE", ageMs: age, reason: `PASS is STALE: ${stale}`, next, links });
        else rows.push({ item, state: "PASS", ageMs: age, reason: `${reason} [${provenanceText(r)}]`, links });
      } else rows.push({ item, state: "FAIL", ageMs: age, reason: `${reason}${seed}`, next, links });
      continue;
    }
    const files = logNames.map(({ n, path }) => ({ name: n, text: readText(path) ?? "", mtimeMs: mtimeOf(path) ?? 0 }));
    const newest = Math.max(0, ...files.map((f) => f.mtimeMs), mtimeOf(join(dir, "out")) ?? 0);
    if (files.length === 0) {
      rows.push({ item: tag, state: "IDLE", ageMs: newest ? now - newest : null, reason: "patch written, gate not run", next, links });
      continue;
    }
    const { gates, firstFailingSeed } = gatesFromLogs(files, now, 90_000, gateAlive);
    const summary = summarizeGates(gates);
    const state = gateAlive && summary.state === "IDLE" ? "RUNNING" : summary.state;
    const reason = summary.reason;
    const seed = firstFailingSeed != null ? ` (first seed ${firstFailingSeed})` : "";
    rows.push({ item: tag, state, ageMs: now - newest, reason: `${reason}${state === "FAIL" ? seed : ""} [from logs]`, next: state === "PASS" || state === "RUNNING" ? undefined : next, links });
  }
  return rows;
}

function lockRows(now: number): Row[] {
  const dir = join(P1, "locks");
  return listDir(dir)
    .filter((f) => f.endsWith(".owner"))
    .sort()
    .flatMap((f) => {
      const owner = parseOwner(readText(join(dir, f)) ?? "");
      return owner ? [ownerRow(owner, now, isAlive)] : [];
    });
}

function queueSectionRows(now: number): Row[] {
  const dir = join(P1, "locks");
  const waits = listDir(dir)
    .filter((f) => /\.wait\.\d+$/.test(f))
    .flatMap((f) => {
      const w = parseWait(readText(join(dir, f)) ?? "");
      return w ? [w] : [];
    });
  return queueRows(waits, now, isAlive);
}

function patchSection(): Section {
  const dir = join(PKG, "domain-core/patches");
  const names = listDir(dir).filter((f) => f.endsWith(".patch")).sort();
  const hash = createHash("sha256");
  for (const n of names) hash.update(readFileSync(join(dir, n)));
  const newest = Math.max(0, ...names.map((n) => mtimeOf(join(dir, n)) ?? 0));
  const now = Date.now();
  return {
    title: "Patch series (domain-core/patches)",
    notes: names.length ? [names.join("  ")] : [],
    rows: [
      names.length
        ? { item: `${names.length} patches`, state: "PASS", ageMs: now - newest, reason: `sha256 of the concatenation: ${hash.digest("hex").slice(0, 16)}` }
        : { item: "patches", state: "MISSING", ageMs: null, reason: "no .patch files" },
    ],
  };
}

function buildRows(now: number): Row[] {
  const dist = join(PKG, "domain-core/dist");
  return listDir(dist)
    .filter((f) => f.endsWith(".wasm"))
    .sort()
    .map((f) => {
      const path = join(dist, f);
      const st = statSync(path);
      const info = readJson<Record<string, unknown>>(readText(join(dist, `${f.replace(/\.sync\.wasm$/, "")}-build-info.json`)));
      const i = info.data;
      const infoText = i
        ? `head ${String(i.head ?? "?").slice(0, 8)}, patches ${i.patches ?? "?"}, seed ${i.luaFixedSeed ?? "?"}, emcc ${i.emscripten ?? "?"}`
        : "no build-info";
      return { item: f.replace(/\.sync\.wasm$/, ""), state: "PASS" as const, ageMs: now - st.mtimeMs, reason: `${(st.size / 1e6).toFixed(1)} MB, sha ${sha256(readFileSync(path)).slice(0, 10)}, ${infoText}` };
    });
}

function findFiles(dir: string, name: string, depth = 6): string[] {
  if (depth < 0) return [];
  const out: string[] = [];
  for (const entry of listDir(dir)) {
    const path = join(dir, entry);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...findFiles(path, name, depth - 1));
    else if (entry === name) out.push(path);
  }
  return out;
}

function summaryRows(now: number): Row[] {
  const s = (name: string) => join(STATUS_DIR, name);
  const history = parseHistory(readText(s("differential-history.tsv")));
  const diffRows = history.length ? differentialModeRows(history, now) : [differentialRow(readJson<DifferentialSummary>(readText(s("differential-summary.json"))), now)];
  const failDir = join(PKG, "tests/differential/failures");
  const failFiles = listDir(failDir).sort();
  for (const r of diffRows) if (r.state === "FAIL") r.links = failFiles.slice(0, 8).map((f) => ({ label: `failure ${f}`, path: join(failDir, f) }));
  const nduel = newestRead([PKG_STATUS_DIR, STATUS_DIR].map((d) => ({ read: readJson<NduelSummary>(readText(join(d, "nduel-summary.json"))), mtimeMs: mtimeOf(join(d, "nduel-summary.json")) })));
  const rows: Row[] = [
    ...diffRows,
    nduelRow(nduel.read, nduel.mtimeMs, now),
    fuzzRow(readJson<FuzzSummary>(readText(s("fuzz-summary.json"))), now),
    scenariosRow(readJson<VitestJson>(readText(s("scenarios.json"))), mtimeOf(s("scenarios.json")), now),
    e2eRow(readJson<PlaywrightJson>(readText(s("e2e-results.json"))), mtimeOf(s("e2e-results.json")), now),
  ];
  for (const path of findFiles(join(REPO, "packages/e2e/test-results"), "failure-summary.json")) {
    if (!path.includes("evidence")) continue;
    rows.push(failureEvidenceRow(path.replace(`${REPO}/`, ""), readJson<FailureSummary>(readText(path)), mtimeOf(path) ?? now, now));
  }
  return rows;
}

function machineSection(jobs: ReturnType<typeof parsePs>): Section {
  const load = loadavg().map((n) => n.toFixed(1)).join(" ");
  const stats = parsePsStats(psStatsText());
  const rows: Row[] = jobs.map((j) => {
    const t = subtreeStats(stats, j.pid);
    return { item: `${j.kind} ${j.pid}`, state: "RUNNING" as const, ageMs: etimeMs(j.elapsed), reason: `cpu ${t.pcpu.toFixed(0)}%, rss ${(t.rssKb / 1024).toFixed(0)} MB, ${t.procs} procs: ${j.command}` };
  });
  return {
    title: "Running jobs and machine",
    notes: [`load ${load} (8 cores), free ${(freemem() / 2 ** 30).toFixed(1)} of ${(totalmem() / 2 ** 30).toFixed(1)} GiB`],
    rows,
  };
}

/** Newest mtime of a file, or of everything under a directory (skips node_modules, .git, test-results; at most 3000 entries). */
function newestMtime(path: string): number {
  let budget = 3000;
  const walk = (p: string, depth: number): number => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return 0;
    }
    if (!st.isDirectory() || depth < 0) return st.mtimeMs;
    let newest = 0;
    for (const e of listDir(p)) {
      if (budget-- <= 0) break;
      if (e === "node_modules" || e === ".git" || e === "test-results") continue;
      newest = Math.max(newest, walk(join(p, e), depth - 1));
    }
    return newest;
  };
  return walk(path, 5);
}

const git = (args: string[]): string => {
  try {
    return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const EXAMPLE_AGENTS = [
  { name: "EXAMPLE-agent-1", brief: "EXAMPLE entry: the lead replaces this file", files: ["packages/duel-server/scripts/status.ts"] },
  { name: "EXAMPLE-agent-2", brief: "EXAMPLE entry: the lead replaces this file", files: ["packages/duel-server/scripts/lib/status-model.ts", "packages/duel-server/scripts/status.ts"] },
];

function agentSection(now: number): Section {
  const path = join(STATUS_DIR, "agents.json");
  let text = readText(path);
  let example = false;
  if (text === null) {
    try {
      mkdirSync(STATUS_DIR, { recursive: true });
      writeFileSync(path, `${JSON.stringify(EXAMPLE_AGENTS, null, 2)}\n`, { flag: "wx" });
    } catch {
      // Another run made it first, or the dir is read-only.
    }
    text = readText(path) ?? JSON.stringify(EXAMPLE_AGENTS);
  }
  const agents = parseAgents(text);
  if (!agents) return { title: "Agents (.status/agents.json)", rows: [{ item: "agents.json", state: "FAIL", ageMs: null, reason: "not a JSON array of {name, brief, files}" }] };
  example = agents.length > 0 && agents.every((a) => a.name.startsWith("EXAMPLE-"));
  const infos: AgentInfo[] = agents.map((agent) => ({
    agent,
    newestMtimeMs: Math.max(0, ...agent.files.map((f) => newestMtime(join(REPO, f)))) || null,
    numstat: agent.files.length ? sumNumstat(git(["diff", "--numstat", "--", ...agent.files])) : { added: 0, removed: 0, files: 0 },
  }));
  return {
    title: "Agents (.status/agents.json)",
    notes: example ? ["EXAMPLE data: .status/agents.json was created by status.ts. The lead writes the real list: [{name, brief, files: string[]}]."] : [],
    rows: agentRows(infos, findOverlaps(agents), now, false),
  };
}

const B2_SHA = "4d93d08";

/** Phase 1 folders (the old duelist-helper split and the base). They are not phase 2 core tasks. */
const NOT_CORE_TASKS = new Set(["B2", "locks", "MERGED", "SWEEP", "CE", "FD", "H", "LC", "LD", "OP", "P1", "P1B", "P2", "P2M", "P3", "T0"]);

/** Core task tags: the phase1 folders that have a dev tree and an out/ dir or a gate result, apart from the phase 1 ones. */
function coreTags(): string[] {
  return listDir(P1)
    .filter((t) => !NOT_CORE_TASKS.has(t) && existsSync(join(P1, t, "dev")) && (existsSync(join(P1, t, "out")) || existsSync(join(P1, t, "gate-result.json"))))
    .sort();
}

const gitIn = (dir: string, args: string[]): string | null => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

const mboxOf = (tag: string): string | null => {
  const dir = join(P1, tag, "out");
  const name = listDir(dir).find((f) => f.endsWith(".patch"));
  return name ? join(dir, name) : null;
};

function coreTaskSection(now: number): Section {
  const baseMbox = mboxOf("B2");
  const baseText = baseMbox ? readText(baseMbox) : null;
  const baseCensus = readJson<{ census?: CensusSite[] }>(readText(join(STATUS_DIR, "nduel-census-B2.json"))).data?.census ?? null;
  const curHarness = harnessId();
  const expected = gitIn(join(P1, "B2", "dev"), ["rev-parse", "HEAD"])?.trim() || B2_SHA;
  const rows = coreTags().map((tag) => {
    const dir = join(P1, tag);
    const mbox = mboxOf(tag);
    const mboxText = mbox ? readText(mbox) : null;
    const gate = readJson<GateResultFile>(readText(join(dir, "gate-result.json"))).data;
    const parent = gitIn(join(dir, "dev"), ["rev-list", "--parents", "-n", "1", "HEAD"])?.trim().split(" ")[1] ?? null;
    const censusPath = join(dir, "nduel-census.json");
    const taskCensus = readJson<{ census?: CensusSite[] }>(readText(censusPath)).data?.census;
    const census = taskCensus && baseCensus ? censusDelta(baseCensus, taskCensus) : existsSync(censusPath) ? "census: unreadable" : null;
    const row = coreTaskRow(
      {
        tag,
        patch: mbox ? mbox.split("/").pop() ?? null : null,
        parent,
        expectedParent: expected,
        mbox: baseText !== null && mboxText !== null ? compareMbox(baseText, mboxText) : null,
        gate: { status: gate?.status ?? null, harnessId: gate?.harnessId ?? null, updatedAt: gate?.updatedAt ?? null, detail: gate ? summarizeGates(gate.gates).reason : "" },
        currentHarness: curHarness,
        nduel: readJson<NduelSummary>(readText(join(dir, "nduel-summary.json"))),
        hasUnchanged: existsSync(join(dir, "unchanged-sites.md")),
        hasCheck: existsSync(join(dir, "check")),
        census,
      },
      now,
    );
    row.links = [
      ...(mbox ? [{ label: "mbox", path: mbox }] : []),
      ...(existsSync(join(dir, "unchanged-sites.md")) ? [{ label: "unchanged-sites.md", path: join(dir, "unchanged-sites.md") }] : []),
    ];
    return row;
  });
  return { title: "Core tasks (vs B2 4d93d08)", notes: ["One row per task: parent is B2, mbox = B2 patches + 1, gate on the frozen harness, nduel per task, census delta."], rows };
}

const STUCK_STATE_PATH = join(STATUS_DIR, ".stuck-state.json");

function loadStuckState(): StuckState {
  const d = readJson<Partial<StuckState>>(readText(STUCK_STATE_PATH)).data;
  return { lowSince: d?.lowSince ?? {}, trees: d?.trees ?? {} };
}

/** Stuck signals. Reads the state of the last --watch run; a one-shot run does not save state. */
function stuckSection(now: number, save: boolean): Section {
  const prev = loadStuckState();
  const allPs = parsePsAll(psText());
  const stats = parsePsStats(psStatsText());
  const owners = listDir(join(P1, "locks"))
    .filter((f) => f.endsWith(".owner"))
    .flatMap((f) => {
      const o = parseOwner(readText(join(P1, "locks", f)) ?? "");
      return o && isAlive(o.pid) ? [{ key: `${o.name}.${o.slot}`, tag: o.tag ?? "", pid: o.pid, command: o.command }] : [];
    });
  const locks = owners.map((o) => ({ key: o.key, tag: o.tag, pcpu: subtreeStats(stats, o.pid).pcpu, command: o.command }));
  const tags = coreTags();
  const gateFails: { tag: string; updatedMs: number; mboxMtimeMs: number | null }[] = [];
  const open: { tag: string; jobRuns: boolean }[] = [];
  const sigs: Record<string, string> = {};
  const curHarness = harnessId();
  for (const tag of tags) {
    const dir = join(P1, tag);
    const gate = readJson<GateResultFile>(readText(join(dir, "gate-result.json"))).data;
    const mbox = mboxOf(tag);
    if (gate?.status === "fail") gateFails.push({ tag, updatedMs: Date.parse(gate.updatedAt), mboxMtimeMs: mbox ? mtimeOf(mbox) : null });
    const done = gate?.status === "pass" && gate.harnessId === curHarness;
    const head = gitIn(join(dir, "dev"), ["rev-parse", "HEAD"])?.trim();
    const diff = gitIn(join(dir, "dev"), ["diff", "HEAD"]);
    const status = gitIn(join(dir, "dev"), ["status", "--porcelain"]);
    if (head && diff !== null && !done) {
      sigs[tag] = `${head} ${createHash("sha256").update(diff).update(status ?? "").digest("hex")}`;
      const word = new RegExp(`(phase1/${tag}/|gate\\.sh\\s+${tag}(\\s|$))`);
      open.push({ tag, jobRuns: allPs.some((j) => word.test(j.args) && !/scripts\/status\.ts/.test(j.args)) || owners.some((o) => o.tag === tag) || listDir(join(P1, "locks")).some((f) => /\.wait\.\d+$/.test(f) && (parseWait(readText(join(P1, "locks", f)) ?? "")?.tag ?? "") === tag) });
    }
  }
  const waits = listDir(join(P1, "locks"))
    .filter((f) => /\.wait\.\d+$/.test(f))
    .flatMap((f) => {
      const w = parseWait(readText(join(P1, "locks", f)) ?? "");
      return w && isAlive(w.pid) ? [w] : [];
    });
  const next: StuckState = { lowSince: nextLowCpu(prev.lowSince, locks, now), trees: nextTrees(prev.trees, sigs, now) };
  const rows = stuckRows({ nowMs: now, state: { lowSince: next.lowSince, trees: next.trees }, locks, gateFails, trees: open, waits, orphans: orphanedVitestWorkers(allPs) });
  if (save) {
    try {
      writeFileSync(`${STUCK_STATE_PATH}.tmp`, JSON.stringify(next));
      renameSync(`${STUCK_STATE_PATH}.tmp`, STUCK_STATE_PATH);
    } catch {
      // .status/ is not writable.
    }
  }
  const seen = Object.keys(prev.lowSince).length + Object.keys(prev.trees).length;
  return {
    title: "Stuck signals",
    notes: seen === 0 && !save ? ["CPU and dev-tree signals need the state of a --watch run (.status/.stuck-state.json). Queue, gate FAIL and orphan signals work in one run."] : [],
    rows: rows.length ? rows : [{ item: "stuck", state: "PASS", ageMs: null, reason: "nothing looks stuck" }],
  };
}

/** Newest file of a directory whose name ends with .json (mtime decides), or null. */
function newestJson(dir: string): { path: string; mtimeMs: number } | null {
  const list = listDir(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ path: join(dir, f), mtimeMs: mtimeOf(join(dir, f)) ?? 0 }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return list[0] ?? null;
}

function phase2ResultSection(now: number): Section {
  const fz = newestJson(join(STATUS_DIR, "fuzz-n"));
  const e2ePath = join(STATUS_DIR, "e2e-multi", "latest.json");
  const manualDir = join(STATUS_DIR, "manual");
  const manual = listDir(manualDir).map((name) => ({ name, mtimeMs: mtimeOf(join(manualDir, name)) ?? 0 }));
  return {
    title: "Phase 2 results (fuzz-n, e2e-multi, manual)",
    rows: [
      fuzzNRow(fz ? readJson<FuzzNSummary>(readText(fz.path)) : { ok: false, data: null, error: "missing" }, fz?.mtimeMs ?? null, now),
      e2eMultiRow(readJson<E2eMultiEntry[]>(readText(e2ePath)), mtimeOf(e2ePath), now),
      manualRow(manual, now),
    ],
  };
}

function issueSection(now: number): Section {
  const dir = join(STATUS_DIR, "issues");
  const files = listDir(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, text: readText(join(dir, name)) ?? "" }));
  return { title: "Issue inbox (.status/issues)", rows: issueRows(files, now) };
}

export function collect(save = false): { time: string; sections: Section[] } {
  const now = Date.now();
  const jobs = parsePs(psText(), process.pid);
  const sections: Section[] = [
    { title: "Phase 1 core agents (gate results)", rows: phase1Rows(now, jobs) },
    coreTaskSection(now),
    stuckSection(now, save),
    { title: "Lock slots and queue", rows: [...lockRows(now), ...queueSectionRows(now)] },
    patchSection(),
    { title: "Core builds (domain-core/dist)", rows: buildRows(now) },
    { title: "Latest summaries", rows: summaryRows(now) },
    phase2ResultSection(now),
    issueSection(now),
    machineSection(jobs),
    agentSection(now),
  ];
  return { time: new Date(now).toISOString(), sections };
}

const EVENTS_PATH = join(STATUS_DIR, "events.jsonl");
const STATE_PATH = join(STATUS_DIR, ".events-state.json");

/** The failure files that exist now, as snapshot entries (a new file is an event). */
function failureSnapshot(): Snapshot {
  const snap: Snapshot = {};
  const dirs = [join(PKG, "tests/differential/failures"), ...listDir(P1).map((t) => join(P1, t, "failures"))];
  for (const d of dirs) for (const f of listDir(d)) snap[`failure:${join(d, f).replace(`${REPO}/`, "")}`] = { value: "present", detail: join(d, f) };
  return snap;
}

function recentEvents(limit = 60): StatusEvent[] {
  const text = readText(EVENTS_PATH) ?? "";
  return text.split("\n").filter(Boolean).slice(-limit).flatMap((l) => {
    try {
      return [JSON.parse(l) as StatusEvent];
    } catch {
      return [];
    }
  });
}

/** Compares with the state saved by the last run, appends the events, saves the new state. */
function recordEvents(model: { time: string; sections: Section[] }): void {
  const cur: Snapshot = { ...snapshotOfSections(model.sections), ...failureSnapshot() };
  const prev = readJson<Snapshot>(readText(STATE_PATH)).data;
  const events = diffSnapshots(prev, cur, model.time);
  if (events.length) appendFileSync(EVENTS_PATH, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  writeFileSync(`${STATE_PATH}.tmp`, JSON.stringify(cur));
  renameSync(`${STATE_PATH}.tmp`, STATE_PATH);
}

function render(watch: boolean): string {
  const model = collect(watch);
  if (process.argv.includes("--json")) return JSON.stringify(model, null, 2);
  const text = `status ${model.time}\n\n${renderSections(model.sections)}`;
  try {
    mkdirSync(STATUS_DIR, { recursive: true });
    writeFileSync(join(STATUS_DIR, "STATUS.md"), `# Multi-player status\n\n\`\`\`text\n${text}\`\`\`\n`);
    if (watch) recordEvents(model);
    writeFileSync(join(STATUS_DIR, "index.html"), renderHtml(model, recentEvents()));
  } catch {
    // The table still prints when .status/ is not writable.
  }
  return text;
}

if (process.argv.includes("--watch")) {
  const tick = () => {
    process.stdout.write(`\u001b[2J\u001b[H${render(true)}\n(refresh every 10 s, Ctrl-C to stop)\n`);
  };
  tick();
  setInterval(tick, 10_000);
} else {
  console.log(render(false));
}
