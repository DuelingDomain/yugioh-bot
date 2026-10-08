import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createAutoBlockPolicy, clearAutoBlock, autoBlockConfigFromEnv } from "../src/script-error-autoblock.js";
import { createScriptErrorRecorder } from "../src/script-error-store.js";
import { cardBlockIndex } from "../src/card-block-list.js";
import type { DuelScriptError } from "../src/script-errors.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { clearRemappedAutoBlock } from "../src/clear-script-auto-block.js";

const error: DuelScriptError = { code: 10, scriptFile: "c10.lua", line: 1, message: "private Lua text",
  index: 1, mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "tolerant" };
const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); });
function setup(singleAccount = false) {
  const db = new Database(":memory:"); databases.push(db); migrate(db); migrate(db);
  const accounts = ["a", "b"].map(name => seedUser(db, name).userId);
  const players = accounts.map((userId, index) => seedIdentity(db, { guildId: "g", name: `Human ${index}`, userId }).playerId);
  for (let id = 1; id <= 10; id++) {
    const player = players[singleAccount ? 0 : id % 2]!;
    db.prepare("INSERT INTO duels (id, guild_id, web_slug, name, organizer_player_id, mode, status) VALUES (?, 'g', ?, 'Test', ?, 'normal', 'active')").run(id, `duel-${id}`, player);
    db.prepare("INSERT INTO duel_seats (duel_id, seat, player_id, is_bot, ready) VALUES (?, 0, ?, 0, 1)").run(id, player);
    db.prepare("INSERT INTO duel_seats (duel_id, seat, player_id, is_bot, ready) VALUES (?, 1, NULL, 1, 1)").run(id);
  }
  let time = Date.parse("2026-10-07T12:00:00Z"), hash = "a".repeat(64);
  const policy = createAutoBlockPolicy(db, { bundleVersion: "bundle-1", scriptHash: () => hash,
    remaps: new Map([[400000010, 10]]), now: () => time });
  const record = createScriptErrorRecorder(db, () => {}, policy);
  return { db, policy, record, advance: (days: number) => { time += days * 86400000; },
    changeScript: (refresh = true) => { hash = "b".repeat(64); if (refresh) policy.refresh(); }, now: () => time };
}

describe("script error automatic admission blocks", () => {
  it("lifts only the row whose startup hash fails and logs the failure once", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, error));
    t.db.exec(`INSERT INTO card_script_auto_blocks
      SELECT 20, reason, blocked_at, distinct_duels, error_count, threshold, window_days,
        bundle_version, script_hash, cleared_at, engine_kind FROM card_script_auto_blocks WHERE code = 10`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const policy = createAutoBlockPolicy(t.db, { bundleVersion: "b", now: t.now, scriptHash: code => {
        if (code === 10) throw new Error("Unsupported legacy chain.lua snapshot layout");
        return "a".repeat(64);
      } });
      expect(policy.entries().map(entry => entry.code)).toEqual([20]);
      expect(t.db.prepare("SELECT cleared_at FROM card_script_auto_blocks WHERE code = 10").get()).toEqual({ cleared_at: new Date(t.now()).toISOString() });
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ event: "card_script_auto_block_hash_failed", code: 10, engineKind: "pinned-normal", failure: "Unsupported legacy chain.lua snapshot layout" });
    } finally { log.mockRestore(); }
  });

  it("counts distinct duels rather than error events or retries", () => {
    const { db, policy, record } = setup();
    for (let index = 1; index <= 30; index++) record(1, { ...error, index });
    record(2, error); record(2, error);
    expect(policy.entries()).toEqual([]);
    record(3, error);
    expect(policy.entries()).toEqual([{ code: 10, reason: "Its effect script is being investigated", exactCodes: [10, 400000010] }]);
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of ["0", "1", "no", "1.5", "1000001"]) {
      vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", value);
      expect(autoBlockConfigFromEnv().threshold).toBe(3);
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("DUEL_SCRIPT_ERROR_BLOCK_DUELS"));
    }
    vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_DUELS", "3"); vi.stubEnv("DUEL_SCRIPT_ERROR_BLOCK_WINDOW_DAYS", "31");
    expect(autoBlockConfigFromEnv().windowDays).toBe(7);
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("DUEL_SCRIPT_ERROR_BLOCK_WINDOW_DAYS"));
    warn.mockRestore();
  });
  it("keeps admission arrays stable and performs no writes or revision work on reads", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, error));
    const first = t.policy.entries("pinned-normal");
    t.db.pragma("query_only = ON");
    expect(t.policy.entries("pinned-normal")).toBe(first);
    t.changeScript(false);
    expect(t.policy.entries("pinned-normal")).toBe(first);
    t.db.pragma("query_only = OFF");
    t.policy.refresh();
    expect(t.policy.entries("pinned-normal")).toEqual([]);
    expect(t.policy.entries("pinned-normal")).toBe(t.policy.entries("pinned-normal"));
  });
  it("observes an external operator clear without rebuilding unchanged admission arrays", () => {
    const t = setup(); [1, 2, 3].forEach(id => t.record(id, error));
    const first = t.policy.entries("pinned-normal");
    clearAutoBlock(t.db, 10, t.now());
    expect(t.policy.entries("pinned-normal")).not.toBe(first);
    expect(t.policy.entries("pinned-normal")).toEqual([]);
  });
  it("one account cannot trigger a block with three practice-bot duels", () => {
    const t = setup(true);
    [1, 2, 3].forEach(id => t.record(id, error));
    expect(t.policy.entries()).toEqual([]);
  });
  it("different gameplay player ids for the same account still count as one human", () => {
    const t = setup(true);
    const account = (t.db.prepare("SELECT user_id FROM players LIMIT 1").get() as { user_id: number }).user_id;
    const other = seedIdentity(t.db, { guildId: "other", name: "Same account", userId: account }).playerId;
    t.db.prepare("UPDATE duel_seats SET player_id = ? WHERE duel_id = 3 AND is_bot = 0").run(other);
    [1, 2, 3].forEach(id => t.record(id, error));
    expect(t.policy.entries()).toEqual([]);
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
