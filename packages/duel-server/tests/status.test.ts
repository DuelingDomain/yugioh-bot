import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CoreTaskInput,
  type Snapshot,
  type StuckInput,
  censusDelta,
  compareMbox,
  coreTaskRow,
  e2eMultiRow,
  emptyStuckState,
  fuzzNRow,
  issueRows,
  manualRow,
  nextLowCpu,
  nextTrees,
  orphanedVitestWorkers,
  parsePsAll,
  patchBody,
  splitMbox,
  stuckRows,
  agentRows,
  differentialModeRows,
  differentialRow,
  diffSnapshots,
  findOverlaps,
  formatAge,
  fuzzRow,
  gate4bEta,
  gateStaleReason,
  gatesFromLogs,
  latestPerMode,
  newestRead,
  nduelRow,
  ownerRow,
  parseAgents,
  parseHistory,
  parseOwner,
  parsePs,
  parsePsStats,
  parseVitestLog,
  parseWait,
  pathsOverlap,
  playwrightFailures,
  e2eRow,
  noPassState,
  renderSections,
  queueRows,
  readJson,
  renderHtml,
  scenariosRow,
  secondsPerSeed,
  seedsFromDetail,
  snapshotOfSections,
  subtreeStats,
  sumNumstat,
  summarizeGates,
} from "../scripts/lib/status-model.js";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("parseVitestLog", () => {
  it("reads a pass", () => {
    expect(parseVitestLog(" Test Files  1 passed (1)\n      Tests  3 passed (3)\n")).toMatchObject({ state: "pass", tests: "Tests  3 passed (3)" });
  });
  it("reads a fail with the first seed", () => {
    const text = "DIFF seed 77, process step 4, message: x\nDIFF seed 88, process step 1\n      Tests  1 failed | 2 passed (3)\n";
    expect(parseVitestLog(text)).toMatchObject({ state: "fail", firstFailingSeed: 77 });
  });
  it("is unknown for a log without a Tests line", () => {
    expect(parseVitestLog("starting\n").state).toBe("unknown");
  });
});

describe("gatesFromLogs", () => {
  const log = (name: "wasm" | "native" | "anchor" | "diff6" | "diffn", text: string, ageS: number) => ({ name, text, mtimeMs: NOW - ageS * 1000 });
  it("marks a growing last log running and earlier gates pass", () => {
    const { gates } = gatesFromLogs([log("wasm", "done", 500), log("native", "smoke: ok\n", 500), log("anchor", "ok", 300), log("diff6", "partial", 5)], NOW);
    expect(gates.map((g) => g.status)).toEqual(["pass", "pass", "pass", "running", "pending"]);
    expect(summarizeGates(gates).state).toBe("RUNNING");
  });
  it("passes when the last vitest log says passed", () => {
    const { gates } = gatesFromLogs(
      [log("wasm", "a", 900), log("native", "smoke: ok", 900), log("anchor", "ok", 900), log("diff6", "Tests  6 passed", 900), log("diffn", "Tests  100 passed (100)", 800)],
      NOW,
    );
    expect(summarizeGates(gates)).toMatchObject({ state: "PASS" });
  });
  it("fails on a diff log and keeps the seed", () => {
    const r = gatesFromLogs([log("wasm", "a", 900), log("native", "smoke: ok", 900), log("anchor", "ok", 900), log("diff6", "DIFF seed 5, step 2\nTests  1 failed", 900)], NOW);
    expect(summarizeGates(r.gates).state).toBe("FAIL");
    expect(r.firstFailingSeed).toBe(5);
  });
  it("treats a quiet last log as running when gate.sh is alive", () => {
    const { gates } = gatesFromLogs([log("wasm", "a", 900), log("native", "smoke: ok", 900), log("anchor", "ok", 900), log("diff6", "", 900)], NOW, 90_000, true);
    expect(gates[3]?.status).toBe("running");
  });
  it("fails a native log without a smoke line", () => {
    const { gates } = gatesFromLogs([log("wasm", "a", 900), log("native", "compiling", 900)], NOW);
    expect(gates[1]?.status).toBe("fail");
  });
});

