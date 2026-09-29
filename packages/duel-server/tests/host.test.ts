import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { buildPracticeBotDeck } from "../src/practice-bot.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const SECRET = "duel-host-test-secret";
const MANIFEST = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as { bundleVersion: string };

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, displayName: string) {
  return Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run(guildId, discordUserId, displayName)
      .lastInsertRowid,
  );
}

function hiddenHand(controller: number, code: number | undefined) {
  const card = { controller, location: 1, sequence: 0, position: 2 };
  if (code === undefined) return [card];
  return [{ ...card, code }];
}

function fakeView(viewer: number | null, promptId: string | null, revision: number, result: DuelEngineView["result"]): DuelEngineView {
  const prompt: DuelPrompt | null = promptId
    ? { id: promptId, seat: 0, kind: "choice", title: "Main", options: [{ id: "pass", label: "Pass" }] }
    : null;
  return {
    revision,
    turn: 1,
    turnSeat: 0,
    phase: "main1",
    seats: [
      {
        seat: 0,
        lp: 8000,
        hand: hiddenHand(0, viewer === 0 ? 111 : undefined),
        deckCount: 35,
        extraCount: 0,
        extra: [],
        monsters: [],
        spells: [],
        graveyard: [],
        banished: [],
      },
      {
        seat: 1,
        lp: 8000,
        hand: hiddenHand(1, viewer === 1 ? 222 : undefined),
        deckCount: 35,
        extraCount: 0,
        extra: [],
        monsters: [],
        spells: [],
        graveyard: [],
        banished: [],
      },
    ],
    prompt,
    chain: [],
    events: [],
    log: [],
    result,
  };
}

class FakeWorker implements DuelGameWorker {
  created = 0;
  closed = 0;
  failCreate = false;
  mismatchPrompt = false;
  failAnswer = false;
  killOnAnswer = false;
  failSeat1View = false;
  revision = 1;
  promptId = "p1";
  result: DuelEngineView["result"] = null;
  private stopped = false;

  get running() {
    return !this.stopped;
  }

  async create() {
    this.created += 1;
    if (this.failCreate) throw new Error("spawn failed");
  }

  async view(seat: number | null) {
    if (this.failSeat1View && seat === 1) throw new Error("seat1 snapshot failed");
    const promptId = this.mismatchPrompt ? "other" : this.result ? null : this.promptId;
    return fakeView(seat, promptId, this.mismatchPrompt ? 9 : this.revision, this.result);
  }

  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) {
    if (this.killOnAnswer) {
      this.stopped = true;
      throw new Error("worker died");
    }
    if (this.failAnswer) throw new Error("illegal choice");
    this.revision += 1;
    this.promptId = `p${this.revision}`;
  }

  async search(_query: string): Promise<DuelCardInfo[]> {
    return [];
  }

  async close() {
    this.stopped = true;
    this.closed += 1;
  }
}

type HostHarness = {
  db?: Database.Database;
  onChange?: (slug: string, guildId: string) => void | Promise<void>;
  archiveAfterMs?: number;
  idleWorkerMs?: number;
  pollIntervalMs?: number;
};

const hosts: DuelHost[] = [];

afterEach(async () => {
  vi.useRealTimers();
  while (hosts.length > 0) {
    const host = hosts.pop();
    if (host) await host.close();
  }
});

function openHost(createWorker: (() => DuelGameWorker) | undefined, extra: HostHarness = {}) {
  const db = extra.db ?? new Database(":memory:");
  if (!extra.db) migrate(db);
  const host = createDuelHost({
    db,
    dataDirectory: DATA,
    secret: SECRET,
    searchCards: () => [],
    archiveAfterMs: extra.archiveAfterMs ?? 60 * 60 * 1000,
    idleWorkerMs: extra.idleWorkerMs ?? 60 * 60 * 1000,
    pollIntervalMs: extra.pollIntervalMs ?? 60_000,
    createWorker,
    onChange: extra.onChange,
  });
  hosts.push(host);
  return { db, host };
}

