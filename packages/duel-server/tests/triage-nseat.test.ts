import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseCore, findWasmBySha, loadNSource } from "../scripts/failure-to-scenario.js";
import { classifyKnown, recordIssue, readIssues, signatureOf, ownerOfFailure } from "../scripts/lib/issue-registry.js";
import { loadOwners } from "../scripts/lib/owners.js";
import { detectJson, failureInfoOf, readManualJournal, triage, writeGeneratedIndex } from "../scripts/triage.js";
import { engineDataDirectory } from "./fuzz/config.js";
import { itWithCores, needs } from "./support/cores.js";
import { createHash } from "node:crypto";

const dataDirectory = engineDataDirectory();
const FUZZ_N = resolve(__dirname, "fuzz-n/failures/ffa3-1-B2.json");
const multiNeeds = [
  needs.installedMulti(dataDirectory),
  needs.localFile("fuzz-n failure fixture ffa3-1-B2.json (gitignored, not a core)", FUZZ_N, "Record it with npm run fuzz:n on core B2."),
];
const deck = { main: [1, 2, 3], extra: [] };

describe("N-seat triage", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "triage-nseat-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, value: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };

  it("detects a fuzz-n failure file and a debug-trace", () => {
    const failure = { format: "ffa3", answers: [], check: { name: "hang", message: "m", step: 1 }, wasm: { tag: "B2", sha256: "x", path: "p" }, decks: [deck, deck, deck] };
    expect(detectJson(failure).type).toBe("fuzz-n");
    const trace = { revision: 3, seats: [{ seat: 0 }], worker: { busy: false } };
    expect(detectJson(trace).type).toBe("stall");
  });

  it("reads a 4 seat journal: format from tableFormat, wasmSha, startup scripts, eliminate commands", () => {
    const file = write("j4.json", {
      format: "yugidraft-duel-journal/1",
      slug: "s",
      mode: "normal",
      masterRule: 5,
      seed: ["1", "2", "3", "4"],
      tableFormat: "tag",
      wasmSha: "ab".repeat(32),
      startupScripts: ["Debug.Message('x')"],
      decks: [deck, deck, deck, deck],
      commands: [{ seat: 2, command: { promptId: "eliminate:4", revision: 7, answer: {} } }],
    });
    const source = loadNSource(file);
    expect(source).toMatchObject({ format: "tag", seatCount: 4, wasmSha: "ab".repeat(32) });
    expect(source.startupScripts).toEqual(["Debug.Message('x')"]);
    expect(source.commands[0]).toMatchObject({ seat: 2, promptId: "eliminate:4" });
  });

  it("picks the wasm whose sha matches, and warns when none matches", () => {
    const a = write("a.wasm", "aaaa");
    const b = write("b.wasm", "bbbb-core");
    const shaB = createHash("sha256").update("bbbb-core").digest("hex");
    expect(findWasmBySha(shaB, [a, b])).toBe(b);
    expect(findWasmBySha(shaB.slice(0, 12), [a, b])).toBe(b);
    expect(findWasmBySha("deadbeef", [a, b])).toBeUndefined();
    expect(findWasmBySha("dead", [a, b])).toBeUndefined();
    const source = loadNSource(write("j3.json", { format: "yugidraft-duel-journal/1", mode: "normal", masterRule: 5, seed: ["1", "2", "3", "4"], decks: [deck, deck, deck], commands: [] }));
    const fallback = chooseCore(source, dir);
    expect(fallback.path).toBeUndefined();
    expect(fallback.warnings.join(" ")).toContain("no wasmSha");
    const withSha = chooseCore({ ...source, wasmSha: "00".repeat(32) }, dir);
    expect(withSha.warnings.join(" ")).toContain("No wasm with sha");
    expect(withSha.warnings.join(" ")).toContain("Falling back");
    expect(chooseCore({ ...source, wasmSha: shaB }, dir).path).toBe(b);
    expect(chooseCore(source, dir, "x/y.wasm").path).toBe(resolve("x/y.wasm"));
  });

  it("reads manual journal lines: eliminate lines sit at their seq", () => {
    const folder = join(dir, "manual", "m1");
    mkdirSync(folder, { recursive: true });
    const header = { format: "yugidraft-duel-journal/1", slug: "m", decks: [deck, deck, deck] };
    writeFileSync(
      join(folder, "journal.jsonl"),
      [
        JSON.stringify(header),
        JSON.stringify({ type: "eliminate", seq: 2, seat: 1, code: 9, revision: 5 }),
        JSON.stringify({ type: "answer", seq: 1, seat: 0, command: { promptId: "p", revision: 4, answer: {} } }),
      ].join("\n"),
    );
    const journal = readManualJournal(folder)!;
    expect(journal.commands.map((c: any) => c.seat)).toEqual([0, 1]);
    expect(journal.commands[1].command.promptId).toBe("eliminate:9");
  });

  it("writes the preset index from the draft files", () => {
    const presets = join(dir, "presets");
    mkdirSync(presets);
    writeFileSync(join(presets, "b.ts"), "export const preset = {};");
    writeFileSync(join(presets, "a-1.ts"), "export const preset = {};");
    const text = readFileSync(writeGeneratedIndex(presets), "utf8");
    expect(text).toContain('import { preset as g_a_1 } from "./a-1.js";');
    expect(text).toContain("GENERATED_PRESETS: readonly Preset[] = [g_a_1, g_b];");
  });

  itWithCores(
    "replays a 3 seat fuzz-n failure, writes a preset draft, names the owner and writes the issue file",
    multiNeeds,
    async () => {
      const presetDirectory = join(dir, "generated");
      const issuesDirectory = join(dir, "issues");
      const result = await triage(FUZZ_N, { presetDirectory, issuesDirectory, dataDirectory });
      expect(result.code).toBe(0);
      expect(result.sig).toBe("b2-seat1-end-turn-hang");
      expect(result.owner).toContain("T3");
      const draft = readFileSync(result.presetDraft!, "utf8");
      expect(draft).toContain('format: "ffa3"');
      expect(draft).toContain('needs: "multi-core"');
      for (const seat of ["p0", "p1", "p2"]) expect(draft).toContain(`"${seat}": {`);
      expect(draft).not.toContain('"p3"');
      expect(draft).toContain("bots: { 1: [], 2: [] }");
      expect(readdirSync(presetDirectory).sort()).toEqual(["b2-seat1-end-turn-hang.ts", "index.ts"]);
      const issue = JSON.parse(readFileSync(result.issueFile!, "utf8"));
      expect(issue).toMatchObject({ sig: "b2-seat1-end-turn-hang", count: 1, source: expect.stringContaining("fuzz-n") });
      expect(issue.repro).toContain("replay-journal.ts");
      const again = await triage(FUZZ_N, { presetDirectory, issuesDirectory, dataDirectory });
      expect(again.code).toBe(0);
      expect(JSON.parse(readFileSync(again.issueFile!, "utf8")).count).toBe(2);
    },
    120_000,
  );

  it("classifies a stall from a debug-trace file and writes an issue", async () => {
    const file = write("trace.json", { revision: 4, seats: [{ seat: 1, prompt: { id: "p" } }], worker: { busy: false }, bot: { seats: [{ seat: 1, policy: "scripted" }] } });
    const issuesDirectory = join(dir, "issues-stall");
    const result = await triage(file, { issuesDirectory });
    expect(result.code).toBe(2);
    expect(result.stallClass).toBe("bot");
    expect(result.owner).toBe("UNOWNED");
    expect(readdirSync(issuesDirectory)).toHaveLength(1);
    const ui = await triage(file, { issuesDirectory, noIssue: true, page: { revision: 4, promptVisible: false } });
    expect(ui.stallClass).toBe("bot");
  });
});