describe("owners", () => {
  const text = JSON.stringify({ name: "diff", slot: 2, pid: 4242, tag: "CE", start: "2026-09-30T11:58:00Z", command: "npx vitest" });
  it("parses and rejects bad files", () => {
    expect(parseOwner(text)?.pid).toBe(4242);
    expect(parseOwner("{")).toBeNull();
    expect(parseOwner('{"name":"x"}')).toBeNull();
  });
  it("is STALE when the pid is dead and RUNNING when alive", () => {
    const owner = parseOwner(text)!;
    expect(ownerRow(owner, NOW, () => false)).toMatchObject({ state: "STALE", ageMs: 120_000 });
    expect(ownerRow(owner, NOW, () => true).state).toBe("RUNNING");
  });
});

describe("summaries", () => {
  it("handles missing and bad JSON", () => {
    expect(readJson(null)).toMatchObject({ ok: false, error: "missing" });
    expect(readJson("{oops").ok).toBe(false);
    expect(differentialRow(readJson(null), NOW).state).toBe("MISSING");
  });
  it("reads a differential summary", () => {
    const row = differentialRow(readJson(JSON.stringify({ time: "2026-09-30T11:00:00Z", seeds: 20, baseSeed: 1, differences: 1, parseWarnings: 0, firstFailingSeed: 9, multi: { path: "/x/a.wasm", sha256: "abcdef0123" } })), NOW);
    expect(row).toMatchObject({ state: "FAIL", ageMs: 3_600_000 });
    expect(row.reason).toContain("first seed 9");
  });
  it("reads fuzz and scenarios", () => {
    expect(fuzzRow(readJson(JSON.stringify({ time: "2026-09-30T11:59:00Z", runs: 10, failures: 0 })), NOW).state).toBe("PASS");
    const sc = scenariosRow(readJson(JSON.stringify({ numTotalTests: 3, numPassedTests: 2, numFailedTests: 1, testResults: [{ assertionResults: [{ status: "failed", fullName: "a b" }] }] })), NOW - 1000, NOW);
    expect(sc).toMatchObject({ state: "FAIL" });
    expect(sc.reason).toContain("a b");
  });
  it("lists playwright failures", () => {
    const data = { suites: [{ file: "a.spec.ts", suites: [{ title: "s", specs: [{ title: "ok", ok: true }, { title: "bad", ok: false }] }] }] };
    expect(playwrightFailures(data)).toEqual(["a.spec.ts: bad"]);
  });
  it("never shows PASS when nothing passed (e2e and scenarios)", () => {
    const e2e = (stats: object) => e2eRow(readJson(JSON.stringify({ stats })), NOW - 1000, NOW);
    const skippedOnly = e2e({ expected: 0, unexpected: 0, flaky: 0, skipped: 30 });
    expect(skippedOnly.state).toBe("SKIPPED");
    expect(skippedOnly.reason).toContain("0 passed");
    expect(skippedOnly.reason).toContain("30 skipped");
    expect(e2e({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 }).state).toBe("MISSING");
    expect(e2e({ expected: 3, unexpected: 0, flaky: 0, skipped: 30 }).state).toBe("PASS");
    expect(e2e({ expected: 0, unexpected: 1, flaky: 0, skipped: 30 })).toMatchObject({ state: "FAIL" });
    const scenarios = (data: object) => scenariosRow(readJson(JSON.stringify(data)), NOW - 1000, NOW);
    expect(scenarios({ numTotalTests: 9, numPassedTests: 0, numFailedTests: 0, numPendingTests: 9, success: true }).state).toBe("SKIPPED");
    expect(scenarios({ numTotalTests: 9, numPassedTests: 2, numFailedTests: 0, numPendingTests: 7, success: true }).state).toBe("PASS");
    expect(scenarios({ numTotalTests: 9, numPassedTests: 0, numFailedTests: 1, numPendingTests: 8, success: false }).state).toBe("FAIL");
    expect(noPassState(0, 0)).toBe("MISSING");
  });
  it("shows the SKIPPED state in the table", () => {
    const text = renderSections([{ title: "t", rows: [{ item: "e2e", state: "SKIPPED", ageMs: null, reason: "0 passed, 5 skipped" }] }]);
    expect(text).toContain("SKIP ");
    expect(text).not.toContain("PASS");
  });
});

