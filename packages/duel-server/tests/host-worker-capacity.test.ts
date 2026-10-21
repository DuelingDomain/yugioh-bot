import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity, seedUser } from "./helpers/identity.js";
import { signedHeaders } from "./helpers/signed-request.js";

// Keep the host and worker client real while controlling thread termination.
const transports = vi.hoisted(() => [] as Array<import("node:events").EventEmitter & { finishTermination?: () => void }>);
vi.mock("node:worker_threads", async original => {
  const real = await original<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  return {
    ...real,
    Worker: class extends EventEmitter {
      finishTermination?: () => void;
      constructor(filename: string | URL, options?: import("node:worker_threads").WorkerOptions) {
        super();
        // Main also hashes resources and encodes replay JSON in workers. Keep those threads real.
        if (typeof filename !== "string" || !filename.includes("/worker.ts")) return new real.Worker(filename, options);
        transports.push(this);
      }
      postMessage(message: { id: number; op: string; seat?: number | null }) {
        const view: DuelEngineView = {
          revision: 1, turn: 1, turnSeat: 0, phase: "main1",
          seats: [0, 1].map((seat) => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0,
            extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
          prompt: message.seat === 0 ? { id: "p1", seat: 0, kind: "choice", title: "Main",
            options: [{ id: "pass", label: "Pass" }] } : null,
          prioritySeat: 0, chain: [], events: [], log: [], result: null,
        };
        queueMicrotask(() => this.emit("message", { id: message.id, ok: true, value: message.op === "view" ? view : undefined }));
      }
      terminate(): Promise<number> {
        if (this === transports[0]) return new Promise((resolve) => { this.finishTermination = () => resolve(0); });
        this.emit("exit", 0);
        return Promise.resolve(0);
      }
    },
  };
});

const SECRET = "worker-capacity-test";
const resources: Array<{ host: DuelHost; db: Database.Database; directory: string }> = [];
afterEach(async () => {
  for (const { host, db, directory } of resources.splice(0)) {
    await host.close(); db.close(); rmSync(directory, { recursive: true, force: true });
  }
  transports.length = 0;
  vi.unstubAllEnvs();
});

it.each(["pending", "completed"] as const)("releases a timed-out worker slot on exit with termination %s", async (termination) => {
  const directory = createHostDataFixture([{ code: 1, name: "Test card" }]);
  vi.stubEnv("DUEL_DATA_DIR", directory);
  const db = new Database(":memory:"); migrate(db);
  const players = [0, 1].map((seat) => seedIdentity(db, {
    guildId: "g", name: `Player ${seat}`, ...seedUser(db, `u${seat}`),
  }).playerId);
  const duels = createDuelService(db);
  const tables = Array.from({ length: 3 }, () => {
    const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Duel", mode: "normal",
      settings: { validateDeck: false, turnSeconds: 0 } });
    duels.takeSeat(session.slug, "g", players[1]!);
    for (const player of players) duels.setDeck(session.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
    return session;
  });
  const host = createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [],
    maxWorkers: 1, maxTablesPerPlayer: 3, opTimeoutMs: 20, pollIntervalMs: 60_000 });
  resources.push({ host, db, directory });
  const post = async (op: string, slug: string) => {
    const raw = JSON.stringify({ op, slug, guildId: "g", playerId: players[0] });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: await signedHeaders(raw, SECRET, "http://localhost/internal/duel", "duel-host") }));
    return { status: response.status, data: await response.json() };
  };
  expect(host.diagnostics()).toEqual({ engineWorkers: 0, maxWorkers: 1, queuedRebuilds: 0 });
  const busy = { status: 429, data: { error: "The duel server is busy. Try again in a minute." } };
  expect((await post("start", tables[0]!.slug)).status).toBe(200);
  expect(host.diagnostics()).toEqual({ engineWorkers: 1, maxWorkers: 1, queuedRebuilds: 0 });
  expect((await post("surrender", tables[0]!.slug)).status).toBe(200);
  expect(await post("start", tables[1]!.slug)).toEqual(busy);
  expect(transports).toHaveLength(1);
  transports[0]!.emit("exit", 0);
  expect((await post("start", tables[1]!.slug)).status).toBe(200);
  expect(transports).toHaveLength(2);
  if (termination === "completed") {
    transports[0]!.finishTermination!();
    await Promise.resolve();
    await Promise.resolve();
  }
  expect(await post("start", tables[2]!.slug)).toEqual(busy);
  expect(transports).toHaveLength(2);
});
