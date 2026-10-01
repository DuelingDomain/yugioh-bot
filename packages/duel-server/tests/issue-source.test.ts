import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createIssueSource } from "../src/presets/issue-source.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "issue-source-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createIssueSource", () => {
  it("links issues to presets, skips bad and unlinked files", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.json"), JSON.stringify({ sig: "a1", owner: "T3", title: "A", presetId: "p1" }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ sig: "b2", owner: "T9", title: "B", presetIds: ["p1", "p2"] }));
    writeFileSync(join(dir, "bad.json"), "{not json");
    writeFileSync(join(dir, "nolink.json"), JSON.stringify({ sig: "c3", owner: "T1", title: "C", repro: "x" }));
    writeFileSync(join(dir, "note.txt"), "ignored");
    const source = createIssueSource(dir);
    expect(source("p1")).toEqual([
      { sig: "a1", owner: "T3", title: "A" },
      { sig: "b2", owner: "T9", title: "B" },
    ]);
    expect(source("p2")).toEqual([{ sig: "b2", owner: "T9", title: "B" }]);
    expect(source("p3")).toEqual([]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(createIssueSource(join(tempDir(), "missing"))("p1")).toEqual([]);
  });

  it("reads the directory at most once every 10 seconds", () => {
    const dir = tempDir();
    let clock = 1000;
    const source = createIssueSource(dir, () => clock);
    expect(source("p1")).toEqual([]);
    writeFileSync(join(dir, "a.json"), JSON.stringify({ sig: "a1", owner: "o", title: "t", presetId: "p1" }));
    clock += 9_000;
    expect(source("p1")).toEqual([]);
    clock += 1_500;
    expect(source("p1")).toHaveLength(1);
  });
});