describe("misc", () => {
  it("formats ages", () => {
    expect(formatAge(5000)).toBe("5s");
    expect(formatAge(10 * 60_000)).toBe("10m");
    expect(formatAge(5 * 3600_000)).toBe("5h");
    expect(formatAge(null)).toBe("-");
  });
  it("finds running jobs in ps output", () => {
    const ps = [
      "  9 1 01:02 /bin/bash -c source snap && bash gate.sh CE 100",
      "  10 9 01:02 bash packages/duel-server/domain-core/.build/phase1/gate.sh CE 100",
      "  11 10 00:05 bash run-locked.sh diff 3 npx vitest run tests/differential/differential.test.ts",
      "  14 11 00:05 node /x/vitest run tests/differential/differential.test.ts",
      "  12 1 00:01 tsx scripts/status.ts",
      "  13 1 00:01 /usr/bin/zsh",
    ].join("\n");
    expect(parsePs(ps, 999).map((j) => j.pid)).toEqual([10, 11]);
  });
});

describe("gate provenance and STALE", () => {
  const rec = { patchSha256: "aaaaaaaaaaaaaa", harnessId: "h1" };
  it("is not stale when patch and harness match", () => {
    expect(gateStaleReason(rec, { patchSha256: "aaaaaaaaaaaaaa", harnessId: "h1" })).toBeNull();
  });
  it("is stale when the patch changed", () => {
    expect(gateStaleReason(rec, { patchSha256: "bbbbbbbbbbbbbb", harnessId: "h1" })).toContain("patch changed");
  });
  it("is stale when the harness changed", () => {
    expect(gateStaleReason(rec, { patchSha256: "aaaaaaaaaaaaaa", harnessId: "h2" })).toContain("harness changed");
  });
  it("ignores an old result without provenance", () => {
    expect(gateStaleReason({}, { patchSha256: "x", harnessId: "y" })).toBeNull();
  });
});

describe("eta", () => {
  it("uses the median seconds per seed", () => {
    expect(secondsPerSeed([{ durationS: 100, seeds: 100 }, { durationS: 300, seeds: 100 }, { durationS: 200, seeds: 100 }, { durationS: null, seeds: 5 }])).toBe(2);
    expect(secondsPerSeed([])).toBeNull();
  });
  it("counts down and never goes below 0", () => {
    expect(gate4bEta(2, 100, 50)).toBe(150);
    expect(gate4bEta(2, 100, 500)).toBe(0);
    expect(gate4bEta(null, 100, 1)).toBeNull();
    expect(seedsFromDetail("100 seeds: Tests 100 passed")).toBe(100);
  });
});

describe("differential history", () => {
  const line = (time: string, mode: string, diffs: number, seed = "") => [time, mode, diffs, 0, 20, 20260930, 400, seed, 1000, "aaaa", "bbbb"].join("\t");
  const text = [
    line("2026-09-30T10:00:00Z", "long", 0),
    line("2026-09-30T11:00:00Z", "domain", 0),
    line("2026-09-30T12:00:00Z", "long", 2, "77"),
    "garbage line",
    line("2026-09-30T13:00:00Z", "long", 0),
  ].join("\n");
  it("shows the latest result per mode with a trend", () => {
    const modes = latestPerMode(parseHistory(text));
    expect(modes.map((m) => m.mode)).toEqual(["domain", "long"]);
    expect(modes[1]?.trend).toEqual([true, false, true]);
    expect(modes[1]?.latest.time).toBe("2026-09-30T13:00:00Z");
  });
  it("makes a FAIL row with the first seed", () => {
    const rows = differentialModeRows(parseHistory(line("2026-09-30T12:00:00Z", "long", 2, "77")), NOW);
    expect(rows[0]).toMatchObject({ item: "differential long", state: "FAIL" });
    expect(rows[0]?.reason).toContain("first seed 77");
    expect(rows[0]?.next).toContain("DIFF_ONLY_SEEDS=77");
  });
  it("keeps only the last 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => line(`2026-09-30T0${i}:00:00Z`, "long", i === 2 ? 1 : 0)).join("\n");
    expect(latestPerMode(parseHistory(many))[0]?.trend).toHaveLength(5);
  });
});

