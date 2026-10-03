import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordIssue } from "../scripts/lib/issue-registry.js";
import { detectInput, failureInfoOf } from "../scripts/triage.js";

const base = { sig: "abc123abc123", owner: "T9", title: "t", repro: "r", source: "s" };
const read = (dir: string) => JSON.parse(readFileSync(join(dir, "abc123abc123.json"), "utf8"));

describe("recordIssue presetIds", () => {
  it("unions presets with the previous file, sorted, and keeps them when a run has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "issues-"));
    recordIssue(dir, base);
    expect(read(dir).presetIds).toBeUndefined();
    recordIssue(dir, { ...base, presetId: "b-preset" });
    recordIssue(dir, { ...base, presetId: "a-preset" });
    recordIssue(dir, { ...base, presetId: "a-preset" });
    expect(read(dir).presetIds).toEqual(["a-preset", "b-preset"]);
    recordIssue(dir, base);
    expect(read(dir).presetIds).toEqual(["a-preset", "b-preset"]);
  });
});

describe("failureInfoOf presetId", () => {
  it("reads it from a journal header", () => {
    const info = failureInfoOf("x.json", { type: "journal", data: { format: "yugidraft-duel-journal/1", presetId: "p1" } } as never);
    expect(info.presetId).toBe("p1");
  });
  it("reads it from a manual report folder, and omits it without a preset", () => {
    const dir = mkdtempSync(join(tmpdir(), "manual-"));
    const header = { format: "yugidraft-duel-journal/1", slug: "s", presetId: "p2" };
    writeFileSync(join(dir, "journal.jsonl"), JSON.stringify(header) + "\n");
    writeFileSync(join(dir, "note.md"), "# note\n");
    expect(failureInfoOf(dir, detectInput(dir)).presetId).toBe("p2");
    const plain = mkdtempSync(join(tmpdir(), "manual-"));
    writeFileSync(join(plain, "journal.jsonl"), JSON.stringify({ format: "yugidraft-duel-journal/1", slug: "s" }) + "\n");
    writeFileSync(join(plain, "note.md"), "# note\n");
    expect("presetId" in failureInfoOf(plain, detectInput(plain))).toBe(false);
  });
  it("reads it from the stall.json of a report folder without a journal header id", () => {
    const dir = mkdtempSync(join(tmpdir(), "stall-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stall.json"), JSON.stringify({ slug: "s", presetId: "p3" }));
    writeFileSync(join(dir, "note.md"), "# note\n");
    expect(failureInfoOf(dir, detectInput(dir)).presetId).toBe("p3");
  });
  it("reads it from a Playwright failure-summary.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-"));
    const file = join(dir, "failure-summary.json");
    writeFileSync(file, JSON.stringify({ test: { title: "preset run", status: "failed" }, presetId: "p4", errors: ["boom"] }));
    const detected = detectInput(file);
    expect(failureInfoOf(file, detected).presetId).toBe("p4");
    writeFileSync(file, JSON.stringify({ test: { title: "preset run", status: "failed" }, errors: ["boom"] }));
    expect("presetId" in failureInfoOf(file, detectInput(file))).toBe(false);
  });
});