describe("issue registry", () => {
  const rows = loadOwners();

  it("matches the FZ known issue through an NFailure", () => {
    const info = { source: "fuzz-n", invariant: "hang", format: "ffa3", coreTag: "B2", pendingSeat: 1, pendingKind: "answer", detail: { kind: "wall-clock" }, message: "wall-clock: x" };
    expect(classifyKnown(info)?.id).toBe("b2-seat1-end-turn-hang");
    expect(classifyKnown({ ...info, coreTag: "T3" })).toBeNull();
    expect(classifyKnown({ ...info, pendingSeat: 2 })).toBeNull();
  });

  it("gives a stable signature that ignores digits in free text", () => {
    const a = signatureOf({ source: "nduel", invariant: "x", message: "seed 12 failed at step 7" });
    const b = signatureOf({ source: "nduel", invariant: "x", message: "seed 99 failed at step 1234" });
    const c = signatureOf({ source: "nduel", invariant: "x", message: "another problem" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("finds the owner by the core site in the text, else UNOWNED", () => {
    const site = failureInfoOf("x.json", { type: "nduel", reason: "", data: { n: 3, mode: "ffa", seed: 1, trap: "YGO_N_TRAP opponent_of at playerop.cpp:482" } });
    expect(ownerOfFailure(site, rows).owner).toBe("T3");
    expect(ownerOfFailure({ source: "nduel", site: { file: "playerop.cpp", line: 482, fn: "field::process(SelectChain)" } }, rows).owner).toBe("T3");
    expect(ownerOfFailure({ source: "nduel", message: "nothing" }, rows).owner).toBe("UNOWNED");
  });

  it("records an issue, keeps firstSeen and counts repeats", () => {
    const dir = mkdtempSync(join(tmpdir(), "issues-"));
    try {
      const base = { sig: "abc123abc123", owner: "T3", title: "t", repro: "r", source: "s" };
      const first = recordIssue(dir, { ...base, now: new Date("2026-01-01T00:00:00Z") });
      const second = recordIssue(dir, { ...base, owner: "T9", now: new Date("2026-01-02T00:00:00Z") });
      expect(first.count).toBe(1);
      expect(second).toMatchObject({ count: 2, firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-02T00:00:00.000Z", owner: "T9" });
      writeFileSync(join(dir, "broken.json"), "{");
      expect(readIssues(dir)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