describe("nduel row", () => {
  const data = {
    time: "2026-09-30T11:00:00.5Z",
    cases: { n2: { runs: 20, ok: 20 }, n3: { runs: 20, ok: 17, trap: 3 } },
    traps: [{ file: "field.cpp", line: 12, count: 3 }],
    hashChecks: { n2_repeat: { compared: 20, different: [4] } },
    failed: 4,
  };
  it("shows per case, traps and hash mismatches", () => {
    const row = nduelRow(readJson(JSON.stringify(data)), null, NOW);
    expect(row.state).toBe("FAIL");
    expect(row.reason).toContain("n2 ok 20/20");
    expect(row.reason).toContain("n3 FAIL 17/20");
    expect(row.reason).toContain("top field.cpp:12 x3");
    expect(row.reason).toContain("golden-hash mismatches 1");
  });
  it("passes a clean summary and reports missing", () => {
    expect(nduelRow(readJson(JSON.stringify({ cases: { n2: { runs: 2, ok: 2 } }, failed: 0 })), NOW - 1000, NOW).state).toBe("PASS");
    expect(nduelRow(readJson(null), null, NOW).state).toBe("MISSING");
  });
  it("picks the newest read", () => {
    const a = { read: readJson('{"x":1}'), mtimeMs: 10 };
    const b = { read: readJson('{"x":2}'), mtimeMs: 20 };
    expect((newestRead([a, b]).read.data as { x: number }).x).toBe(2);
    expect((newestRead([a, { read: readJson(null), mtimeMs: 99 }]).read.data as { x: number }).x).toBe(1);
  });
});

describe("queue and load", () => {
  it("groups waiters per lock and drops dead pids", () => {
    const w = (name: string, pid: number, since: string) => ({ name, pid, tag: "CE", since, command: "x" });
    const rows = queueRows([w("diff", 1, "2026-09-30T11:55:00Z"), w("diff", 2, "2026-09-30T11:58:00Z"), w("build", 3, "2026-09-30T11:59:00Z"), w("diff", 4, "2026-09-30T11:00:00Z")], NOW, (pid) => pid !== 4);
    expect(rows.map((r) => r.item)).toEqual(["queue build", "queue diff"]);
    expect(rows[1]?.reason).toContain("2 waiting");
    expect(rows[1]?.reason).toContain("5m");
  });
  it("parses wait files", () => {
    expect(parseWait('{"name":"diff","pid":5,"since":"x"}')?.pid).toBe(5);
    expect(parseWait("{")).toBeNull();
  });
  it("sums cpu and rss over the subtree", () => {
    const stats = parsePsStats("  1 0 0.0 100\n  2 1 50.5 2000\n  3 2 25.0 1000\n  4 9 99.0 5\n");
    expect(subtreeStats(stats, 1)).toEqual({ pcpu: 75.5, rssKb: 3100, procs: 3 });
  });
});

describe("events", () => {
  const snap = (o: Record<string, string>): Snapshot => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, detail: `d-${v}` }]));
  it("makes no event without a previous snapshot", () => {
    expect(diffSnapshots(null, snap({ "gate:A": "PASS" }), "t")).toEqual([]);
  });
  it("reports changes, new keys and removed keys", () => {
    const ev = diffSnapshots(snap({ "gate:A": "RUNNING", "test:x": "PASS", "lock:l": "RUNNING" }), snap({ "gate:A": "PASS", "test:x": "PASS", "failure:f1": "present" }), "t");
    expect(ev).toEqual([
      { ts: "t", kind: "failure", key: "failure:f1", from: null, to: "present", detail: "d-present" },
      { ts: "t", kind: "gate", key: "gate:A", from: "RUNNING", to: "PASS", detail: "d-PASS" },
      { ts: "t", kind: "lock", key: "lock:l", from: "RUNNING", to: null, detail: "d-RUNNING" },
    ]);
  });
  it("skips the jobs and agents sections in the snapshot", () => {
    const s = snapshotOfSections([
      { title: "Phase 1 core agents (gate results)", rows: [{ item: "T0", state: "PASS", ageMs: 1, reason: "r" }] },
      { title: "Running jobs and machine", rows: [{ item: "vitest 1", state: "RUNNING", ageMs: 1, reason: "r" }] },
      { title: "Agents (.status/agents.json)", rows: [{ item: "a", state: "IDLE", ageMs: 1, reason: "r" }] },
    ]);
    expect(Object.keys(s)).toEqual(["gate:T0"]);
  });
});

