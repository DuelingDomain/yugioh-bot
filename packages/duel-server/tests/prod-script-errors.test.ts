import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { prodScriptErrors } from "../src/prod-script-errors.js";
import { createAutoBlockPolicy } from "../src/script-error-autoblock.js";
import { createScriptErrorRecorder } from "../src/script-error-store.js";
import { prodScriptErrorReport } from "../scripts/engine-data-report.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import type { CardDatabase } from "../src/cards.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
const cards = { deckCard: (code: number) => ({ code, name: `Card ${code}`, alias: code === 11 ? 10 : 0 }),
  readScript: (name: string) => name === "c10.lua" ? "return 10" : "return 20" } as CardDatabase;

it("exports only card identities, distinct duel counts and status from a read-only snapshot", () => {
  const db = new Database(":memory:"); dbs.push(db); migrate(db);
  const insert = db.prepare("INSERT INTO card_script_error_occurrences (duel_id, command_hash, error_index, code, created_at) VALUES (?, 'x', ?, ?, ?)");
  insert.run(1, 1, 400000010, "2026-10-01T00:00:00Z"); insert.run(1, 2, 10, "2026-10-02T00:00:00Z");
  insert.run(2, 1, 10, "2026-10-07T00:00:00Z"); insert.run(3, 1, 10, "2026-09-29T00:00:00Z");
  insert.run(4, 1, 10, "2026-10-09T00:00:00Z");
  db.prepare(`INSERT INTO card_script_auto_blocks (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash, cleared_at) VALUES (?, 'private reason', '2026-09-01', 3, 7, 3, 7, 'bundle', ?, NULL)`)
    .run(20, cardScriptHash(cards, 20));
  db.pragma("query_only = ON");
  const result = prodScriptErrors(db, cards, new Map([[400000010, 10]]), Date.parse("2026-10-08T00:00:00Z"));
  expect(result.cards).toEqual([
    { code: 10, name: "Card 10", distinctDuels: 2, errorCount: 3, autoBlocked: false, scriptHash: cardScriptHash(cards, 10) },
    { code: 20, name: "Card 20", distinctDuels: 0, errorCount: 0, autoBlocked: true, scriptHash: cardScriptHash(cards, 20), engineKind: "all" },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/duel_id|command_hash|private|bundle|scriptFile|discord/i);
});
it("uses core near-code aliases and ignores blocks whose installed script changed", () => {
  expect(cardScriptHash(cards, 11)).toBe(cardScriptHash(cards, 10));
  const db = new Database(":memory:"); dbs.push(db); migrate(db);
  db.prepare("INSERT INTO card_script_auto_blocks (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash, cleared_at) VALUES (10, 'reason', '2026-09-01', 3, 3, 3, 7, 'b', ?, NULL)").run("f".repeat(64));
  expect(prodScriptErrors(db, cards, new Map()).cards).toEqual([]);
});
it("caps output while retaining blocked cards before nonblocked top errors", () => {
  const db = new Database(":memory:"); dbs.push(db); migrate(db);
  const insert = db.prepare("INSERT INTO card_script_error_occurrences (duel_id, command_hash, error_index, code) VALUES (1, 'x', ?, ?)");
  for (let code = 1; code <= 30; code++) insert.run(code, code);
  db.prepare("INSERT INTO card_script_auto_blocks (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash, cleared_at) VALUES (99, 'r', CURRENT_TIMESTAMP, 3, 3, 3, 7, 'b', ?, NULL)").run(cardScriptHash(cards, 99));
  const result = prodScriptErrors(db, cards, new Map());
  expect(result.cards).toHaveLength(21); expect(result.cards.some(card => card.code === 99 && card.autoBlocked)).toBe(true);
});
it("the public CLI neither migrates an old database nor exposes its failure diagnostics", () => {
  const dir = mkdtempSync(join(tmpdir(), "prod-cli-")), path = join(dir, "old.sqlite");
  try {
    const old = new Database(path); old.exec("CREATE TABLE private_player_data (discord_id TEXT)"); old.close();
    const before = readFileSync(path);
    const output = execFileSync(process.execPath, ["--import", "tsx", new URL("../src/prod-script-errors.ts", import.meta.url).pathname], {
      encoding: "utf8", env: { ...process.env, DATABASE_PATH: path }, stdio: ["ignore", "pipe", "pipe"],
    });
    expect(JSON.parse(output)).toEqual({ available: false }); expect(readFileSync(path)).toEqual(before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("a helper-only fix lifts a block and the candidate report announces the lift", () => {
  const db = new Database(":memory:"); dbs.push(db); migrate(db);
  let helper = "broken";
  const source = { ...cards, scriptNames: () => ["c10.lua", "proc_x.lua"], readScript: (name: string) => name === "proc_x.lua" ? helper : "unchanged card" };
  const policy = createAutoBlockPolicy(db, { bundleVersion: "b", scriptHash: (code, kind) => cardScriptHash(source, code, kind) });
  const record = createScriptErrorRecorder(db, () => {}, policy);
  for (const id of [1, 2, 3]) {
    const player = seedIdentity(db, { guildId: "g", name: `Human ${id}`, userId: seedUser(db, `helper-${id}`).userId }).playerId;
    db.prepare("INSERT INTO duels (id, guild_id, web_slug, name, organizer_player_id, mode, status) VALUES (?, 'g', ?, 'Test', ?, 'normal', 'active')").run(id, `duel-${id}`, player);
    db.prepare("INSERT INTO duel_seats (duel_id, seat, player_id, is_bot, ready) VALUES (?, 0, ?, 0, 1)").run(id, player);
  }
  for (const id of [1, 2, 3]) record(id, { code: 10, scriptFile: "proc_x.lua", line: 1, message: "error", index: 1, mode: "normal", format: "1v1", engine: "pinned", scriptErrorMode: "tolerant" });
  expect(policy.entries("pinned-normal")).toHaveLength(1);
  const snapshot = prodScriptErrors(db, source, new Map());
  helper = "fixed";
  expect(prodScriptErrorReport(snapshot, (code, kind) => cardScriptHash(source, code, kind))).toContain("auto block will lift");
  expect(policy.entries()).toEqual([]);
});
