import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { defaultDuelSettings, seatCountFor } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardDatabase } from "../src/cards.js";
import { loadMultiScriptsFor } from "../src/multi-scripts.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: (path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    if (String(path).endsWith("/card-block-list.json")) return JSON.stringify([{ code: 89631139, reason: "Repeated script errors under investigation" }, { code: 77585513, reason: "Repeated script errors under investigation" }]);
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
  } };
});

const SECRET = "blocked-start";
let DATA: string;
beforeAll(() => {
  DATA = mkdtempSync(join(tmpdir(), "host-card-block-list-"));
  writeFileSync(join(DATA, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
  writeFileSync(join(DATA, "strings.conf"), "");
  mkdirSync(join(DATA, "card-scripts"));
  // Pass the host's installed-file guards; blocked cards must prevent any core load.
  for (const file of ["ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) writeFileSync(join(DATA, file), "fixture");
  const cards = new Database(join(DATA, "cards.cdb"));
  try {
    cards.exec(`CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER,
      type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER);
      CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT);
      INSERT INTO datas VALUES
        (89631139,3,0,0,17,3000,2500,8,8192,16),
        (77585513,3,0,0,33,2400,1500,6,32,32),
        (44095762,3,0,0,4,0,0,0,0,0),
        (15025844,3,0,0,17,800,2000,4,2,16);
      INSERT INTO texts VALUES
        (89631139,'Blue-Eyes White Dragon',''),(77585513,'Jinzo',''),
        (44095762,'Mirror Force',''),(15025844,'Mystical Elf','');`);
  } finally { cards.close(); }
});
afterAll(() => { rmSync(DATA, { recursive: true, force: true }); });
const hosts: DuelHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.close(); vi.unstubAllEnvs(); });

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const result = await host.handle(new Request("http://local/internal/duel", { method: "POST", headers: { "content-type": "application/json", "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") }, body: raw }));
  return { status: result.status, data: await result.json() as any };
}

it.each((["1v1", "tag", "ffa3", "ffa4"] as const).flatMap((format) => (["normal", "domain"] as const).map((mode) => ({ format, mode }))))("$format $mode: refuses a saved blocked deck at start even when validation is disabled", async ({ format, mode }) => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const db = new Database(":memory:");
  migrate(db);
  const players = Array.from({ length: seatCountFor(format) }, (_, i) => seedIdentity(db, { guildId: "g", name: `P${i}`, userId: seedUser(db, `block${i}`).userId }).playerId);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Blocked", format, mode, settings: { ...defaultDuelSettings(mode), validateDeck: false, banlist: "none" } });
  players.slice(1).forEach((player) => duels.takeSeat(session.slug, "g", player));
  players.forEach((player) => duels.setDeck(session.slug, "g", player, { main: Array(40).fill(89631139), extra: [], side: [], ...(mode === "domain" ? { deckMaster: 89631139 } : {}) }));
  const createWorker = vi.fn(() => { throw new Error("Blocked deck must be refused before creating a core"); });
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], createWorker }); hosts.push(host);
  try {
    const result = await post(host, { op: "start", slug: session.slug, guildId: "g", playerId: players[0] });
    expect(result.status).toBe(400);
    expect(result.data.error).toContain("Blue-Eyes White Dragon is unavailable: Repeated script errors under investigation");
    expect(createWorker).not.toHaveBeenCalled();
    expect(duels.get(session.slug, "g").status).toBe("lobby");
    const details = await post(host, { op: "card-details", codes: [89631139], guildId: "g", playerId: players[0] });
    expect(details.status).toBe(200);
    expect(details.data.cards[0].unavailableReason).toBe("Repeated script errors under investigation");
  } finally { await host.close(); hosts.splice(hosts.indexOf(host), 1); db.close(); }
});


it("refuses a blocked preset board card before creating a session or core", async () => {
  vi.stubEnv("DUEL_SCENARIOS", "1");
  const db = new Database(":memory:"); migrate(db);
  const player = seedIdentity(db, { guildId: "g", name: "P0", userId: seedUser(db, "preset").userId }).playerId;
  const createWorker = vi.fn(() => { throw new Error("Blocked board must not create a core"); });
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], createWorker }); hosts.push(host);
  try {
    const result = await post(host, { op: "start-preset", presetId: "jinzo-stops-trap", guildId: "g", playerId: player });
    expect(result.status).toBe(400);
    expect(result.data.error).toContain("Jinzo is unavailable: Repeated script errors under investigation");
    expect(createWorker).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM duels").get()).toEqual({ n: 0 });
  } finally { await host.close(); hosts.splice(hosts.indexOf(host), 1); db.close(); }
});

it.each([
  { presetId: "raigeki-dark-hole-tag", code: 12580477, kind: "multi-normal" as const },
  { presetId: "dust-tornado-chain", code: 5318639, kind: "pinned-normal" as const },
])("$presetId checks its actual engine scope when 1v1 defaults to legacy", async ({ presetId, code, kind }) => {
  vi.stubEnv("DUEL_SCENARIOS", "1"); vi.stubEnv("MULTIPLAYER_TABLES", "1"); vi.stubEnv("DUEL_1V1_ENGINE", "legacy");
  const db = new Database(":memory:"); migrate(db);
  const player = seedIdentity(db, { guildId: "g", name: "P", userId: seedUser(db, presetId).userId }).playerId;
  db.prepare(`INSERT INTO card_script_auto_blocks (code, reason, blocked_at, distinct_duels, error_count, threshold, window_days, bundle_version, script_hash, engine_kind)
    VALUES (?, 'reason', CURRENT_TIMESTAMP, 3, 3, 3, 7, 'test', ?, ?)`)
    .run(code, cardScriptHash(loadCardDatabase(DATA), code, kind, kind === "multi-normal" ? loadMultiScriptsFor(DATA) : undefined), kind);
  const createWorker = vi.fn(() => { throw new Error("Blocked board must not create a core"); });
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], createWorker });
  try {
    const result = await post(host, { op: "start-preset", presetId, guildId: "g", playerId: player });
    expect(result.status).toBe(400);
    expect(result.data.error).toContain("is unavailable");
    expect(createWorker).not.toHaveBeenCalled();
  } finally { await host.close(); db.close(); }
});
