import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import type { DuelSession } from "@yugidraft/shared/duels";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";

const SECRET = "host-unready-secret";
const resources: Array<{ host: DuelHost; db: Database.Database; dir: string }> = [];
afterEach(async () => {
  for (const { host, db, dir } of resources.splice(0)) {
    await host.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function lobby(onChange?: () => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "host-unready-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test" }));
  writeFileSync(join(dir, "strings.conf"), "");
  const cards = new Database(join(dir, "cards.cdb"));
  cards.exec(`
    create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, race integer, attribute integer);
    create table texts (id integer primary key, name text, desc text);
    insert into datas values (1, 3, 0, 0, 17, 1, 1);
    insert into texts values (1, 'Test monster', '');
  `);
  cards.close();
  const db = new Database(":memory:");
  migrate(db);
  const player = (id: string) => Number(db.prepare(
    "insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)",
  ).run(id, id).lastInsertRowid);
  const challenger = player("u1"), opponent = player("u2"), p3 = player("u3");
  const duels = createDuelService(db);
  const { duel } = createDuelSeriesService(db).createChallenge({
    guildId: "g1", challengerPlayerId: challenger, opponentPlayerId: opponent, bestOf: 3, ranked: false, mode: "normal",
    settings: { validateDeck: false },
  });
  const p1 = duel.seats[0].playerId!, p2 = duel.seats[1].playerId!;
  const deck = { main: Array(40).fill(1), extra: [], side: [] };
  duels.setDeck(duel.slug, "g1", p1, deck);
  duels.setDeck(duel.slug, "g1", p2, deck);
  db.prepare("update duel_seats set ready = 0 where duel_id = ? and player_id = ?").run(duel.id, p2);
  const changes: boolean[][] = [];
  const host = createDuelHost({
    db, dataDirectory: dir, secret: SECRET, searchCards: () => [], openingRps: true,
    pollIntervalMs: 60 * 60 * 1000,
    onChange: async () => {
      changes.push(duels.get(duel.slug, "g1").seats.map((seat) => seat.ready));
      await onChange?.();
    },
    createWorker: () => { throw new Error("No worker should start during the lobby opening"); },
  });
  resources.push({ host, db, dir });
  const post = async (op: string, playerId = p1) => {
    const raw = JSON.stringify({ op, slug: duel.slug, guildId: "g1", playerId });
    const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
    const response = await host.handle(new Request("http://localhost/internal/duel", {
      method: "POST", headers: { "x-announce-signature": signature }, body: raw,
    }));
    return { status: response.status, data: await response.json() as { session?: DuelSession; error?: string } };
  };
  return { duels, slug: duel.slug, p1, p2, p3, post, changes };
}

describe("lobby unready op", () => {
  it("clears Ready, broadcasts the change and leaves the deck available to ready again", async () => {
    const app = lobby();
    const unready = await app.post("unready");
    expect(unready.status).toBe(200);
    expect(unready.data.session?.seats.map((seat) => seat.ready)).toEqual([false, false]);
    expect(app.changes).toEqual([[false, false]]);
    expect((await app.post("unready")).data.session).toEqual(unready.data.session);
    expect((await app.post("ready", app.p2)).status).toBe(200);
    expect(app.duels.openingState(app.slug, "g1")).toBeNull();
    expect((await app.post("ready")).status).toBe(200);
    expect(app.duels.openingState(app.slug, "g1")?.phase).toBe("rps");
  });

  it("refuses unready after Ready has started the opening", async () => {
    const app = lobby();
    expect((await app.post("ready", app.p2)).status).toBe(200);
    expect(app.duels.openingState(app.slug, "g1")?.phase).toBe("rps");
    const unready = await app.post("unready");
    expect(unready.status).toBe(409);
    expect(unready.data.error).toMatch(/about to start|already starting/);
    expect(app.duels.get(app.slug, "g1").seats.map((seat) => seat.ready)).toEqual([true, true]);
  });

  it("queues unready behind an in-flight Ready, so it cannot race autoStart", async () => {
    let entered!: () => void;
    let release!: () => void;
    const enteredChange = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let firstChange = true;
    const app = lobby(async () => {
      if (!firstChange) return;
      firstChange = false;
      entered();
      await blocked;
    });
    const ready = app.post("ready", app.p2);
    await enteredChange;
    const unready = app.post("unready");
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(app.duels.get(app.slug, "g1").seats.map((seat) => seat.ready)).toEqual([true, true]);
    } finally {
      release();
    }
    expect((await ready).status).toBe(200);
    expect((await unready).status).toBe(409);
    expect(app.duels.openingState(app.slug, "g1")?.phase).toBe("rps");
  });

  it("refuses a player outside the seats", async () => {
    const app = lobby();
    expect((await app.post("unready", app.p3)).status).toBe(403);
    expect(app.duels.get(app.slug, "g1").seats.map((seat) => seat.ready)).toEqual([true, false]);
    expect(app.changes).toEqual([]);
  });
});
