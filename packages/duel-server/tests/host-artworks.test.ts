import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import { createDuelHost } from "../src/host.js";
import type { DuelGameWorker, GameOptions } from "../src/worker-client.js";

it("serves signed artwork families and preserves chosen passcodes through deck submission and worker startup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-artworks-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "fixture" }));
  writeFileSync(join(dir, "strings.conf"), ""); mkdirSync(join(dir, "card-scripts"));
  writeFileSync(join(dir, "card-scripts/c10.lua"), "-- canonical script");
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);
    create table texts (id integer primary key, name text, desc text);
    insert into datas values (10,3,0,0,17,1000,1000,4,1,1),(11,3,10,0,17,1000,1000,4,1,1),(12,3,11,0,17,1000,1000,4,1,1);
    insert into texts values (10,'Dragon',''),(11,'Dragon',''),(12,'Dragon','');`); cdb.close();
  const db = new Database(":memory:"); migrate(db);
  const players = ["a", "b"].map(user => Number(db.prepare("insert into players (guild_id,discord_user_id,display_name) values ('g',?,?)").run(user, user).lastInsertRowid));
  const service = createDuelService(db);
  const room = service.create({ guildId: "g", organizerPlayerId: players[0], name: "Art", mode: "normal",
    settings: { validateDeck: false, banlist: "none", startingHand: 1, turnSeconds: 0 } });
  service.takeSeat(room.slug, "g", players[1]);
  const created: GameOptions[] = [];
  const view: DuelEngineView = { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: [0,1].map(seat => ({
    seat, lp: 8000, hand: [], deckCount: 1, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
  })), prompt: null, prioritySeat: null, chain: [], events: [], log: [], result: null };
  const worker: DuelGameWorker = { running: true, create: async options => { created.push(options); }, view: async () => view,
    answer: async () => {}, search: async () => [], close: async () => {} };
  const secret = "fixture";
  const host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], createWorker: () => worker, pollIntervalMs: 60_000 });
  const post = async (body: object, playerId = players[0]) => {
    const raw = JSON.stringify({ guildId: "g", playerId, slug: room.slug, ...body });
    return host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": `sha256=${createHmac("sha256",secret).update(raw).digest("hex")}` } }));
  };
  try {
    expect(loadCardDatabase(dir).readScript("c12.lua")).toBe("-- canonical script");
    expect(loadCardDatabase(dir).readScript("c99.lua")).toBeNull();
    expect((await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: "{}" }))).status).toBe(401);
    expect(await (await post({ op: "card-artworks", codes: [12] })).json()).toEqual({ passcode: 10, artworks: [
      { passcode: 10, isMain: true }, { passcode: 11, isMain: false }, { passcode: 12, isMain: false },
    ] });
    expect((await post({ op: "card-artworks", codes: [99] })).status).toBe(404);
    expect((await post({ op: "card-artworks", codes: [10,11] })).status).toBe(400);
    expect(await (await post({ op: "normalize-codes", codes: [12] })).json()).toEqual({ codes: { 12: 10 } });
    expect(await (await post({ op: "normalize-codes", codes: [12], preserveArtwork: true })).json()).toEqual({ codes: { 12: 12 } });
    for (const player of players) {
      const response = await post({ op: "deck", deck: { main: [12], extra: [], side: [11] } }, player);
      expect(response.status, JSON.stringify(await response.json())).toBe(200);
    }
    const start = await post({ op: "start" });
    expect(start.status, JSON.stringify(await start.json())).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0].decks).toEqual(players.map(() => ({ main: [12], extra: [], side: [11] })));
  } finally { await host.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
