/** Pure helpers for scripts/status.ts: log parsing, owner staleness, summary reading, table layout. No I/O here. */

/** SKIPPED: a test run where nothing passed and some tests were skipped. It is never PASS. */
export type State = "PASS" | "FAIL" | "RUNNING" | "MISSING" | "STALE" | "IDLE" | "SKIPPED";

/** Pipe, cell and text escaping for the HTML page. */
export const escapeHtml = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Row {
  item: string;
  state: State;
  /** Age in ms of the newest evidence, or null. */
  ageMs: number | null;
  reason: string;
  next?: string;
  /** Files to link from the HTML page (absolute paths). */
  links?: { label: string; path: string }[];
}

export interface Section {
  title: string;
  rows: Row[];
  notes?: string[];
}

export function formatAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "-";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function clip(text: string, width: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= width ? one : `${one.slice(0, Math.max(0, width - 1))}~`;
}

// ---- gate logs

export interface VitestLogResult {
  state: "pass" | "fail" | "unknown";
  tests: string | null;
  firstFailingSeed: number | null;
}

/** "Tests  3 passed (3)" is a pass. Any "failed" in the Tests line, or "DIFF seed N", is a fail. */
export function parseVitestLog(text: string): VitestLogResult {
  const clean = text.replace(/\u001b\[[0-9;]*m/g, "");
  const testsLine = clean.split("\n").filter((l) => /^\s*Tests\s/.test(l)).pop()?.trim() ?? null;
  const seed = /DIFF seed (\d+)/.exec(clean);
  const firstFailingSeed = seed ? Number(seed[1]) : null;
  if (testsLine && /\bfailed\b/.test(testsLine)) return { state: "fail", tests: testsLine, firstFailingSeed };
  if (firstFailingSeed !== null) return { state: "fail", tests: testsLine, firstFailingSeed };
  if (testsLine && /\bpassed\b/.test(testsLine)) return { state: "pass", tests: testsLine, firstFailingSeed };
  return { state: "unknown", tests: testsLine, firstFailingSeed };
}

export const GATE_LOGS = ["wasm", "native", "anchor", "diff6", "diffn"] as const;
export type GateLogName = (typeof GATE_LOGS)[number];

export interface GateLogFile {
  name: GateLogName;
  text: string;
  mtimeMs: number;
}

export interface GateInfo {
  name: string;
  status: "pending" | "running" | "pass" | "fail" | "skipped";
  detail: string;
}

/** A log that changed in the last `growingMs` is still growing. */
export function gatesFromLogs(files: GateLogFile[], nowMs: number, growingMs = 90_000, gateAlive = false): { gates: GateInfo[]; firstFailingSeed: number | null } {
  const byName = new Map(files.map((f) => [f.name, f]));
  const lastIndex = Math.max(-1, ...GATE_LOGS.map((n, i) => (byName.has(n) ? i : -1)));
  let firstFailingSeed: number | null = null;
  const gates: GateInfo[] = GATE_LOGS.map((name, i) => {
    const file = byName.get(name);
    if (!file) return { name, status: i < lastIndex ? "skipped" : "pending", detail: "" } as GateInfo;
    const lines = file.text.split("\n").filter((l) => l.trim());
    const tail = lines[lines.length - 1] ?? "";
    // A live gate.sh owns its last log. vitest writes its log at the end, so a quiet log is still running.
    const growing = nowMs - file.mtimeMs < growingMs || (gateAlive && i === lastIndex);
    if (name === "diff6" || name === "diffn") {
      const v = parseVitestLog(file.text);
      if (v.state === "fail") {
        firstFailingSeed ??= v.firstFailingSeed;
        return { name, status: "fail", detail: v.tests ?? tail };
      }
      if (v.state === "pass") return { name, status: "pass", detail: v.tests ?? "" };
      return { name, status: growing ? "running" : i < lastIndex ? "pass" : "fail", detail: growing ? tail : "log ended without a Tests line" };
    }
    if (i < lastIndex) return { name, status: "pass", detail: tail };
    if (growing) return { name, status: "running", detail: tail };
    const bad = /(^|\s)(error|fatal)\b|\bwarning:|FAILED|No such file/i.test(file.text);
    if (name === "native" && !/^smoke:/m.test(file.text)) return { name, status: bad ? "fail" : "fail", detail: tail || "no smoke line" };
    return { name, status: bad ? "fail" : "pass", detail: tail };
  });
  return { gates, firstFailingSeed };
}

export function summarizeGates(gates: GateInfo[]): { state: State; reason: string } {
  const failed = gates.find((g) => g.status === "fail");
  if (failed) return { state: "FAIL", reason: `${failed.name}: ${failed.detail}` };
  const running = gates.find((g) => g.status === "running");
  const done = gates.filter((g) => g.status === "pass").length;
  if (running) return { state: "RUNNING", reason: `gate ${running.name} (${done}/${gates.length} done) ${running.detail}` };
  if (done === gates.length) return { state: "PASS", reason: gates[gates.length - 1]?.detail ?? "" };
  if (done === 0) return { state: "IDLE", reason: "no gate has run" };
  return { state: "IDLE", reason: `${done}/${gates.length} gates done, none running` };
}

// ---- lock owners

export interface OwnerFile {
  name: string;
  slot: number;
  pid: number;
  tag?: string;
  start: string;
  command: string;
}

export function parseOwner(text: string): OwnerFile | null {
  try {
    const o = JSON.parse(text) as Partial<OwnerFile>;
    if (typeof o.name !== "string" || typeof o.pid !== "number" || typeof o.start !== "string") return null;
    return { name: o.name, slot: Number(o.slot ?? 0), pid: o.pid, tag: o.tag ?? "", start: o.start, command: String(o.command ?? "") };
  } catch {
    return null;
  }
}

export function ownerRow(owner: OwnerFile, nowMs: number, alive: (pid: number) => boolean): Row {
  const age = nowMs - Date.parse(owner.start);
  const item = `lock ${owner.name}.${owner.slot}`;
  const who = owner.tag ? `[${owner.tag}] ` : "";
  if (!alive(owner.pid)) {
    return { item, state: "STALE", ageMs: age, reason: `${who}pid ${owner.pid} is dead: ${owner.command}`, next: `rm locks/${owner.name}.${owner.slot}.owner` };
  }
  return { item, state: "RUNNING", ageMs: age, reason: `${who}pid ${owner.pid}: ${owner.command}` };
}

// ---- summaries

export interface SummaryRead<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

export function readJson<T = Record<string, unknown>>(text: string | null): SummaryRead<T> {
  if (text === null) return { ok: false, data: null, error: "missing" };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, data: null, error: `bad JSON: ${(e as Error).message}` };
  }
}

