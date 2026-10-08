import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createAutoBlockPolicy, clearAutoBlock, autoBlockConfigFromEnv } from "../src/script-error-autoblock.js";
import { createScriptErrorRecorder } from "../src/script-error-store.js";
import { cardBlockIndex } from "../src/card-block-list.js";
import type { DuelScriptError } from "../src/script-errors.js";
import { clearRemappedAutoBlock } from "../src/clear-script-auto-block.js";

const error: DuelScriptError = { code: 10, scriptFile: "c10.lua", line: 1, message: "private Lua text",
  index: 1, mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "tolerant" };
const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });
function setup() {
  const db = new Database(":memory:"); databases.push(db); migrate(db); migrate(db);
  let time = Date.parse("2026-10-07T12:00:00Z"), hash = "a".repeat(64);
  const policy = createAutoBlockPolicy(db, { bundleVersion: "bundle-1", scriptHash: () => hash,
    remaps: new Map([[400000010, 10]]), now: () => time });
  const record = createScriptErrorRecorder(db, () => {}, policy);
  return { db, policy, record, advance: (days: number) => { time += days * 86400000; },
    changeScript: () => { hash = "b".repeat(64); }, now: () => time };
}

describe("script error automatic admission blocks", () => {
  it("counts distinct duels rather than error events or retries", () => {
    const { db, policy, record } = setup();
    for (let index = 1; index <= 30; index++) record(1, { ...error, index });
    record(2, error); record(2, error);
    expect(policy.entries()).toEqual([]);
    record(3, error);
    expect(policy.entries()).toEqual([{ code: 10, reason: "Its effect script is being investigated" }]);
    expect(db.prepare("SELECT * FROM card_script_auto_blocks").get()).toMatchObject({
      code: 10, distinct_duels: 3, error_count: 22, threshold: 3, window_days: 7,
      script_hash: "a".repeat(64), bundle_version: "bundle-1", cleared_at: null });
    expect(JSON.stringify(policy.entries())).not.toContain("private Lua text");
  });
  it("excludes old errors, includes the exact window boundary, and excludes future errors", () => {
    const { policy, record, advance } = setup();
    record(1, error); advance(7); record(2, error);
    expect(policy.entries()).toEqual([]);
    record(3, error); expect(policy.entries()).toHaveLength(1);
    const other = setup(); other.record(1, error); other.advance(8); other.record(2, error); other.record(3, error);
    expect(other.policy.entries()).toEqual([]);
    const future = setup(); future.record(1, error); future.advance(-1); future.record(2, error); future.record(3, error);
    expect(future.policy.entries()).toEqual([]);
  });
  it("lifts on a changed script and starts a fresh threshold for the new revision", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, error));
    expect(t.policy.entries()).toHaveLength(1);
    // A bundle change with identical script bytes keeps the admission block.
    const same = createAutoBlockPolicy(t.db, { bundleVersion: "bundle-2", scriptHash: () => "a".repeat(64), now: t.now });
    expect(same.entries()).toHaveLength(1);
    t.changeScript(); expect(t.policy.entries()).toEqual([]);
    t.advance(0.001); t.record(4, error); t.record(5, error);
    expect(t.policy.entries()).toEqual([]);
    t.record(6, error); expect(t.policy.entries()).toHaveLength(1);
  });
  it("operator clear grants a fresh chance without removing telemetry", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, error));
    expect(clearAutoBlock(t.db, 10, t.now())).toBe(true);
    expect(t.policy.entries()).toEqual([]);
    expect(t.db.prepare("SELECT count(*) AS n FROM card_script_error_occurrences").get()).toEqual({ n: 3 });
    t.advance(0.001); t.record(4, error); expect(t.policy.entries()).toEqual([]);
  });
  it("strict errors cannot trigger a block and strict admission ignores auto blocks", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, { ...error, scriptErrorMode: "strict" }));
    expect(t.policy.entries()).toEqual([]);
    [4, 5, 6].forEach(id => t.record(id, error));
    vi.stubEnv("DUEL_SCRIPT_ERRORS", "strict");
    expect(createAutoBlockPolicy(t.db, { bundleVersion: "b", scriptHash: () => "a".repeat(64) }).entries()).toEqual([]);
  });
  it("resolves graduated passcodes before counting and gives manual aliases precedence", () => {
    const t = setup(); t.record(1, { ...error, code: 400000010 }); t.record(2, error); t.record(3, error);
    const catalog = new Map([[10, { alias: 0 }], [11, { alias: 10 }]]);
    const entries = [{ code: 11, reason: "Manual reason" }, ...t.policy.entries()];
    expect(cardBlockIndex(catalog, entries).get(10)?.reason).toBe("Manual reason");
    expect(t.policy.entries()[0]?.code).toBe(10);
  });
  it("scopes multiplayer failures independently from 1v1 engines", () => {
    const t = setup();
    [1, 2, 3].forEach(id => t.record(id, { ...error, format: "tag" }));
    expect(t.policy.entries("multi-normal")).toHaveLength(1);
    expect(t.policy.entries("pinned-normal")).toEqual([]);
    expect(t.policy.entries("legacy-normal")).toEqual([]);
    [4, 5, 6].forEach(id => t.record(id, error));
    expect(t.policy.entries("pinned-normal")).toHaveLength(1);
    expect(t.policy.entries("multi-normal")).toHaveLength(1);
  });
  it("validates environment thresholds and windows within retained telemetry", () => {
    expect(autoBlockConfigFromEnv()).toEqual({ threshold: 3, windowDays: 7 });
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "4"); vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_WINDOW_DAYS", "14");
    expect(autoBlockConfigFromEnv()).toEqual({ threshold: 4, windowDays: 14 });
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "0"); expect(() => autoBlockConfigFromEnv()).toThrow();
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "3"); vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_WINDOW_DAYS", "31");
    expect(() => autoBlockConfigFromEnv()).toThrow();
  });
  it("counts and clears historical codes through the current bundle's validated remaps", () => {
    const t = setup();
    const old = createAutoBlockPolicy(t.db, { bundleVersion: "old", scriptHash: () => "a".repeat(64), now: t.now });
    const recordOld = createScriptErrorRecorder(t.db, () => {}, old);
    recordOld(1, { ...error, code: 400000010 }); recordOld(2, { ...error, code: 400000010 });
    t.record(3, error); expect(t.policy.entries()).toHaveLength(1);
    expect(clearRemappedAutoBlock(t.db, 400000010, new Map([[400000010, 10]]), t.now())).toBe(1);
    t.advance(0.001); t.record(4, error); expect(t.policy.entries()).toEqual([]);
  });
});