describe("agents", () => {
  const agents = [
    { name: "A", files: ["x.ts", "shared.ts"] },
    { name: "B", files: ["y.ts", "shared.ts"] },
  ];
  it("finds a file in two lists", () => {
    expect([...findOverlaps(agents)]).toEqual([["shared.ts", ["A", "B"]]]);
  });
  it("sums numstat and flags the overlap", () => {
    expect(sumNumstat("3\t1\tx.ts\n-\t-\timg.png\n10\t0\ty.ts\n")).toEqual({ added: 13, removed: 1, files: 3 });
    const rows = agentRows(
      agents.map((agent) => ({ agent, newestMtimeMs: NOW - 60_000, numstat: { added: 1, removed: 2, files: 1 } })),
      findOverlaps(agents),
      NOW,
      false,
    );
    expect(rows[0]?.state).toBe("STALE");
    expect(rows[0]?.reason).toContain("OVERLAP shared.ts with B");
  });
  it("parses agents.json and rejects bad input", () => {
    expect(parseAgents('[{"name":"A","brief":"b","files":["x"]},{"bad":1}]')).toEqual([{ name: "A", brief: "b", files: ["x"] }]);
    expect(parseAgents("{")).toBeNull();
    expect(parseAgents(null)).toBeNull();
  });
});

describe("html", () => {
  it("escapes text and links files", () => {
    const html = renderHtml({ time: "t", sections: [{ title: "S<1>", rows: [{ item: "a&b", state: "FAIL", ageMs: 1000, reason: "<x>", next: "cmd \"q\"", links: [{ label: "log", path: "/a b/c.log" }] }] }] }, []);
    expect(html).toContain('http-equiv="refresh" content="10"');
    expect(html).toContain("S&lt;1&gt;");
    expect(html).toContain("a&amp;b");
    expect(html).toContain("file:///a%20b/c.log");
    expect(html).not.toContain("<x>");
  });
});

describe("overlap by directory", () => {
  it("counts a directory as holding its files", () => {
    expect(pathsOverlap("a/b/", "a/b/c.ts")).toBe(true);
    expect(pathsOverlap("a/b/", "a/bc.ts")).toBe(false);
    const o = findOverlaps([{ name: "A", files: ["a/b/"] }, { name: "B", files: ["a/b/c.ts"] }, { name: "C", files: ["z.ts"] }]);
    expect([...o]).toEqual([["a/b/c.ts", ["A", "B"]]]);
  });
});


// ---- phase 2 rows (M3)

const SHA = (n: number) => String(n).repeat(40).slice(0, 40);
const mboxOf = (bodies: string[], sig = "2.43.0") =>
  bodies.map((b, i) => `From ${SHA(i % 10)} Mon Sep 17 00:00:00 2001\nFrom: A <a@b>\nSubject: [PATCH ${i + 1}] x${i}\n\nmsg\n---\n f | 1 +\n\ndiff --git a/f b/f\n${b}\n-- \n${sig}\n\n`).join("");

describe("mbox compare", () => {
  const base = mboxOf(["one", "two"]);
  it("splits messages and cuts the signature", () => {
    expect(splitMbox(base)).toHaveLength(2);
    expect(patchBody(splitMbox(base)[0] as string)).toBe("diff --git a/f b/f\none");
  });
  it("accepts base + 1 patch and ignores headers and git version", () => {
    const task = mboxOf(["one", "two", "three"], "2.50.1").replace(/Subject: \[PATCH (\d)\]/g, "Subject: [PATCH $1/3]");
    expect(compareMbox(base, task)).toMatchObject({ ok: true, count: 3, equalPrefix: 2 });
  });
  it("rejects a wrong count and a changed base patch", () => {
    expect(compareMbox(base, mboxOf(["one", "two"])).ok).toBe(false);
    const bad = compareMbox(base, mboxOf(["one", "CHANGED", "three"]));
    expect(bad).toMatchObject({ ok: false, equalPrefix: 1 });
    expect(bad.reason).toContain("first 1 of 2");
  });
});

