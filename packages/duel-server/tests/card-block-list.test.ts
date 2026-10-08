import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardBlockIndex, mergeCardBlockEntries, loadCardBlockList } from "../src/card-block-list.js";

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

it("reuses indexes across alternating admission lists", () => {
  const catalog = new Map([[10, { alias: 0 }], [11, { alias: 10 }]]);
  const first = [{ code: 10, reason: "first" }], second = [{ code: 11, reason: "second" }];
  const index = cardBlockIndex(catalog, first);
  cardBlockIndex(catalog, second);
  expect(cardBlockIndex(catalog, first)).toBe(index);
});

it("memoizes merged manual/automatic entries until one source changes", () => {
  const manual = [{ code: 10, reason: "manual" }], automatic = [{ code: 20, reason: "auto" }];
  const merged = mergeCardBlockEntries(manual, automatic);
  expect(mergeCardBlockEntries(manual, automatic)).toBe(merged);
  expect(mergeCardBlockEntries(manual, [...automatic])).not.toBe(merged);
  expect(mergeCardBlockEntries(manual, [])).toBe(manual);
});

it("automatic blocks affect only the exact passcode and its validated remaps", () => {
  const catalog = new Map([[10, { alias: 0 }], [11, { alias: 10 }], [100, { alias: 10 }], [200, { alias: 100 }]]);
  const automatic = [{ code: 10, reason: "auto", exactCodes: [10, 400000010] }];
  const blocked = cardBlockIndex(catalog, automatic);
  expect([...blocked.keys()].sort((a, b) => a - b)).toEqual([10, 400000010]);
  expect(blocked.has(11)).toBe(false);
  expect(blocked.has(100)).toBe(false);
  const manual = cardBlockIndex(catalog, [{ code: 200, reason: "manual" }, ...automatic]);
  expect(manual.get(10)?.reason).toBe("manual");
  expect(manual.get(100)?.reason).toBe("manual");
  expect(manual.get(400000010)?.reason).toBe("auto");
});
