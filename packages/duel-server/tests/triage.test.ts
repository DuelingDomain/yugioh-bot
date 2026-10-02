import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectInput, detectJson, parseNduelLine, readManualJournal, triage } from "../scripts/triage.js";
import { loadSource } from "../scripts/lib/replay-source.js";

const NO_ISSUE = { noIssue: true } as const;
const deck = { main: [1, 2, 3], extra: [] };
const journalHeader = { format: "yugidraft-duel-journal/1", slug: "s", mode: "normal", masterRule: 5, seed: ["1", "2", "3", "4"], decks: [deck, deck], commands: [] };

describe("triage input detection", () => {
  let dir = "";
  const write = (name: string, value: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "triage-test-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("tells fuzz, differential and journal files apart", () => {
    const fuzz = { scenario: { seed: 1, mode: "normal", masterRule: 5 }, journal: [], decks: [deck, deck] };
    expect(detectJson(fuzz).type).toBe("fuzz");
    expect(detectJson({ ...fuzz, engine: {}, differential: {} }).type).toBe("differential");
    expect(detectJson(journalHeader).type).toBe("journal");
  });

  it("detects a stall file by name or by message, and tolerates an unknown shape", () => {
    expect(detectInput(write("stall-1.json", { anything: true })).type).toBe("stall");
    expect(detectJson({ slug: "x", message: "Duel x stalled: revision 3" }, "report.json").type).toBe("stall");
    expect(detectJson({ hello: 1 }, "other.json").type).toBe("unknown");
  });

  it("detects an nduel summary line, also inside a log", () => {
    expect(detectInput(write("line.json", { n: 3, mode: "ffa", seed: 7, ok: false })).type).toBe("nduel");
    const log = `== run\nnot json\n{"n":4,"mode":"tag","seed":9}\n`;
    expect(parseNduelLine(log)).toMatchObject({ n: 4, seed: 9 });
    expect(detectInput(write("run.log", log)).type).toBe("nduel");
    expect(parseNduelLine("nothing here")).toBeNull();
  });

  it("detects a manual folder with or without its files", () => {
    const full = join(dir, "manual", "case-1");
    mkdirSync(full, { recursive: true });
    expect(detectInput(full).type).toBe("manual");
    writeFileSync(join(full, "note.md"), "# note\n");
    writeFileSync(join(full, "journal.jsonl"), [JSON.stringify(journalHeader), JSON.stringify({ seat: 0, command: { promptId: "p", revision: 1, answer: {} } }), "garbage"].join("\n"));
    expect(detectInput(full).type).toBe("manual");
    const journal = readManualJournal(full);
    expect(journal?.commands).toHaveLength(1);
    const empty = join(dir, "plain");
    mkdirSync(empty);
    expect(detectInput(empty).type).toBe("directory");
    expect(detectInput(join(dir, "missing.json")).type).toBe("unknown");
  });

  it("exits 2 for nduel, a manual folder without a journal, and a stall without a journal", async () => {
    expect((await triage(write("n.json", { n: 3, mode: "ffa", seed: 7 }), NO_ISSUE)).code).toBe(2);
    const bare = join(dir, "manual", "case-2");
    mkdirSync(bare, { recursive: true });
    expect((await triage(bare, NO_ISSUE)).code).toBe(2);
    const stallDir = join(dir, "stalls");
    mkdirSync(stallDir);
    writeFileSync(join(stallDir, "stall-1.json"), JSON.stringify({ slug: "abc", message: "Duel abc stalled" }));
    const result = await triage(join(stallDir, "stall-1.json"), NO_ISSUE);
    expect(result.code).toBe(2);
    expect(result.lines.join("\n")).toContain("Duel abc stalled");
  });

  it("accepts a journal with more than two seats (the replay is the N-seat path)", async () => {
    const file = write("duel-journal-ffa.json", { ...journalHeader, decks: [deck, deck, deck, deck], setup: { firstTurnDraw: false } });
    const result = await triage(file, { noScenario: true, noIssue: true });
    expect(result.code).toBe(0);
    expect(result.lines.join("\n")).toContain("4 seats (ffa4)");
  });

  it("reports an unknown file with exit code 1", async () => {
    expect((await triage(write("junk.json", { hello: 1 }), NO_ISSUE)).code).toBe(1);
  });
});

describe("replay source of a differential file", () => {
  it("carries the engine block, scripts, settings, format and the core", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-source-test-"));
    try {
      const engine = {
        mode: "normal",
        masterRule: 3,
        decks: [{ main: [9], extra: [] }, { main: [8], extra: [] }],
        seed: ["5", "6", "7", "8"],
        startupScripts: [{ name: "a.lua", content: "-- x" }],
        format: "1v1",
      };
      const base = { scenario: { seed: 42, mode: "normal", masterRule: 5, maxSteps: 10 }, failure: { step: -1 }, decks: [deck, deck], journal: [{ seat: 0, promptId: "p", revision: 1, answer: {} }] };
      const file = join(dir, "local-scenarios-42.json");
      writeFileSync(file, JSON.stringify({ ...base, engine, differential: { mode: "scenarios", seed: 42, scenarioId: "x", found: "multi", multiWasm: "a/multi.wasm", referenceWasm: "a/ref.wasm" } }));
      const source = loadSource(file);
      expect(source).toMatchObject({ mode: "normal", masterRule: 3, seed: ["5", "6", "7", "8"], format: "1v1", wasmPath: "a/multi.wasm" });
      expect(source.decks).toEqual(engine.decks);
      expect(source.startupScripts).toEqual(engine.startupScripts);
      expect(source.label).toContain("scenarios seed 42 x");

      const self = join(dir, "self.json");
      writeFileSync(self, JSON.stringify({ ...base, engine, differential: { mode: "long", seed: 1, found: "reference-self-check", multiWasm: "m.wasm", referenceWasm: "r.wasm" } }));
      expect(loadSource(self).wasmPath).toBe("r.wasm");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reads an old file with no engine block", () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-source-test-"));
    try {
      const file = join(dir, "old.json");
      writeFileSync(file, JSON.stringify({ scenario: { seed: 3, mode: "domain", masterRule: 5 }, failure: { step: 4 }, decks: [deck, deck], journal: [] }));
      const source = loadSource(file);
      expect(source).toMatchObject({ mode: "domain", masterRule: 5, failureStep: 4 });
      expect(source.seed).toHaveLength(4);
      expect(source.wasmPath).toBeUndefined();
      expect(source.startupScripts).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