describe("census delta", () => {
  const a = { file: "f.cpp", line: 1, fn: "x" };
  const b = { file: "g.cpp", line: 2, fn: "y" };
  const c = { file: "h.cpp", line: 3, fn: "z" };
  it("counts removed and added sites in one line", () => {
    const line = censusDelta([a, b], [b, c]);
    expect(line).toContain("1 sites removed (f.cpp:1)");
    expect(line).toContain("1 added (h.cpp:3)");
    expect(line).not.toContain("\n");
  });
});

describe("coreTaskRow", () => {
  const okNduel = { ok: true, data: { time: "2026-09-30T11:55:00Z", cases: { n3: { runs: 20, ok: 20 } }, traps: [], hashChecks: {}, failed: 0 } };
  const good: CoreTaskInput = {
    tag: "T3",
    patch: "0001-t3.patch",
    parent: "4d93d0828e86",
    expectedParent: "4d93d0828e868ddfb0bccccf69da5921bb87887d",
    mbox: { count: 13, baseCount: 12, equalPrefix: 12, ok: true, reason: "mbox 13 = B2 12 + 1" },
    gate: { status: "pass", harnessId: "abc123", updatedAt: "2026-09-30T11:50:00Z", detail: "" },
    currentHarness: "abc123",
    nduel: okNduel,
    hasUnchanged: true,
    hasCheck: true,
    census: "census vs B2: 2 sites removed, 0 added",
  };
  it("is one row keyed by the tag alone, PASS when all is in order", () => {
    const r = coreTaskRow(good, NOW);
    expect(r).toMatchObject({ item: "T3", state: "PASS", ageMs: 600_000 });
    expect(r.reason).toContain("census vs B2");
  });
  it("FAILs on a wrong parent, a bad mbox, a gate FAIL or an nduel FAIL", () => {
    expect(coreTaskRow({ ...good, parent: "b5c410b" }, NOW)).toMatchObject({ state: "FAIL" });
    expect(coreTaskRow({ ...good, mbox: { ...good.mbox!, ok: false, reason: "mbox has 1 patches" } }, NOW).reason).toContain("mbox has 1 patches");
    expect(coreTaskRow({ ...good, gate: { ...good.gate, status: "fail", detail: "diff6" } }, NOW).state).toBe("FAIL");
    expect(coreTaskRow({ ...good, nduel: { ok: true, data: { cases: { n3: { runs: 20, ok: 0, trap: 20 } } } } }, NOW).state).toBe("FAIL");
  });
  it("is STALE when the gate used an old harness, or a file is missing", () => {
    const old = coreTaskRow({ ...good, gate: { ...good.gate, harnessId: "old999" } }, NOW);
    expect(old.state).toBe("STALE");
    expect(old.reason).toContain("STALE");
    expect(coreTaskRow({ ...good, hasUnchanged: false }, NOW).reason).toContain("no unchanged-sites.md");
    expect(coreTaskRow({ ...good, hasCheck: false, census: null }, NOW).state).toBe("STALE");
    expect(coreTaskRow({ ...good, nduel: { ok: false, data: null, error: "missing" } }, NOW).reason).toContain("no nduel-summary.json");
  });
  it("is RUNNING while the gate runs", () => {
    expect(coreTaskRow({ ...good, gate: { ...good.gate, status: "running" } }, NOW).state).toBe("RUNNING");
  });
});