async function post(host: DuelHost, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(
    new Request("http://localhost/internal/duel", {
      method: "POST",
      headers: { "content-type": "application/json", "x-announce-signature": signature },
      body: raw,
    }),
  );
  let data: unknown = null;
  try {
    data = JSON.parse(await response.text());
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function readRoom(data: unknown): DuelRoom {
  if (!data || typeof data !== "object") throw new Error("expected duel room");
  if (!("session" in data) || !("role" in data) || !("engine" in data) || !("metadataOnly" in data)) {
    throw new Error("expected duel room");
  }
  return data as DuelRoom;
}

function seedPlayers(db: Database.Database) {
  return {
    p1: insertPlayer(db, "g1", "u1", "Yugi"),
    p2: insertPlayer(db, "g1", "u2", "Kaiba"),
    p3: insertPlayer(db, "g1", "u3", "Joey"),
  };
}

function readyLobby(db: Database.Database, p1: number, p2: number) {
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g1", organizerPlayerId: p1, name: "Duel", mode: "normal" });
  duels.join(session.slug, "g1", p2);
  const deck = buildPracticeBotDeck("normal", DATA);
  duels.setDeck(session.slug, "g1", p1, deck);
  duels.setDeck(session.slug, "g1", p2, deck);
  return { duels, session };
}

describe("duel host rooms", () => {
  it("lets seated players re-enter, spectators watch public state, and forbids spectator commands", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2, p3 } = seedPlayers(db);
    const { session } = readyLobby(db, p1, p2);
    const { host } = openHost(() => new FakeWorker(), { db });

    const started = await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(started.status).toBe(200);
    const startedRoom = readRoom(started.data);
    expect(startedRoom.role).toBe("player");
    expect(startedRoom.mySeat).toBe(0);
    expect(startedRoom.engine?.seats[0]?.hand[0]?.code).toBe(111);
    expect(startedRoom.engine?.seats[1]?.hand[0]?.code).toBeUndefined();

    const spectator = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p3 });
    expect(spectator.status).toBe(200);
    const specRoom = readRoom(spectator.data);
    expect(specRoom.role).toBe("spectator");
    expect(specRoom.mySeat).toBeNull();
    expect(specRoom.myDeck).toBeNull();
    expect(specRoom.engine?.seats[0]?.hand[0]?.code).toBeUndefined();
    expect(specRoom.engine?.seats[1]?.hand[0]?.code).toBeUndefined();
    expect(JSON.stringify(specRoom)).not.toContain("111");
    expect(JSON.stringify(specRoom)).not.toContain("222");

    const blocked = await post(host, {
      op: "respond",
      slug: session.slug,
      guildId: "g1",
      playerId: p3,
      command: { promptId: "p1", revision: 1, answer: { choice: "pass" } },
    });
    expect(blocked.status).toBe(403);

    const announce = await post(host, { op: "cards", slug: session.slug, guildId: "g1", playerId: p3, query: "dragon" });
    expect(announce.status).toBe(403);

    const reenter = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p2 });
    expect(reenter.status).toBe(200);
    expect(readRoom(reenter.data).mySeat).toBe(1);
  });

  it("stores surrender snapshots before disposing the worker and keeps them after reload", async () => {
    const changes: Array<[string, string]> = [];
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2, p3 } = seedPlayers(db);
    const { session, duels } = readyLobby(db, p1, p2);
    const { host } = openHost(() => new FakeWorker(), {
      db,
      onChange: async (slug, guildId) => {
        changes.push([slug, guildId]);
        throw new Error("push failed");
      },
    });

    expect((await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    const surrendered = await post(host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(surrendered.status).toBe(200);
    const room = readRoom(surrendered.data);
    expect(room.session.status).toBe("completed");
    expect(room.session.winnerSeat).toBe(1);
    expect(room.session.resultReason).toBe("Surrender");
    expect(room.metadataOnly).toBe(false);
    expect(room.engine?.prompt).toBeNull();
    expect(room.engine?.result).toEqual({ winnerSeat: 1, reason: "Surrender" });
    expect(room.engine?.seats[0]?.hand[0]?.code).toBe(111);

    const spec = duels.room(session.slug, "g1", p3);
    expect(spec.role).toBe("spectator");
    expect(spec.engine?.seats[0]?.hand[0]?.code).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain("111");
    expect(changes.some((entry) => entry[0] === session.slug)).toBe(true);

    const stored = db
      .prepare<[string], { snapshot_public_json: string; snapshot_seat0_json: string; snapshot_seat1_json: string }>(
        "select snapshot_public_json, snapshot_seat0_json, snapshot_seat1_json from duels where web_slug = ?",
      )
      .get(session.slug);
    expect(stored?.snapshot_public_json).toBeTruthy();
    expect(stored?.snapshot_seat0_json).toContain("111");
    expect(stored?.snapshot_seat1_json).toContain("222");
    expect(stored?.snapshot_public_json).not.toContain("111");
  });

  it("does not interrupt an active duel when worker create fails, and interrupts on replay mismatch", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);
    const { session, duels } = readyLobby(db, p1, p2);
    duels.activate(session.slug, "g1", p1, ["seed-a"], MANIFEST.bundleVersion);

    let attempts = 0;
    const { host } = openHost(() => {
      attempts += 1;
      const worker = new FakeWorker();
      if (attempts === 1) worker.failCreate = true;
      return worker;
    }, { db });

    const transient = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(transient.status).toBe(503);
    expect(duels.get(session.slug, "g1").status).toBe("active");

    const recovered = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(recovered.status).toBe(200);
    expect(duels.get(session.slug, "g1").status).toBe("active");

    const other = readyLobby(db, p1, p2);
    other.duels.activate(other.session.slug, "g1", p1, ["seed-b"], MANIFEST.bundleVersion);
    other.duels.recordCommand(other.session.slug, "g1", 0, { promptId: "saved", revision: 1, answer: { choice: "pass" } });
    const { host: mismatchHost } = openHost(() => {
      const worker = new FakeWorker();
      worker.mismatchPrompt = true;
      return worker;
    }, { db });
    const mismatched = await post(mismatchHost, { op: "view", slug: other.session.slug, guildId: "g1", playerId: p1 });
    expect(mismatched.status).toBe(409);
    expect(other.duels.get(other.session.slug, "g1").status).toBe("interrupted");
  });

  it("does not complete when a final board snapshot fails, then recovers", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);
    const { session, duels } = readyLobby(db, p1, p2);
    let attempts = 0;
    const { host } = openHost(() => {
      attempts += 1;
      const worker = new FakeWorker();
      if (attempts === 1) worker.failSeat1View = true;
      return worker;
    }, { db });

    expect((await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    const failed = await post(host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(failed.status).toBe(503);
    expect(duels.get(session.slug, "g1").status).toBe("active");
    expect(duels.get(session.slug, "g1").endedAt).toBeNull();

    const retry = await post(host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(retry.status).toBe(200);
    expect(duels.get(session.slug, "g1").status).toBe("completed");
    expect(readRoom(retry.data).metadataOnly).toBe(false);
  });

  it("retries when a running worker dies mid-replay, and interrupts a rejected answer", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);

    const dead = readyLobby(db, p1, p2);
    dead.duels.activate(dead.session.slug, "g1", p1, ["seed-dead"], MANIFEST.bundleVersion);
    dead.duels.recordCommand(dead.session.slug, "g1", 0, { promptId: "saved", revision: 1, answer: { choice: "pass" } });
    let deadAttempts = 0;
    const { host: deadHost } = openHost(() => {
      deadAttempts += 1;
      const worker = new FakeWorker();
      worker.promptId = "saved";
      if (deadAttempts === 1) worker.killOnAnswer = true;
      return worker;
    }, { db });
    const unavailable = await post(deadHost, { op: "view", slug: dead.session.slug, guildId: "g1", playerId: p1 });
    expect(unavailable.status).toBe(503);
    expect(dead.duels.get(dead.session.slug, "g1").status).toBe("active");
    const retry = await post(deadHost, { op: "view", slug: dead.session.slug, guildId: "g1", playerId: p1 });
    expect(retry.status).toBe(200);
    expect(dead.duels.get(dead.session.slug, "g1").status).toBe("active");

    const rejected = readyLobby(db, p1, p2);
    rejected.duels.activate(rejected.session.slug, "g1", p1, ["seed-reject"], MANIFEST.bundleVersion);
    rejected.duels.recordCommand(rejected.session.slug, "g1", 0, { promptId: "saved", revision: 1, answer: { choice: "pass" } });
    const { host: rejectHost } = openHost(() => {
      const worker = new FakeWorker();
      worker.promptId = "saved";
      worker.failAnswer = true;
      return worker;
    }, { db });
    const mismatch = await post(rejectHost, { op: "view", slug: rejected.session.slug, guildId: "g1", playerId: p1 });
    expect(mismatch.status).toBe(409);
    expect(rejected.duels.get(rejected.session.slug, "g1").status).toBe("interrupted");
  });

  it("evicts idle workers without finalizing and replays from the journal", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);
    const { session } = readyLobby(db, p1, p2);
    const { host } = openHost(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }, { db, idleWorkerMs: 30, pollIntervalMs: 20 });

    expect((await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    expect(workers[0]?.created).toBe(1);
    await vi.advanceTimersByTimeAsync(80);
    expect(workers[0]?.closed).toBeGreaterThan(0);
    expect(createDuelService(db).get(session.slug, "g1").status).toBe("active");

    const again = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(again.status).toBe(200);
    expect(workers.length).toBeGreaterThan(1);
    expect(workers.at(-1)?.created).toBe(1);
  });

  it("archives finished rooms on host restart using durable timestamps", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);
    const { session, duels } = readyLobby(db, p1, p2);
    const first = openHost(() => new FakeWorker(), { db });

    expect((await post(first.host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    expect((await post(first.host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    expect(duels.get(session.slug, "g1").archivedAt).toBeNull();
    await first.host.close();

    openHost(() => new FakeWorker(), { db, archiveAfterMs: 0, pollIntervalMs: 60_000 });
    expect(duels.get(session.slug, "g1").archivedAt).toBeTruthy();
    expect(duels.get(session.slug, "g1").status).toBe("completed");
    expect(duels.list("g1", p1)).toEqual([]);
    expect(duels.list("g1", p1, { archived: true })[0]?.slug).toBe(session.slug);
  });

  it("cancels a lobby and archives a finished room through host ops", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2 } = seedPlayers(db);
    const { host } = openHost(() => new FakeWorker(), { db });
    const duels = createDuelService(db);
    const lobby = duels.create({ guildId: "g1", organizerPlayerId: p1, name: "Lobby", mode: "normal" });

    const cancelled = await post(host, { op: "cancel", slug: lobby.slug, guildId: "g1", playerId: p1 });
    expect(cancelled.status).toBe(200);
    const cancelledRoom = readRoom(cancelled.data);
    expect(cancelledRoom.session.status).toBe("cancelled");
    expect(cancelledRoom.session.winnerSeat).toBeNull();
    expect(cancelledRoom.role).toBe("player");

    const forbidden = await post(host, { op: "archive", slug: lobby.slug, guildId: "g1", playerId: p2 });
    expect(forbidden.status).toBe(403);

    const archived = await post(host, { op: "archive", slug: lobby.slug, guildId: "g1", playerId: p1 });
    expect(archived.status).toBe(200);
    expect(readRoom(archived.data).session.archivedAt).toBeTruthy();

    const { session } = readyLobby(db, p1, p2);
    expect((await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 })).status).toBe(200);
    const liveArchive = await post(host, { op: "archive", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(liveArchive.status).toBe(409);
  });
});

