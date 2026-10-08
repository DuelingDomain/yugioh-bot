import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createScriptErrorRecorder, topScriptErrors } from "../src/script-error-store.js";
import type { DuelScriptError } from "../src/script-errors.js";

const error: DuelScriptError = { code: 3743515, scriptFile: "c3743515.lua", line: 61,
  message: 'c3743515.lua:61: attempt to index a nil value', index: 1,
  mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "tolerant" };

describe("persistent script error counters", () => {
  it("caps writes at 20 per duel/card across recorder restarts without limiting another card or duel", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      const log = vi.fn();
      const record = createScriptErrorRecorder(db, log);
      for (let index = 1; index <= 40; index++) record(100, { ...error, index });
      const recovered = createScriptErrorRecorder(db, log);
      expect(recovered(100, { ...error, index: 41 })).toBe(false);
      expect(recovered(100, { ...error, code: 123, index: 42 })).toBe(true);
      expect(recovered(101, error)).toBe(true);
      expect(topScriptErrors(db).map(row => [row.code, row.count])).toEqual([[3743515, 21], [123, 1]]);
      expect(log).toHaveBeenCalledTimes(22);
      expect(db.prepare("SELECT count(*) AS n FROM card_script_error_occurrences").get()).toEqual({ n: 22 });
    } finally { db.close(); }
  });
  it("migrates idempotently and counts deterministic occurrences once across recovery", () => {
    const db = new Database(":memory:");
    try {
      migrate(db); migrate(db);
      const log = vi.fn();
      const record = createScriptErrorRecorder(db, log);
      expect(record(100, error)).toBe(true);
      expect(record(100, error)).toBe(false);
      expect(record(100, { ...error, index: 2 })).toBe(true);
      expect(record(101, error)).toBe(true);
      expect(topScriptErrors(db)).toEqual([expect.objectContaining({ code: 3743515, count: 3, last_message: error.message, last_script_file: "c3743515.lua", last_line: 61, last_duel_id: 101, last_mode: "normal" })]);
      expect(log).toHaveBeenCalledTimes(3);
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ event: "card_script_error", duelId: 100, ...error });
      expect(topScriptErrors(db)[0]?.last_seen).toMatch(/^\d{4}-/);
    } finally { db.close(); }
  });
  it("counts distinct rejected command branches even when recovery reuses an ordinal", () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      const record = createScriptErrorRecorder(db, () => {});
      expect(record(100, { ...error, scriptErrorMode: "strict", commandHash: "attempt-a" })).toBe(true);
      expect(record(100, { ...error, code: 2, scriptErrorMode: "strict", commandHash: "attempt-b" })).toBe(true);
      expect(record(100, { ...error, scriptErrorMode: "strict", commandHash: "attempt-a" })).toBe(false);
      expect(topScriptErrors(db).map((row) => [row.code, row.count])).toEqual([[2, 1], [3743515, 1]]);
    } finally { db.close(); }
  });
  it("orders top cards by count then code and retains strict failures", () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      const record = createScriptErrorRecorder(db, () => {});
      record(100, { ...error, code: 2, index: 1, scriptErrorMode: "strict" });
      record(100, { ...error, code: 1, index: 2 });
      record(100, { ...error, code: 2, index: 3 });
      expect(topScriptErrors(db, 1).map((row) => [row.code, row.count])).toEqual([[2, 2]]);
      expect(topScriptErrors(db).map((row) => row.code)).toEqual([2, 1]);
    } finally { db.close(); }
  });
  it("keeps a telemetry storage failure from rejecting a recovered card effect", () => {
    const db = new Database(":memory:");
    migrate(db);
    const log = vi.fn();
    const record = createScriptErrorRecorder(db, log);
    db.close();
    expect(() => record(100, error)).not.toThrow();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ event: "card_script_error_persistence_failed", duelId: 100 });
  });
});