describe("stuck signals", () => {
  const base = (over: Partial<StuckInput> = {}): StuckInput => ({ nowMs: NOW, state: emptyStuckState(), locks: [], gateFails: [], trees: [], waits: [], orphans: [], ...over });
  const min = (n: number) => n * 60_000;
  it("tracks low CPU and resets when the job works again", () => {
    const s1 = nextLowCpu({}, [{ key: "diff.1", pcpu: 0.5 }, { key: "diff.2", pcpu: 90 }], NOW - min(11));
    expect(s1).toEqual({ "diff.1": NOW - min(11) });
    const s2 = nextLowCpu(s1, [{ key: "diff.1", pcpu: 1.9 }], NOW);
    expect(s2["diff.1"]).toBe(NOW - min(11));
    expect(nextLowCpu(s2, [{ key: "diff.1", pcpu: 5 }], NOW)).toEqual({});
  });
  it("flags a lock at low CPU for 10 minutes, not 9", () => {
    const lock = { key: "diff.1", tag: "T4", pcpu: 0.1, command: "vitest" };
    expect(stuckRows(base({ locks: [lock], state: { lowSince: { "diff.1": NOW - min(9) }, trees: {} } }))).toHaveLength(0);
    const rows = stuckRows(base({ locks: [lock], state: { lowSince: { "diff.1": NOW - min(10) }, trees: {} } }));
    expect(rows[0]).toMatchObject({ state: "STALE", item: "lock diff.1 idle" });
  });
  it("flags a gate FAIL without a newer mbox after 20 minutes", () => {
    const fail = (updated: number, mbox: number | null) => stuckRows(base({ gateFails: [{ tag: "F6", updatedMs: updated, mboxMtimeMs: mbox }] }));
    expect(fail(NOW - min(19), null)).toHaveLength(0);
    expect(fail(NOW - min(21), NOW - min(30))).toHaveLength(1);
    expect(fail(NOW - min(21), NOW - min(5))).toHaveLength(0);
  });
  it("flags a quiet dev tree only when no job of the tag runs", () => {
    const sigs = { T3: "head+hash" };
    const state = { lowSince: {}, trees: nextTrees({}, sigs, NOW - min(31)) };
    expect(stuckRows(base({ state, trees: [{ tag: "T3", jobRuns: true }] }))).toHaveLength(0);
    expect(stuckRows(base({ state, trees: [{ tag: "T3", jobRuns: false }] }))[0]?.item).toBe("T3 dev tree quiet");
    const changed = nextTrees(state.trees, { T3: "head+hash2" }, NOW);
    expect(changed.T3?.since).toBe(NOW);
    expect(nextTrees(state.trees, sigs, NOW).T3?.since).toBe(NOW - min(31));
  });
  it("flags a queue wait over 15 minutes", () => {
    const w = (mins: number) => ({ name: "build", pid: 7, tag: "T5B", since: new Date(NOW - min(mins)).toISOString(), command: "docker" });
    expect(stuckRows(base({ waits: [w(14)] }))).toHaveLength(0);
    expect(stuckRows(base({ waits: [w(16)] }))[0]?.item).toContain("queue build");
  });
  it("finds an orphaned vitest worker and not a worker with a vitest parent", () => {
    const ps = [
      "100 1 05:00 node /r/node_modules/vitest/vitest.mjs run x",
      "101 100 05:00 node /r/node_modules/vitest/dist/workers/forks.js",
      "200 1 20:00 node /r/node_modules/vitest/dist/workers/forks.js",
      "300 999 20:00 node /r/node_modules/vitest/dist/workers/forks.js",
      "400 1 01:00 /usr/bin/zsh",
    ].join("\n");
    const all = parsePsAll(ps);
    expect(all).toHaveLength(5);
    expect(orphanedVitestWorkers(all).map((p) => p.pid)).toEqual([200, 300]);
    const rows = stuckRows(base({ orphans: orphanedVitestWorkers(all) }));
    expect(rows[0]?.reason).toContain("Not killed");
  });
});

describe("rows where nothing ran are not PASS", () => {
  it("shows differential with no multi core as SKIPPED and with 0 seeds as MISSING", () => {
    const noCore = differentialRow(readJson(JSON.stringify({ time: "2026-09-30T11:00:00Z", seeds: 20, differences: 0, parseWarnings: 0 })), NOW);
    expect(noCore.state).toBe("SKIPPED");
    const noSeeds = differentialRow(readJson(JSON.stringify({ seeds: 0, differences: 0, multi: { path: "/x/a.wasm" } })), NOW);
    expect(noSeeds.state).toBe("MISSING");
    const ok = differentialRow(readJson(JSON.stringify({ seeds: 20, differences: 0, multi: { path: "/x/a.wasm" } })), NOW);
    expect(ok.state).toBe("PASS");
  });
  it("shows fuzz and fuzz-n with 0 duels as MISSING", () => {
    expect(fuzzRow(readJson(JSON.stringify({ runs: 0, failures: 0 })), NOW).state).toBe("MISSING");
    expect(fuzzNRow(readJson(JSON.stringify({ runs: 0, failures: 0 })), null, NOW).state).toBe("MISSING");
  });
});

