import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { type SandboxBoard, type SandboxRun } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "sandbox-snapshot-test";
const run: SandboxRun = { bots: { "1": "manual", "2": "manual", "3": "manual" }, seed: ["1", "2", "3", "4"] };
const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
afterEach(async () => {
  for (const { host, db } of resources.splice(0)) { await host.close(); db.close(); }
  vi.unstubAllEnvs();
});
function setup(withoutSnapshot = false) {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const db = new Database(":memory:"); migrate(db);
  const add = (name: string) => Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(name, name).lastInsertRowid);
  const owner = add("owner"), other = add("other");
  const service = createDuelService(db);
  const workers: GameWorker[] = [];
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [],
    pollIntervalMs: 3_600_000, idleWorkerMs: 3_600_000, stallMs: 0, queueBlockedMs: 0,
    createWorker: () => {
      const worker = new GameWorker();
      if (withoutSnapshot) Object.defineProperty(worker, "sandboxSnapshot", { value: undefined });
      workers.push(worker); return worker;
    } });
  resources.push({ host, db });
  async function post(op: string, extra: Record<string, unknown> = {}) {
    const raw = JSON.stringify({ guildId: "g", playerId: owner, op, ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as any };
  }
  async function start(board: SandboxBoard = {}) {
    const result = await post("start-sandbox", { board, run });
    expect(result.status, result.data.error).toBe(200);
    return result.data.slug as string;
  }
  return { db, owner, other, service, workers, post, start };
}

describeWithCores("sandbox capture and close host", [needs.standard(DATA), needs.cards(DATA)], () => {
  it("closes the worker, permits repeated close, and returns cancelled on view", async () => {
    const t = setup(), slug = await t.start();
    expect((await t.post("sandbox-close", { slug })).data).toEqual({ ok: true });
    expect(t.workers[0].running).toBe(false);
    expect((await t.post("sandbox-close", { slug })).data).toEqual({ ok: true });
    const room = await t.post("view", { slug });
    expect(room.status, room.data.error).toBe(200);
    expect(room.data.session.status).toBe("cancelled");
    expect(t.workers).toHaveLength(1);
    expect((await t.post("sandbox-snapshot", { slug })).status).toBe(409);
  }, 30_000);

  it("refuses a worker without raw capture instead of saving a partial board", async () => {
    const t = setup(true), slug = await t.start();
    const before = await t.workers[0].view(0);
    const capture = await t.post("sandbox-snapshot", { slug });
    expect(capture.status).toBe(409);
    expect(capture.data.error).toBe("This engine cannot capture a sandbox snapshot");
    expect(await t.workers[0].view(0)).toEqual(before);
    expect(t.service.get(slug, "g").status).toBe("active");
  }, 30_000);

  it("requires organizer, guild and sandbox for capture and close", async () => {
    const t = setup(), slug = await t.start();
    const regular = t.service.create({ guildId: "g", organizerPlayerId: t.owner, mode: "normal", name: "Regular" });
    for (const op of ["sandbox-close", "sandbox-snapshot"]) {
      expect((await t.post(op, { slug, playerId: t.other })).status).toBe(403);
      expect((await t.post(op, { slug, guildId: "other" })).status).toBe(404);
      expect((await t.post(op, { slug: regular.slug })).status).toBe(409);
    }
    expect(t.workers[0].running).toBe(true);
  }, 30_000);
});