export interface DifferentialSummary {
  time?: string;
  mode?: string;
  reference?: { path?: string; sha256?: string };
  multi?: { path?: string; sha256?: string };
  baseSeed?: number;
  seeds?: number;
  onlySeeds?: number[] | null;
  maxSteps?: number;
  differences?: number;
  parseWarnings?: number;
  firstFailingSeed?: number | null;
  durationMs?: number;
}

export function differentialRow(read: SummaryRead<DifferentialSummary>, nowMs: number): Row {
  const item = "differential";
  const next = "bash domain-core/.build/phase1/run-locked.sh diff 3 npx vitest run tests/differential/differential.test.ts";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "no .status/differential-summary.json" : (read.error ?? ""), next };
  const d = read.data;
  const age = d.time ? nowMs - Date.parse(d.time) : null;
  const bad = (d.differences ?? 0) > 0 || (d.parseWarnings ?? 0) > 0;
  const multi = d.multi?.path ? `${d.multi.path.split("/").pop()} ${(d.multi.sha256 ?? "").slice(0, 8)}` : "no multi core";
  const seeds = d.onlySeeds?.length ? `${d.onlySeeds.length} fixed seeds` : `${d.seeds ?? "?"} seeds from ${d.baseSeed ?? "?"}`;
  const base = `${seeds}, ${d.differences ?? "?"} diffs, ${d.parseWarnings ?? 0} parse warnings, ${multi}`;
  const ran = d.onlySeeds?.length ?? d.seeds ?? 0;
  // No multi core means nothing was compared; 0 seeds means nothing ran. Neither is PASS.
  const state = bad ? "FAIL" : !d.multi?.path ? "SKIPPED" : noPassState(ran, 0);
  const reason = bad && d.firstFailingSeed != null ? `${base}, first seed ${d.firstFailingSeed}` : base;
  return { item, state, ageMs: age, reason: bad ? reason : noPassReason(state, base) };
}

export interface FuzzSummary {
  time?: string;
  runs?: number;
  failures?: number;
  knownFailures?: number;
  durationS?: number;
  firstFailingSeed?: number | null;
  wasm?: { path?: string; sha256?: string };
}

export function fuzzRow(read: SummaryRead<FuzzSummary>, nowMs: number): Row {
  const item = "fuzz";
  const next = "npx tsx packages/duel-server/scripts/fuzz-nightly.ts --duels 500";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "no .status/fuzz-summary.json" : (read.error ?? ""), next };
  const d = read.data;
  const age = d.time ? nowMs - Date.parse(d.time) : null;
  const fails = d.failures ?? 0;
  const base = `${d.runs ?? "?"} duels, ${fails} new failures (${d.knownFailures ?? 0} known), ${d.durationS ?? "?"}s`;
  const state = fails > 0 ? "FAIL" : noPassState(d.runs ?? 0, 0);
  return { item, state, ageMs: age, reason: fails > 0 ? `${base}, first seed ${d.firstFailingSeed ?? "?"}` : noPassReason(state, base), next: fails > 0 && d.firstFailingSeed != null ? `npx tsx packages/duel-server/scripts/fuzz-repro.ts --seed ${d.firstFailingSeed}` : undefined };
}

export interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  startTime?: number;
  success?: boolean;
  testResults?: { name?: string; assertionResults?: { status?: string; fullName?: string; title?: string }[] }[];
}

/**
 * State of a test run without failures. "0 passed, 30 skipped" is SKIPPED, never PASS; "0 passed, 0 skipped" means no
 * test ran at all, so it is MISSING. A run where something passed is PASS (the skipped count stays in the reason).
 */
export function noPassState(passed: number, skipped: number): "PASS" | "SKIPPED" | "MISSING" {
  if (passed > 0) return "PASS";
  return skipped > 0 ? "SKIPPED" : "MISSING";
}

function noPassReason(state: State, base: string): string {
  if (state === "SKIPPED") return `${base}; nothing ran (all skipped)`;
  if (state === "MISSING") return `${base}; no test ran`;
  return base;
}

export function scenariosRow(read: SummaryRead<VitestJson>, mtimeMs: number | null, nowMs: number): Row {
  const item = "scenarios";
  const next = "npm run test:scenarios:json --workspace=packages/duel-server";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "no .status/scenarios.json" : (read.error ?? ""), next };
  const d = read.data;
  const failed = d.numFailedTests ?? 0;
  const failedNames = (d.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).filter((a) => a.status === "failed").map((a) => a.fullName ?? a.title ?? "?"));
  const base = `${d.numPassedTests ?? 0}/${d.numTotalTests ?? 0} passed, ${failed} failed, ${d.numPendingTests ?? 0} skipped`;
  const bad = failed > 0 || d.success === false;
  const state = bad ? "FAIL" : noPassState(d.numPassedTests ?? 0, d.numPendingTests ?? 0);
  return { item, state, ageMs: mtimeMs === null ? null : nowMs - mtimeMs, reason: failedNames.length ? `${base}: ${failedNames.slice(0, 3).join("; ")}` : noPassReason(state, base), next: failed > 0 ? next : undefined };
}

