import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../src/db/index.js";
import { createDraftService } from "../src/services/drafts.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";

const resources: Array<{ db: Database.Database; directory: string }> = [];
const workers: Worker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.terminate()));
  for (const { db, directory } of resources.splice(0)) { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "draft-terminal-race-"));
  const path = join(directory, "test.sqlite");
  const db = new Database(path); resources.push({ db, directory });
  db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 5000"); migrate(db);
  const host = seedUser(db, "host");
  const players = [host, seedUser(db, "guest")].map(user => seedIdentity(db, {
    guildId: "g", userId: user.userId, discordUserId: user.discordUserId,
  }).playerId);
  const insert = db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,'Normal Monster','normal','i','i','[]','t')`);
  for (let id = 1; id <= 8; id++) insert.run(id, `Card ${id}`);
  const drafts = createDraftService(db, { seedSource: () => 7 });
  const draft = drafts.create("g", "c", "Race", { customCardIds: [1,2,3,4,5,6,7,8], packSize: 2,
    packsPerPlayer: 2, cardsPerPlayer: 4, pickSeconds: 30 }, host.userId, players[0]);
  drafts.join(draft.id, players[1]); drafts.start(draft.id, new Date("2030-01-01"));
  return { db, path, drafts, draft, players, cardId: drafts.pickOptions(draft.id, players[0])[0].id };
}

// Each worker holds its own SQLite connection. The barrier releases both at once.
function runWorker(ctx: ReturnType<typeof setup>, action: string, gate: SharedArrayBuffer) {
  const worker = new Worker(`
    require('tsx/cjs');
    const { parentPort, workerData: data } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const { createDraftService } = require(data.servicePath);
    const db = new Database(data.path);
    db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON');
    const drafts = createDraftService(db);
    parentPort.postMessage({ ready: true });
    Atomics.wait(new Int32Array(data.gate), 0, 0);
    try {
      let value;
      if (data.action === 'end') value = drafts.endNow(data.draftId);
      else if (data.action === 'cancel') value = drafts.cancel(data.draftId);
      else if (data.action === 'expiry') value = drafts.expireCurrentPickStep(data.draftId, new Date('2030-01-01T00:00:31Z'));
      else value = drafts.pickCard(data.draftId, data.playerId, data.cardId, data.action === 'bot' ? 'auto' : 'manual', new Date('2030-01-01T00:00:01Z'));
      parentPort.postMessage({ ok: true, value });
    } catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }
    finally { db.close(); }
  `, { eval: true, workerData: { path: ctx.path, action, gate, draftId: ctx.draft.id,
    playerId: ctx.players[0], cardId: ctx.cardId,
    servicePath: fileURLToPath(new URL("../src/services/drafts.ts", import.meta.url)) } });
  workers.push(worker);
  let readyResolve: () => void;
  let resultResolve: (result: { ok: boolean; error?: string; value?: unknown }) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; worker.once("error", reject); });
  const result = new Promise<{ ok: boolean; error?: string; value?: unknown }>((resolve, reject) => {
    resultResolve = resolve; worker.once("error", reject);
  });
  worker.on("message", message => message.ready ? readyResolve() : resultResolve(message));
  return { ready, result };
}

it.each(["end", "cancel"] as const)("serializes %s against concurrent manual picks, bot picks and expiry", async action => {
  for (const contender of ["manual", "bot", "expiry"]) {
    const ctx = setup();
    const gate = new SharedArrayBuffer(4);
    const terminal = runWorker(ctx, action, gate);
    const picking = runWorker(ctx, contender, gate);
    await Promise.all([terminal.ready, picking.ready]);
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, 2);
    const [stopped, picked] = await Promise.all([terminal.result, picking.result]);
    expect(stopped).toMatchObject({ ok: true });
    if (!picked.ok) expect(picked.error).toMatch(/Draft must be active/);
    const draft = ctx.drafts.findById(ctx.draft.id);
    expect(draft.status).toBe(action === "end" ? "completed" : "cancelled");
    expect(draft.pickDeadlineAt).toBeNull();
    const picks = ctx.drafts.picks(ctx.draft.id);
    if (action === "cancel") expect(picks).toEqual([]);
    else {
      const expected = contender === "expiry"
        ? (picked.value as { autoPickedPlayerIds: number[] }).autoPickedPlayerIds.length
        : picked.ok ? 1 : 0;
      expect(picks).toHaveLength(expected);
      expect(new Set(picks.map(pick => `${pick.playerId}:${pick.waveNumber}:${pick.pickStep}`)).size).toBe(picks.length);
    }
    expect(ctx.drafts.expireCurrentPickStep(ctx.draft.id, new Date("2031-01-01"))).toEqual({ autoPickedPlayerIds: [] });
    expect(ctx.drafts.picks(ctx.draft.id)).toEqual(picks);
  }
}, 20_000);

it.each(["manual", "bot", "expiry"])("keeps committed %s picks when end runs second", contender => {
  const ctx = setup();
  if (contender === "expiry") ctx.drafts.expireCurrentPickStep(ctx.draft.id, new Date("2030-01-01T00:00:31Z"));
  else ctx.drafts.pickCard(ctx.draft.id, ctx.players[0], ctx.cardId, contender === "bot" ? "auto" : "manual");
  const picks = ctx.drafts.picks(ctx.draft.id);
  expect(picks).toHaveLength(contender === "expiry" ? 2 : 1);
  ctx.drafts.endNow(ctx.draft.id);
  expect(ctx.drafts.picks(ctx.draft.id)).toEqual(picks);
});