describe("native host board retention", () => {
  it("projects a public spectator view and retains the surrender board", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const { p1, p2, p3 } = seedPlayers(db);
    const { session } = readyLobby(db, p1, p2);
    const { host } = openHost(undefined, { db });

    const started = await post(host, { op: "start", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(started.status).toBe(200);
    const live = readRoom(started.data);
    expect(live.session.status).toBe("active");
    expect(live.engine?.seats).toHaveLength(2);

    const spectator = await post(host, { op: "view", slug: session.slug, guildId: "g1", playerId: p3 });
    expect(spectator.status).toBe(200);
    const spec = readRoom(spectator.data);
    expect(spec.role).toBe("spectator");
    for (const card of spec.engine?.seats[0]?.hand ?? []) {
      expect(card.code).toBeUndefined();
    }

    const surrendered = await post(host, { op: "surrender", slug: session.slug, guildId: "g1", playerId: p1 });
    expect(surrendered.status).toBe(200);
    const done = readRoom(surrendered.data);
    expect(done.session.status).toBe("completed");
    expect(done.session.resultReason).toBe("Surrender");
    expect(done.metadataOnly).toBe(false);
    expect(done.engine?.prompt).toBeNull();
    expect(done.engine?.result?.winnerSeat).toBe(1);

    await host.close();
    const retained = createDuelService(db).room(session.slug, "g1", p1);
    expect(retained.engine?.result?.winnerSeat).toBe(1);
    expect(retained.metadataOnly).toBe(false);
  }, 120_000);
});
