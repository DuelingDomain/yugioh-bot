import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardBlockIndex, loadCardBlockList } from "../src/card-block-list.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function policy(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "card-block-policy-"));
  dirs.push(dir);
  const path = join(dir, "card-block-list.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("repository card block list", () => {
  it("ships empty and loads passcodes with a trimmed operator reason", () => {
    expect(loadCardBlockList()).toEqual([]);
    expect(loadCardBlockList(policy([{ code: 3743515, reason: "  Broken effect  " }]))).toEqual([
      { code: 3743515, reason: "Broken effect" },
    ]);
  });

  it.each([
    null, {}, [null], [17], [{ code: 0, reason: "Broken" }], [{ code: -1, reason: "Broken" }],
    [{ code: 1.5, reason: "Broken" }], [{ code: 0x100000000, reason: "Broken" }],
    [{ code: "10", reason: "Broken" }], [{ code: 10 }], [{ code: 10, reason: " " }],
    [{ code: 10, reason: 7 }], [{ code: 10, reason: "One" }, { code: 10, reason: "Two" }],
  ].map(value => [value]))("rejects invalid policy %j instead of silently allowing cards", (value) => {
    expect(() => loadCardBlockList(policy(value))).toThrow(/card-block-list/i);
  });

  it("fails clearly when the policy file is missing or malformed", () => {
    const path = policy([]);
    writeFileSync(path, "[");
    expect(() => loadCardBlockList(path)).toThrow(/card-block-list/i);
    expect(() => loadCardBlockList(`${path}.missing`)).toThrow(/card-block-list/i);
  });

  it("covers reverse aliases and cycles without merging unrelated cards", () => {
    const catalog = new Map([[10, { alias: 11 }], [11, { alias: 10 }], [12, { alias: 11 }], [20, { alias: 0 }]]);
    const entries = loadCardBlockList(policy([{ code: 12, reason: "Broken" }]));
    const blocked = cardBlockIndex(catalog, entries);
    expect([...blocked.keys()].sort((a, b) => a - b)).toEqual([10, 11, 12]);
    expect(blocked.get(10)).toEqual({ code: 12, reason: "Broken" });
    expect(cardBlockIndex(catalog, [])).toEqual(new Map());
  });
});