interface PwSpec {
  title?: string;
  ok?: boolean;
  file?: string;
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PlaywrightJson {
  stats?: { startTime?: string; duration?: number; expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  suites?: PwSuite[];
}

export function playwrightFailures(data: PlaywrightJson): string[] {
  const out: string[] = [];
  const walk = (s: PwSuite, file: string | undefined) => {
    const f = s.file ?? file;
    for (const spec of s.specs ?? []) if (spec.ok === false) out.push(`${spec.file ?? f ?? "?"}: ${spec.title ?? "?"}`);
    for (const child of s.suites ?? []) walk(child, f);
  };
  for (const s of data.suites ?? []) walk(s, undefined);
  return out;
}

export function e2eRow(read: SummaryRead<PlaywrightJson>, mtimeMs: number | null, nowMs: number): Row {
  const item = "e2e (playwright)";
  const next = "npm run test:e2e --workspace=packages/e2e";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "no .status/e2e-results.json" : (read.error ?? ""), next };
  const st = read.data.stats ?? {};
  const failed = playwrightFailures(read.data);
  const bad = (st.unexpected ?? 0) > 0 || failed.length > 0;
  const base = `${st.expected ?? 0} passed, ${st.unexpected ?? 0} failed, ${st.flaky ?? 0} flaky, ${st.skipped ?? 0} skipped`;
  const started = st.startTime ? Date.parse(st.startTime) + (st.duration ?? 0) : mtimeMs;
  const state = bad ? "FAIL" : noPassState(st.expected ?? 0, st.skipped ?? 0);
  return { item, state, ageMs: started === null || started === undefined ? null : nowMs - started, reason: failed.length ? `${base}: ${failed.slice(0, 2).join("; ")}` : noPassReason(state, base), next: bad ? next : undefined };
}

export interface FailureSummary {
  test?: { title?: string; file?: string; status?: string; errors?: string[] };
}

export function failureEvidenceRow(path: string, read: SummaryRead<FailureSummary>, mtimeMs: number, nowMs: number): Row {
  const t = read.data?.test;
  const err = t?.errors?.[0]?.split("\n")[0] ?? read.error ?? "";
  return { item: "e2e failure", state: "FAIL", ageMs: nowMs - mtimeMs, reason: `${t?.title ?? "?"} (${t?.status ?? "?"}): ${err}`, next: `ls ${path.replace(/failure-summary\.json$/, "")}` };
}

// ---- ps

export interface PsJob {
  pid: number;
  ppid: number;
  elapsed: string;
  kind: string;
  command: string;
}

const JOB_PATTERNS: [string, RegExp][] = [
  ["gate", /gate\.sh\s+\S+/],
  ["vitest", /\bvitest\b/],
  ["playwright", /\bplaywright\b/],
  ["docker build", /docker run .*emsdk|emscripten\/emsdk/],
  ["native build", /\b(clang\+\+|build-native-core\.sh)\b/],
];

/**
 * Parses `ps -eo pid=,ppid=,etime=,args=` lines. Skips this script, the `ps` call, the shell wrappers of the tool
 * (`bash -c source ...`) and a process whose parent is a job of the same kind (keeps the outermost command of a chain).
 */
export function parsePs(text: string, selfPid: number): PsJob[] {
  const all: PsJob[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[4] ?? "";
    if (pid === selfPid || /scripts\/status\.ts|\bps -eo\b|\bgrep\b|^\S*(bash|sh) -c\b/.test(command)) continue;
    const hit = JOB_PATTERNS.find(([, re]) => re.test(command));
    if (!hit) continue;
    all.push({ pid, ppid: Number(m[2]), elapsed: m[3] ?? "", kind: hit[0], command });
  }
  const kindOf = new Map(all.map((j) => [j.pid, j.kind]));
  return all.filter((j) => kindOf.get(j.ppid) !== j.kind);
}

// ---- table

export const STATE_TAG: Record<State, string> = { PASS: "PASS", FAIL: "FAIL", RUNNING: "RUN ", MISSING: "MISS", STALE: "STALE", IDLE: "IDLE", SKIPPED: "SKIP" };

export function renderSections(sections: Section[], width = 118): string {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`## ${section.title}`);
    for (const note of section.notes ?? []) lines.push(`   ${clip(note, width - 3)}`);
    if (section.rows.length === 0) lines.push("   (none)");
    const itemW = Math.min(24, Math.max(8, ...section.rows.map((r) => r.item.length)));
    for (const row of section.rows) {
      const head = `${STATE_TAG[row.state].padEnd(5)} ${clip(row.item, itemW).padEnd(itemW)} ${formatAge(row.ageMs).padStart(4)}  `;
      lines.push(`${head}${clip(row.reason, width - head.length)}`);
      if (row.next) lines.push(`${" ".repeat(6)}next: ${clip(row.next, width - 12)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---- gate provenance (gate.sh writes these fields into gate-result.json)

export interface GateProvenance {
  patchSha256?: string | null;
  baseCommit?: string | null;
  harnessId?: string | null;
  multiWasmSha256?: string | null;
  refWasmSha256?: string | null;
  seeds?: number | null;
  baseSeed?: number | null;
}

/**
 * A recorded PASS is STALE when the current out/ patch or the current frozen harness differs from what the gate ran.
 * A result without the recorded value (old gate.sh) is never stale for that field. Returns the reason, or null.
 */
export function gateStaleReason(recorded: GateProvenance, current: { patchSha256: string | null; harnessId: string | null }): string | null {
  const why: string[] = [];
  const short = (x: string | null | undefined) => (x ? x.slice(0, 10) : "none");
  if (recorded.patchSha256 && current.patchSha256 !== recorded.patchSha256) why.push(`patch changed (gate ran ${short(recorded.patchSha256)}, now ${short(current.patchSha256)})`);
  if (recorded.harnessId && current.harnessId !== recorded.harnessId) why.push(`harness changed (gate ran ${short(recorded.harnessId)}, now ${short(current.harnessId)})`);
  return why.length ? why.join("; ") : null;
}

export function provenanceText(p: GateProvenance): string {
  const short = (x: string | null | undefined, n = 8) => (x ? x.slice(0, n) : "-");
  if (!p.patchSha256 && !p.harnessId) return "no provenance";
  return `patch ${short(p.patchSha256)}, base ${short(p.baseCommit)}, harness ${short(p.harnessId)}, wasm ${short(p.multiWasmSha256)}/${short(p.refWasmSha256)}, ${p.seeds ?? "?"} seeds${p.baseSeed != null ? ` from ${p.baseSeed}` : ""}`;
}

// ---- gate 4b ETA

/** Median seconds per seed over past passed gate 4b runs. Null when there is no sample. */
export function secondsPerSeed(samples: { durationS: number | null; seeds: number | null }[]): number | null {
  const v = samples.flatMap((s) => (s.durationS != null && s.seeds && s.seeds > 0 && s.durationS > 0 ? [s.durationS / s.seeds] : [])).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/** Remaining seconds for a running gate 4b (never below 0), or null when there is no past run. */
export function gate4bEta(spp: number | null, seeds: number, elapsedS: number): number | null {
  if (spp === null) return null;
  return Math.max(0, Math.round(spp * seeds - elapsedS));
}

/** "100 seeds: Tests 100 passed" -> 100. Reads the detail text of gate results from old gate.sh versions. */
export function seedsFromDetail(detail: string): number | null {
  const m = /^(\d+) seeds/.exec(detail);
  return m ? Number(m[1]) : null;
}

// ---- differential history (all modes)

export interface HistoryEntry {
  time: string;
  mode: string;
  differences: number;
  parseWarnings: number;
  seeds: number;
  baseSeed: number;
  maxSteps: number;
  firstFailingSeed: number | null;
  durationMs: number;
  referenceSha: string;
  multiSha: string;
}

/** Columns: time, mode, differences, parseWarnings, seeds, baseSeed, maxSteps, firstFailingSeed, durationMs, refSha, multiSha. */
export function parseHistory(text: string | null): HistoryEntry[] {
  if (!text) return [];
  const out: HistoryEntry[] = [];
  for (const line of text.split("\n")) {
    const c = line.split("\t");
    if (c.length < 9 || !c[0] || !Number.isFinite(Date.parse(c[0])) || !c[1]) continue;
    out.push({
      time: c[0],
      mode: c[1],
      differences: Number(c[2]),
      parseWarnings: Number(c[3]),
      seeds: Number(c[4]),
      baseSeed: Number(c[5]),
      maxSteps: Number(c[6]),
      firstFailingSeed: c[7] ? Number(c[7]) : null,
      durationMs: Number(c[8]),
      referenceSha: c[9] ?? "",
      multiSha: c[10] ?? "",
    });
  }
  return out;
}

export const historyOk = (e: HistoryEntry): boolean => !(e.differences > 0 || e.parseWarnings > 0 || Number.isNaN(e.differences));

/** The latest entry per mode (by time) and the last `trend` results of that mode, oldest first. */
export function latestPerMode(entries: HistoryEntry[], trend = 5): { mode: string; latest: HistoryEntry; trend: boolean[] }[] {
  const byMode = new Map<string, HistoryEntry[]>();
  for (const e of [...entries].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) byMode.set(e.mode, [...(byMode.get(e.mode) ?? []), e]);
  return [...byMode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mode, list]) => ({ mode, latest: list[list.length - 1] as HistoryEntry, trend: list.slice(-trend).map(historyOk) }));
}

export function differentialModeRows(entries: HistoryEntry[], nowMs: number): Row[] {
  return latestPerMode(entries).map(({ mode, latest: d, trend }) => {
    const ok = historyOk(d);
    const seeds = `${d.seeds} seeds from ${d.baseSeed}, ${d.maxSteps} steps`;
    const base = `${seeds}, ${d.differences} diffs, ${d.parseWarnings} parse warnings, wasm ${d.multiSha.slice(0, 8) || "?"}, ${(d.durationMs / 1000).toFixed(0)}s`;
    const t = trend.map((x) => (x ? "ok" : "FAIL")).join(" ");
    return {
      item: `differential ${mode}`,
      state: ok ? ("PASS" as const) : ("FAIL" as const),
      ageMs: nowMs - Date.parse(d.time),
      reason: `${ok ? base : `${base}, first seed ${d.firstFailingSeed ?? "?"}`}; last ${trend.length}: ${t}`,
      next: !ok && d.firstFailingSeed != null ? `DIFF_ONLY_SEEDS=${d.firstFailingSeed} npx vitest run tests/differential/differential.test.ts` : undefined,
    };
  });
}

// ---- nduel summary (scripts/run-nduel.sh writes packages/duel-server/.status/nduel-summary.json)

export interface NduelCase {
  runs?: number;
  ok?: number;
  fail?: number;
  trap?: number;
  sanitizer?: number;
  crash?: number;
  unsupported?: number;
}
export interface NduelSummary {
  time?: string;
  seeds?: number;
  cases?: Record<string, NduelCase>;
  traps?: { file?: string; line?: number; count?: number; case?: string; seed?: number }[];
  sanitizer?: unknown[];
  hashChecks?: Record<string, { compared?: number; different?: number[] }>;
  failed?: number;
}

/** Of two reads (package and repo .status dir) the one with the newest mtime wins. A bad or missing read loses. */
export function newestRead<T>(reads: { read: SummaryRead<T>; mtimeMs: number | null }[]): { read: SummaryRead<T>; mtimeMs: number | null } {
  const good = reads.filter((r) => r.read.ok && r.read.data);
  const pool = good.length ? good : reads;
  return [...pool].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0] ?? { read: { ok: false, data: null, error: "missing" }, mtimeMs: null };
}

export function nduelRow(read: SummaryRead<NduelSummary>, mtimeMs: number | null, nowMs: number): Row {
  const item = "nduel";
  const next = "bash packages/duel-server/scripts/run-nduel.sh";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "no .status/nduel-summary.json" : (read.error ?? ""), next };
  const d = read.data;
  const cases = Object.entries(d.cases ?? {});
  const parts = cases.map(([name, c]) => {
    const bad = (c.fail ?? 0) + (c.trap ?? 0) + (c.sanitizer ?? 0) + (c.crash ?? 0);
    return bad ? `${name} FAIL ${c.ok ?? 0}/${c.runs ?? "?"}` : `${name} ok ${c.ok ?? 0}/${c.runs ?? "?"}`;
  });
  const trapTotal = cases.reduce((n, [, c]) => n + (c.trap ?? 0), 0);
  const top = d.traps?.[0];
  const trapText = trapTotal > 0 ? `traps ${trapTotal}${top ? `, top ${top.file}:${top.line} x${top.count}` : ""}` : "traps 0";
  const mism = Object.entries(d.hashChecks ?? {}).reduce((n, [, v]) => n + (v.different?.length ?? 0), 0);
  const hashText = `golden-hash mismatches ${mism}`;
  const fails = d.failed ?? cases.reduce((n, [, c]) => n + (c.fail ?? 0) + (c.trap ?? 0) + (c.sanitizer ?? 0) + (c.crash ?? 0), 0) + mism;
  const age = d.time ? nowMs - Date.parse(d.time) : mtimeMs === null ? null : nowMs - mtimeMs;
  return { item, state: fails > 0 ? "FAIL" : "PASS", ageMs: age !== null && Number.isFinite(age) ? age : null, reason: `${parts.join(", ") || "no cases"}; ${trapText}; ${hashText}`, next: fails > 0 ? next : undefined };
}

// ---- queue and load

export interface WaitFile {
  name: string;
  pid: number;
  tag: string;
  since: string;
  command: string;
}

export function parseWait(text: string): WaitFile | null {
  try {
    const o = JSON.parse(text) as Partial<WaitFile>;
    if (typeof o.name !== "string" || typeof o.pid !== "number") return null;
    return { name: o.name, pid: o.pid, tag: o.tag ?? "", since: String(o.since ?? ""), command: String(o.command ?? "") };
  } catch {
    return null;
  }
}

/** One row per lock name that has waiters. Waiters whose pid is dead are dropped (a killed -9 run leaves its file). */
export function queueRows(waits: WaitFile[], nowMs: number, alive: (pid: number) => boolean): Row[] {
  const byName = new Map<string, WaitFile[]>();
  for (const w of waits) if (alive(w.pid)) byName.set(w.name, [...(byName.get(w.name) ?? []), w]);
  return [...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => {
    const sorted = [...list].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
    const oldest = sorted[0] as WaitFile;
    const who = sorted.map((w) => (w.tag ? `${w.tag}:${w.pid}` : String(w.pid))).join(", ");
    return { item: `queue ${name}`, state: "IDLE" as const, ageMs: nowMs - Date.parse(oldest.since), reason: `${sorted.length} waiting (${who}), oldest waits ${formatAge(nowMs - Date.parse(oldest.since))}` };
  });
}

export interface PsStat {
  pid: number;
  ppid: number;
  pcpu: number;
  rssKb: number;
}

/** Parses `ps -eo pid=,ppid=,pcpu=,rss=`. */
export function parsePsStats(text: string): PsStat[] {
  const out: PsStat[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), pcpu: Number(m[3]), rssKb: Number(m[4]) });
  }
  return out;
}

/** CPU% and RSS summed over a process and all its descendants (a job is a shell with workers below it). */
export function subtreeStats(stats: PsStat[], root: number): { pcpu: number; rssKb: number; procs: number } {
  const kids = new Map<number, PsStat[]>();
  for (const s of stats) kids.set(s.ppid, [...(kids.get(s.ppid) ?? []), s]);
  const byPid = new Map(stats.map((s) => [s.pid, s]));
  let pcpu = 0;
  let rssKb = 0;
  let procs = 0;
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const self = byPid.get(pid);
    if (self) {
      pcpu += self.pcpu;
      rssKb += self.rssKb;
      procs++;
    }
    for (const k of kids.get(pid) ?? []) stack.push(k.pid);
  }
  return { pcpu, rssKb, procs };
}

// ---- events (push log of state changes)

export interface StatusEvent {
  ts: string;
  kind: string;
  key: string;
  from: string | null;
  to: string | null;
  detail: string;
}

/** key -> { value, detail } of everything we watch. */
export type Snapshot = Record<string, { value: string; detail: string }>;

/**
 * Events for every key whose value changed between two snapshots. A new key is an event with from=null, a removed key
 * an event with to=null. Detail-only changes are not events. `kindOf` maps a key prefix (before the first ":") to the kind.
 */
export function diffSnapshots(prev: Snapshot | null, cur: Snapshot, ts: string): StatusEvent[] {
  if (!prev) return [];
  const out: StatusEvent[] = [];
  const kind = (key: string) => key.split(":")[0] ?? "state";
  for (const key of Object.keys(cur).sort()) {
    const now = cur[key] as { value: string; detail: string };
    const was = prev[key];
    if (!was) out.push({ ts, kind: kind(key), key, from: null, to: now.value, detail: now.detail });
    else if (was.value !== now.value) out.push({ ts, kind: kind(key), key, from: was.value, to: now.value, detail: now.detail });
  }
  for (const key of Object.keys(prev).sort()) {
    if (!(key in cur)) out.push({ ts, kind: kind(key), key, from: (prev[key] as { value: string }).value, to: null, detail: (prev[key] as { detail: string }).detail });
  }
  return out;
}

/**
 * Snapshot of the table: one key per row ("<kind>:<item>", value = state). Gate rows are kind "gate", summary
 * rows (differential, nduel, fuzz, e2e) kind "test", lock rows kind "lock". Gate and core-task rows are keyed by the
 * task tag only (the item is the tag), so a patch appearing is not a second event. The jobs and agents sections are skipped
 * (they change every tick).
 */
export function snapshotOfSections(sections: Section[]): Snapshot {
  const snap: Snapshot = {};
  for (const s of sections) {
    const kind = s.title.startsWith("Phase 1") ? "gate" : s.title.startsWith("Latest") ? "test" : s.title.startsWith("Lock") ? "lock" : s.title.startsWith("Core builds") ? "build" : s.title.startsWith("Core tasks") ? "core" : s.title.startsWith("Stuck") ? "stuck" : s.title.startsWith("Phase 2 results") ? "result" : s.title.startsWith("Issue inbox") ? "issue" : null;
    if (!kind) continue;
    for (const r of s.rows) snap[`${kind}:${r.item}`] = { value: r.state, detail: r.reason };
  }
  return snap;
}

// ---- agents

export interface AgentEntry {
  name: string;
  brief?: string;
  files: string[];
}

export function parseAgents(text: string | null): AgentEntry[] | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    if (!Array.isArray(v)) return null;
    return v.flatMap((a) => {
      const o = a as Partial<AgentEntry>;
      if (typeof o?.name !== "string" || !Array.isArray(o.files)) return [];
      return [{ name: o.name, brief: typeof o.brief === "string" ? o.brief : "", files: o.files.filter((f): f is string => typeof f === "string") }];
    });
  } catch {
    return null;
  }
}

/** True when `a` and `b` are the same path, or one is a directory (trailing "/") that holds the other. */
export function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const dir = (x: string) => (x.endsWith("/") ? x : null);
  const da = dir(a);
  const db = dir(b);
  return (da !== null && b.startsWith(da)) || (db !== null && a.startsWith(db));
}

/** Paths that are in the lists of two or more agents (a directory holds its files): path -> agent names. */
export function findOverlaps(agents: AgentEntry[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i] as AgentEntry;
      const b = agents[j] as AgentEntry;
      for (const fa of a.files) {
        for (const fb of b.files) {
          if (!pathsOverlap(fa, fb)) continue;
          const key = fa.length >= fb.length ? fa : fb;
          out.set(key, (out.get(key) ?? new Set()).add(a.name).add(b.name));
        }
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

/** Sums the lines of `git diff --numstat` (binary files show "-" and count as 0). */
export function sumNumstat(text: string): { added: number; removed: number; files: number } {
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of text.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!m) continue;
    files++;
    added += m[1] === "-" ? 0 : Number(m[1]);
    removed += m[2] === "-" ? 0 : Number(m[2]);
  }
  return { added, removed, files };
}

export interface AgentInfo {
  agent: AgentEntry;
  newestMtimeMs: number | null;
  numstat: { added: number; removed: number; files: number };
}

export function agentRows(infos: AgentInfo[], overlaps: Map<string, string[]>, nowMs: number, example: boolean): Row[] {
  return infos.map(({ agent, newestMtimeMs, numstat }) => {
    const shared = [...overlaps].filter(([, names]) => names.includes(agent.name));
    const flag = shared.length ? `; OVERLAP ${shared.map(([f, n]) => `${f.split("/").pop()} with ${n.filter((x) => x !== agent.name).join(",")}`).join("; ")}` : "";
    const active = newestMtimeMs !== null && nowMs - newestMtimeMs < 10 * 60_000;
    return {
      item: `${example ? "(example) " : ""}${agent.name}`,
      state: shared.length ? ("STALE" as const) : active ? ("RUNNING" as const) : ("IDLE" as const),
      ageMs: newestMtimeMs === null ? null : nowMs - newestMtimeMs,
      reason: `${agent.files.length} files, +${numstat.added} -${numstat.removed} in ${numstat.files} changed${flag}${agent.brief ? `; ${agent.brief}` : ""}`,
    };
  });
}

// ---- HTML page

const STATE_COLOR: Record<State, string> = { PASS: "#1a7f37", FAIL: "#cf222e", RUNNING: "#0969da", MISSING: "#6e7781", STALE: "#9a6700", IDLE: "#6e7781", SKIPPED: "#9a6700" };

const fileUrl = (path: string): string => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

/** Plain HTML, no script, no server. meta refresh every 10 s. Links are file:// links. */
export function renderHtml(model: { time: string; sections: Section[] }, events: StatusEvent[]): string {
  const out: string[] = [];
  out.push('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Multi-player status</title>');
  out.push("<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#1f2328}table{border-collapse:collapse;width:100%;margin-bottom:20px}td,th{border:1px solid #d0d7de;padding:3px 8px;text-align:left;vertical-align:top}th{background:#f6f8fa}code{background:#f6f8fa;padding:1px 4px;word-break:break-all}h2{margin:18px 0 6px}.s{font-weight:bold}</style></head><body>");
  out.push(`<h1>Multi-player status</h1><p>${escapeHtml(model.time)} (page refreshes every 10 s)</p>`);
  for (const sec of model.sections) {
    out.push(`<h2>${escapeHtml(sec.title)}</h2>`);
    for (const n of sec.notes ?? []) out.push(`<p>${escapeHtml(n)}</p>`);
    if (sec.rows.length === 0) {
      out.push("<p>(none)</p>");
      continue;
    }
    out.push("<table><tr><th>State</th><th>Item</th><th>Age</th><th>Detail</th><th>Links and repro</th></tr>");
    for (const r of sec.rows) {
      const links = (r.links ?? []).map((l) => `<a href="${escapeHtml(fileUrl(l.path))}">${escapeHtml(l.label)}</a>`).join(" ");
      const next = r.next ? `<br><code>${escapeHtml(r.next)}</code>` : "";
      out.push(`<tr><td class="s" style="color:${STATE_COLOR[r.state]}">${r.state}</td><td>${escapeHtml(r.item)}</td><td>${formatAge(r.ageMs)}</td><td>${escapeHtml(r.reason)}</td><td>${links}${next}</td></tr>`);
    }
    out.push("</table>");
  }
  out.push("<h2>Events (newest first)</h2>");
  if (events.length === 0) out.push("<p>(none)</p>");
  else {
    out.push("<table><tr><th>Time</th><th>Kind</th><th>Key</th><th>Change</th><th>Detail</th></tr>");
    for (const e of [...events].reverse().slice(0, 40)) out.push(`<tr><td>${escapeHtml(e.ts)}</td><td>${escapeHtml(e.kind)}</td><td>${escapeHtml(e.key)}</td><td>${escapeHtml(`${e.from ?? "(new)"} -> ${e.to ?? "(gone)"}`)}</td><td>${escapeHtml(e.detail)}</td></tr>`);
    out.push("</table>");
  }
  out.push("</body></html>");
  return out.join("\n");
}

// ---- core task rows (phase 2: one row per task tag, compared with B2)

/** Messages of an mbox made by `git format-patch --stdout` (split at the "From <sha> Mon Sep 17" lines). */
export function splitMbox(text: string): string[] {
  const parts = text.split(/^From [0-9a-f]{40} /m);
  return parts.slice(1);
}

/** The diff of one mbox message: from the first "diff --git" line, without the "-- " signature (git version). */
export function patchBody(message: string): string {
  const at = message.search(/^diff --git /m);
  if (at < 0) return "";
  const body = message.slice(at);
  const sig = body.lastIndexOf("\n-- \n");
  return (sig >= 0 ? body.slice(0, sig) : body).trim();
}

export interface MboxCheck {
  count: number;
  baseCount: number;
  /** How many of the first baseCount patches equal the base patches. */
  equalPrefix: number;
  ok: boolean;
  reason: string;
}

/** The task mbox must hold the base patches (same bodies) and exactly one more patch. */
export function compareMbox(baseText: string, taskText: string): MboxCheck {
  const base = splitMbox(baseText).map(patchBody);
  const task = splitMbox(taskText).map(patchBody);
  let equalPrefix = 0;
  while (equalPrefix < base.length && equalPrefix < task.length && base[equalPrefix] === task[equalPrefix]) equalPrefix++;
  const countOk = task.length === base.length + 1;
  const prefixOk = equalPrefix === base.length;
  const why: string[] = [];
  if (!countOk) why.push(`mbox has ${task.length} patches, want ${base.length + 1}`);
  if (!prefixOk) why.push(`only the first ${equalPrefix} of ${base.length} base patches match B2`);
  return { count: task.length, baseCount: base.length, equalPrefix, ok: countOk && prefixOk, reason: why.join("; ") || `mbox ${task.length} = B2 ${base.length} + 1` };
}

export interface CensusSite {
  file?: string;
  line?: number;
  fn?: string;
  runs?: number;
}

const censusKey = (c: CensusSite) => `${c.file}:${c.line} ${c.fn ?? ""}`;

/** One line: how many trap sites of the B2 census are gone and how many are new in the task census. */
export function censusDelta(base: CensusSite[], task: CensusSite[]): string {
  const b = new Map(base.map((c) => [censusKey(c), c]));
  const t = new Map(task.map((c) => [censusKey(c), c]));
  const removed = [...b.keys()].filter((k) => !t.has(k));
  const added = [...t.keys()].filter((k) => !b.has(k));
  const sample = (keys: string[]) => (keys.length ? ` (${keys.slice(0, 2).map((k) => k.split(" ")[0]).join(", ")}${keys.length > 2 ? ", ..." : ""})` : "");
  return `census vs B2: ${removed.length} sites removed${sample(removed)}, ${added.length} added${sample(added)}, ${base.length} -> ${task.length}`;
}

export interface CoreTaskInput {
  tag: string;
  patch: string | null;
  /** Parent of the task commit in <TAG>/dev (full or short sha), null when the dev tree is unreadable. */
  parent: string | null;
  /** Expected parent (B2 commit). */
  expectedParent: string;
  mbox: MboxCheck | null;
  gate: { status: "pass" | "fail" | "running" | null; harnessId: string | null; updatedAt: string | null; detail: string };
  currentHarness: string | null;
  nduel: SummaryRead<NduelSummary>;
  hasUnchanged: boolean;
  hasCheck: boolean;
  census: string | null;
}

/** One row per core task. FAIL: bad parent, bad mbox or gate FAIL. STALE: harness differs, or a file is missing. */
export function coreTaskRow(i: CoreTaskInput, nowMs: number): Row {
  const bad: string[] = [];
  const stale: string[] = [];
  const parts: string[] = [];
  if (i.parent === null) stale.push("no dev tree git");
  else if (!(i.parent.startsWith(i.expectedParent.slice(0, 7)) || i.expectedParent.startsWith(i.parent.slice(0, 7)))) bad.push(`parent ${i.parent.slice(0, 7)} is not B2 ${i.expectedParent.slice(0, 7)}`);
  else parts.push(`parent B2 ${i.expectedParent.slice(0, 7)}`);
  if (i.mbox === null) stale.push("no mbox");
  else if (!i.mbox.ok) bad.push(i.mbox.reason);
  else parts.push(i.mbox.reason);
  if (i.gate.status === "fail") bad.push(`gate FAIL: ${i.gate.detail}`);
  else if (i.gate.status === "running") parts.push("gate running");
  else if (i.gate.status === null) stale.push("gate not run");
  else {
    if (!i.gate.harnessId || i.gate.harnessId !== i.currentHarness) stale.push(`gate PASS is STALE: harness ${i.gate.harnessId?.slice(0, 8) ?? "none"}, now ${i.currentHarness?.slice(0, 8) ?? "none"}`);
    else parts.push(`gate PASS (harness ${i.gate.harnessId.slice(0, 8)})`);
  }
  if (i.nduel.ok && i.nduel.data) {
    const n = nduelRow(i.nduel, null, nowMs);
    if (n.state === "FAIL") bad.push(`nduel FAIL: ${n.reason}`);
    else parts.push(`nduel ${n.state}: ${n.reason}`);
  } else stale.push("no nduel-summary.json");
  if (!i.hasUnchanged) stale.push("no unchanged-sites.md");
  if (!i.hasCheck) stale.push("no check/");
  if (i.census) parts.push(i.census);
  const updated = i.gate.updatedAt ? Date.parse(i.gate.updatedAt) : NaN;
  const ageMs = Number.isFinite(updated) ? nowMs - updated : null;
  const reason = [...bad, ...stale, ...parts].join("; ");
  const item = i.tag;
  if (bad.length) return { item, state: "FAIL", ageMs, reason };
  if (i.gate.status === "running") return { item, state: "RUNNING", ageMs, reason };
  if (stale.length) return { item, state: i.gate.status === null && i.patch === null ? "IDLE" : "STALE", ageMs, reason };
  return { item, state: "PASS", ageMs, reason };
}

// ---- stuck signals (never kills anything)

export interface PsAll {
  pid: number;
  ppid: number;
  elapsed: string;
  args: string;
}

export function parsePsAll(text: string): PsAll[] {
  const out: PsAll[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), elapsed: m[3] ?? "", args: m[4] ?? "" });
  }
  return out;
}

/** A vitest worker (vitest/dist/workers/forks.js) whose parent is missing or is not a vitest process. */
export function orphanedVitestWorkers(all: PsAll[]): PsAll[] {
  const byPid = new Map(all.map((p) => [p.pid, p]));
  return all.filter((p) => /vitest\/dist\/workers\/forks\.js/.test(p.args) && !/\bvitest\b/.test(byPid.get(p.ppid)?.args ?? ""));
}

/** What the watcher remembers between runs (saved in .status/.stuck-state.json by --watch). */
export interface StuckState {
  /** key -> ms since which the job used less than 2% CPU. */
  lowSince: Record<string, number>;
  /** tag -> signature of the dev tree (HEAD + diff hash) and the ms since it last changed. */
  trees: Record<string, { sig: string; since: number }>;
}

export const emptyStuckState = (): StuckState => ({ lowSince: {}, trees: {} });

export const LOW_CPU_PCT = 2;
export const LOW_CPU_MS = 10 * 60_000;
export const GATE_FAIL_MS = 20 * 60_000;
export const TREE_QUIET_MS = 30 * 60_000;
export const QUEUE_WAIT_MS = 15 * 60_000;

/** New state after one sample: keys with CPU >= 2% are dropped, keys still low keep their start. */
export function nextLowCpu(prev: Record<string, number>, samples: { key: string; pcpu: number }[], nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples) if (s.pcpu < LOW_CPU_PCT) out[s.key] = prev[s.key] ?? nowMs;
  return out;
}

/** New tree state: the signature keeps its start while HEAD and diff hash are unchanged. */
export function nextTrees(prev: StuckState["trees"], sigs: Record<string, string>, nowMs: number): StuckState["trees"] {
  const out: StuckState["trees"] = {};
  for (const [tag, sig] of Object.entries(sigs)) out[tag] = prev[tag]?.sig === sig ? (prev[tag] as { sig: string; since: number }) : { sig, since: nowMs };
  return out;
}

export interface StuckInput {
  nowMs: number;
  state: StuckState;
  /** Lock holders (alive) with the subtree CPU; key is "<name>.<slot>". */
  locks: { key: string; tag: string; pcpu: number; command: string }[];
  /** Gate FAIL rows: updatedAt of the gate-result and mtime of the task mbox. */
  gateFails: { tag: string; updatedMs: number; mboxMtimeMs: number | null }[];
  /** Tags that are not finished, and whether a job of the tag runs now. */
  trees: { tag: string; jobRuns: boolean }[];
  waits: WaitFile[];
  orphans: PsAll[];
}

/** Stuck rows. No row means nothing looks stuck. */
export function stuckRows(i: StuckInput): Row[] {
  const rows: Row[] = [];
  const row = (item: string, ageMs: number, reason: string, next?: string): Row => ({ item, state: "STALE", ageMs, reason, next });
  for (const l of i.locks) {
    const since = i.state.lowSince[l.key];
    if (since !== undefined && i.nowMs - since >= LOW_CPU_MS) rows.push(row(`lock ${l.key} idle`, i.nowMs - since, `${l.tag ? `[${l.tag}] ` : ""}held with cpu < ${LOW_CPU_PCT}% for ${formatAge(i.nowMs - since)}: ${l.command}`));
  }
  for (const g of i.gateFails) {
    const age = i.nowMs - g.updatedMs;
    const newer = g.mboxMtimeMs !== null && g.mboxMtimeMs > g.updatedMs;
    if (age >= GATE_FAIL_MS && !newer) rows.push(row(`${g.tag} gate FAIL, no new patch`, age, `gate FAIL ${formatAge(age)} ago and the mbox did not change since`));
  }
  for (const t of i.trees) {
    const s = i.state.trees[t.tag];
    if (s && !t.jobRuns && i.nowMs - s.since >= TREE_QUIET_MS) rows.push(row(`${t.tag} dev tree quiet`, i.nowMs - s.since, `HEAD and diff unchanged for ${formatAge(i.nowMs - s.since)} and no job of ${t.tag} runs`));
  }
  for (const w of i.waits) {
    const age = i.nowMs - Date.parse(w.since);
    if (age >= QUEUE_WAIT_MS) rows.push(row(`queue ${w.name} wait ${w.tag || w.pid}`, age, `waits ${formatAge(age)} for a ${w.name} slot (pid ${w.pid}): ${w.command}`));
  }
  for (const o of i.orphans) rows.push(row(`orphan vitest worker ${o.pid}`, etimeToMs(o.elapsed), `parent ${o.ppid} is not a vitest process. Not killed.`, `kill ${o.pid}`));
  return rows;
}

/** ps etime: [[dd-]hh:]mm:ss */
export function etimeToMs(etime: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime);
  if (!m) return 0;
  return (((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000;
}

// ---- phase 2 result rows (fuzz-n, e2e-multi, manual, issue inbox)

export interface FuzzNSummary {
  time?: string;
  runs?: number;
  failures?: number;
  knownFailures?: number;
  hangs?: number;
  firstFailingSeed?: number | null;
  tag?: string;
  coreTag?: string;
}

/** The newest `*.json` of .status/fuzz-n/ (mtime decides). */
export function fuzzNRow(read: SummaryRead<FuzzNSummary>, mtimeMs: number | null, nowMs: number): Row {
  const item = "fuzz-n";
  const next = "npm run fuzz:n --workspace=packages/duel-server";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "none yet (.status/fuzz-n/*.json)" : (read.error ?? ""), next };
  const d = read.data;
  const at = d.time ? Date.parse(d.time) : mtimeMs;
  const fails = (d.failures ?? 0) + (d.hangs ?? 0);
  const core = d.coreTag ?? d.tag;
  const base = `${core ? `core ${core}, ` : ""}${d.runs ?? "?"} duels, ${d.failures ?? 0} new failures (${d.knownFailures ?? 0} known), ${d.hangs ?? 0} hangs`;
  const state = fails > 0 ? "FAIL" : noPassState(d.runs ?? 0, 0);
  return { item, state, ageMs: at === null || !Number.isFinite(at) ? null : nowMs - at, reason: fails > 0 && d.firstFailingSeed != null ? `${base}, first seed ${d.firstFailingSeed}` : fails > 0 ? base : noPassReason(state, base), next: fails > 0 ? next : undefined };
}

export interface E2eMultiEntry {
  preset?: string;
  status?: string;
  coreTag?: string;
  turnReached?: number;
  lastPrompt?: string;
  evidenceDir?: string;
  firstError?: string;
}

/** latest.json is an array of entries, or {time, presets: [...]}. One row for the whole run. */
export function e2eMultiRow(read: SummaryRead<E2eMultiEntry[] | { time?: string; presets?: E2eMultiEntry[] }>, mtimeMs: number | null, nowMs: number): Row {
  const item = "e2e-multi";
  const next = "see packages/e2e (P1)";
  if (!read.ok || !read.data) return { item, state: "MISSING", ageMs: null, reason: read.error === "missing" ? "none yet (.status/e2e-multi/latest.json)" : (read.error ?? ""), next };
  const list = Array.isArray(read.data) ? read.data : (read.data.presets ?? []);
  const time = Array.isArray(read.data) ? null : read.data.time;
  const at = time ? Date.parse(time) : mtimeMs;
  const bad = list.filter((e) => e.status !== "pass");
  const cores = [...new Set(list.map((e) => e.coreTag).filter(Boolean))].join("/");
  const detail = bad.slice(0, 3).map((e) => `${e.preset ?? "?"} ${e.status ?? "?"} turn ${e.turnReached ?? "?"}${e.firstError ? ` (${e.firstError.slice(0, 60)})` : ""}`).join("; ");
  const reason = `${list.length - bad.length}/${list.length} presets pass${cores ? `, core ${cores}` : ""}${detail ? `; ${detail}` : ""}`;
  return { item, state: list.length === 0 ? "MISSING" : bad.length ? "FAIL" : "PASS", ageMs: at === null || !Number.isFinite(at) ? null : nowMs - at, reason: list.length === 0 ? "latest.json has no presets" : reason, next: bad.length ? next : undefined };
}

/** Entries of .status/manual/ (folders or files from manual sessions). Newest first by mtime. */
export function manualRow(entries: { name: string; mtimeMs: number }[], nowMs: number): Row {
  const item = "manual sessions";
  if (entries.length === 0) return { item, state: "MISSING", ageMs: null, reason: "none yet (.status/manual/*)" };
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = sorted[0] as { name: string; mtimeMs: number };
  return { item, state: "IDLE", ageMs: nowMs - newest.mtimeMs, reason: `${entries.length} entries, newest ${sorted.slice(0, 3).map((e) => e.name).join(", ")}`, next: `npx tsx packages/duel-server/scripts/triage.ts .status/manual/${newest.name}` };
}

export interface IssueFile {
  sig: string;
  owner: string;
  title: string;
  firstSeen?: string;
  count?: number;
  repro?: string;
}

/** Issue inbox (M4 writes .status/issues/<sig>.json). One row per issue, newest first seen at the top. Bad files show as FAIL. */
export function issueRows(files: { name: string; text: string }[], nowMs: number): Row[] {
  if (files.length === 0) return [{ item: "issues", state: "MISSING", ageMs: null, reason: "none yet (.status/issues/*.json)" }];
  const rows = files.map(({ name, text }): { at: number; row: Row } => {
    const r = readJson<IssueFile>(text);
    if (!r.ok || !r.data || typeof r.data.sig !== "string") return { at: 0, row: { item: `issue ${name}`, state: "FAIL", ageMs: null, reason: r.error ?? "no sig field" } };
    const d = r.data;
    const at = d.firstSeen ? Date.parse(d.firstSeen) : NaN;
    return { at: Number.isFinite(at) ? at : 0, row: { item: `issue ${d.sig}`, state: "FAIL", ageMs: Number.isFinite(at) ? nowMs - at : null, reason: `[${d.owner ?? "UNOWNED"}] ${d.title ?? ""} (seen ${d.count ?? 1}x)`, next: d.repro } };
  });
  return rows.sort((a, b) => b.at - a.at).map((r) => r.row);
}