describe("result rows and issue inbox", () => {
  it("reads fuzz-n, none yet when missing", () => {
    expect(fuzzNRow({ ok: false, data: null, error: "missing" }, null, NOW)).toMatchObject({ state: "MISSING" });
    expect(fuzzNRow(readJson(JSON.stringify({ time: "2026-09-30T11:00:00Z", runs: 50, failures: 0, knownFailures: 2, coreTag: "T3" })), null, NOW)).toMatchObject({ state: "PASS", ageMs: 3_600_000 });
    const bad = fuzzNRow(readJson(JSON.stringify({ runs: 50, failures: 1, hangs: 1, firstFailingSeed: 9 })), NOW - 1000, NOW);
    expect(bad).toMatchObject({ state: "FAIL", ageMs: 1000 });
    expect(bad.reason).toContain("first seed 9");
  });
  it("reads e2e-multi latest.json", () => {
    expect(e2eMultiRow({ ok: false, data: null, error: "missing" }, null, NOW).reason).toContain("none yet");
    const list = [
      { preset: "ffa3", status: "pass", coreTag: "B2", turnReached: 9 },
      { preset: "tag", status: "stall", coreTag: "B2", turnReached: 2, firstError: "no revision" },
    ];
    const r = e2eMultiRow(readJson(JSON.stringify(list)), NOW - 5000, NOW);
    expect(r).toMatchObject({ state: "FAIL", ageMs: 5000 });
    expect(r.reason).toContain("1/2 presets pass");
    expect(r.reason).toContain("tag stall turn 2");
    expect(e2eMultiRow(readJson(JSON.stringify(list.slice(0, 1))), null, NOW).state).toBe("PASS");
  });
  it("lists manual sessions, newest first", () => {
    expect(manualRow([], NOW).state).toBe("MISSING");
    const r = manualRow([{ name: "old", mtimeMs: NOW - 9000 }, { name: "new", mtimeMs: NOW - 1000 }], NOW);
    expect(r.reason).toContain("2 entries, newest new, old");
    expect(r.ageMs).toBe(1000);
  });
  it("reads the issue inbox from files in a temp dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "status-issues-"));
    try {
      expect(issueRows([], NOW)[0]).toMatchObject({ state: "MISSING" });
      mkdirSync(join(dir, "issues"));
      writeFileSync(join(dir, "issues", "a.json"), JSON.stringify({ sig: "a1", owner: "T5B", title: "eliminate hang", firstSeen: "2026-09-30T10:00:00Z", count: 3, repro: "npm run fuzz:n -- --repro x" }));
      writeFileSync(join(dir, "issues", "b.json"), JSON.stringify({ sig: "b2", owner: "UNOWNED", title: "leak", firstSeen: "2026-09-30T11:00:00Z", count: 1 }));
      writeFileSync(join(dir, "issues", "c.json"), "{oops");
      const files = readdirSync(join(dir, "issues")).sort().map((name) => ({ name, text: readFileSync(join(dir, "issues", name), "utf8") }));
      const rows = issueRows(files, NOW);
      expect(rows.map((r) => r.item)).toEqual(["issue b2", "issue a1", "issue c.json"]);
      expect(rows[1]).toMatchObject({ state: "FAIL", next: "npm run fuzz:n -- --repro x" });
      expect(rows[1]?.reason).toContain("[T5B] eliminate hang (seen 3x)");
      expect(rows[2]?.reason).toContain("bad JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("events keyed by tag", () => {
  it("a patch appearing for a tag is not a second event", () => {
    const section = (state: "IDLE" | "PASS") => [{ title: "Phase 1 core agents (gate results)", rows: [{ item: "F02", state, ageMs: 1, reason: state === "IDLE" ? "(no patch)" : "0001-x.patch" }] }];
    const first = snapshotOfSections(section("IDLE"));
    const events = diffSnapshots(first, snapshotOfSections(section("PASS")), "t");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: "gate:F02", from: "IDLE", to: "PASS" });
  });
  it("gives the new sections their own kinds", () => {
    const sec = (title: string) => ({ title, rows: [{ item: "x", state: "PASS" as const, ageMs: 1, reason: "" }] });
    const keys = Object.keys(snapshotOfSections([sec("Core tasks (vs B2)"), sec("Stuck signals"), sec("Phase 2 results (a)"), sec("Issue inbox (b)")]));
    expect(keys).toEqual(["core:x", "stuck:x", "result:x", "issue:x"]);
  });
});
