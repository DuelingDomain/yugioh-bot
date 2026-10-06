import { seedIdentity, seedUser } from "./helpers/identity.js";
import { createHmac, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { DUEL_OPENING_GRACE_MS, seatCountFor, teamOfSeat, type DuelDeck, type DuelEngineView, type DuelFormat, type DuelRoom } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { AXE_RAIDER, botTableOf, buildPracticeBotDeck, choosePracticeBotAnswer } from "../src/practice-bot.js";
import { GameWorker } from "../src/worker-client.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const SECRET = "domain-host-test";
const FORMATS = ["ffa3", "ffa4", "tag"] as const;
const resources: Array<{ host: DuelHost; db: Database.Database }> = [];
beforeEach(() => vi.stubEnv("MULTIPLAYER_TABLES", "1"));
afterEach(async () => {
  while (resources.length) {
    const { host, db } = resources.pop()!;
    await host.close();
    db.close();
  }
  vi.unstubAllEnvs();
});

async function table(format: DuelFormat, humans = 1, drawPerTurn = 1) {
  const db = new Database(":memory:");
  migrate(db);
  const players = Array.from({ length: humans }, (_, seat) => seedIdentity(db, { guildId: "g", name: `P${seat}`, userId: seedUser(db, `u${seat}`).userId, discordUserId: seedUser(db, `u${seat}`).discordUserId ?? `u${seat}` }).playerId);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Domain", mode: "domain", format,
    settings: { turnSeconds: 60, timeout: "loss", drawPerTurn } });
  const workers: GameWorker[] = [];
  const time = { now: 1_000_000 };
  const host = createDuelHost({ db, dataDirectory: DATA, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
    now: () => time.now, createWorker: () => { const worker = new GameWorker(); workers.push(worker); return worker; } });
  resources.push({ host, db });
  const post = async (op: string, extra: Record<string, unknown> = {}, seat = 0) => {
    const raw = JSON.stringify({ op, slug: session.slug, guildId: "g", playerId: players[seat], ...extra });
    const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") } }));
    return { status: response.status, data: await response.json() as DuelRoom & { error?: string } };
  };
  for (const player of players.slice(1)) duels.takeSeat(session.slug, "g", player);
  const deck = buildPracticeBotDeck("domain", DATA);
  for (let seat = 0; seat < humans; seat++) expect((await post("deck", { deck }, seat)).status).toBe(200);
  for (let seat = humans; seat < seatCountFor(format); seat++) expect((await post("add-bot", { seat })).status).toBe(200);
  const room = async (seat = 0) => {
    const response = await post("view", {}, seat);
    expect(response.status, response.data.error).toBe(200);
    return response.data;
  };
  const answer = async (view: DuelEngineView, seat = 0, choice?: string) => {
    expect(view.prompt).toBeTruthy();
    const response = await post("respond", { command: { promptId: view.prompt!.id, revision: view.revision,
      answer: choice ? { choice } : choosePracticeBotAnswer(view.prompt!, { table: botTableOf(view) }) } }, seat);
    expect(response.status, response.data.error).toBe(200);
  };
  const start = async () => {
    const response = await post("start");
    expect(response.status, response.data.error).toBe(200);
    const identity = workers[0]!.debugState();
    expect(identity.wasmFile).toBe("ocgcore.multi-domain.wasm");
    expect(identity.wasmSha).toBe(createHash("sha256").update(readFileSync(join(DATA, "ocgcore.multi-domain.wasm"))).digest("hex"));
    return response.data;
  };
  const checkViews = async () => {
    const views = await Promise.all(Array.from({ length: seatCountFor(format) }, (_, seat) => workers[0]!.view(seat)));
    const publicView = await workers[0]!.view(null);
    for (let viewer = 0; viewer < views.length; viewer++) {
      const view = views[viewer]!;
      expect(view.seats).toHaveLength(views.length);
      expect(view.prompt?.seat ?? viewer).toBe(viewer);
      for (const seat of view.seats) {
        expect(seat.deckMaster).toEqual(publicView.seats[seat.seat]!.deckMaster);
        expect(seat.deckMaster?.card.code).toBe(AXE_RAIDER);
        expect(seat.lp).toBe(publicView.seats[seat.seat]!.lp);
        const visible = seat.seat === viewer || (format === "tag" && teamOfSeat(format, seat.seat) === teamOfSeat(format, viewer));
        for (const card of seat.hand) expect(card.code != null).toBe(visible);
      }
    }
    for (let seat = 0; seat < humans; seat++) expect((await room(seat)).engine).toEqual(views[seat]);
    return views;
  };
  return { db, duels, session, post, room, answer, start, checkViews, workers, time, deck };
}

describeWithCores("Domain tables through the real host and worker", [needs.cards(DATA),
  needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm"))], () => {
  it("lets the creator cancel an active Domain FFA4 duel and closes its engine", async () => {
    const t = await table("ffa4", 2);
    await t.start();
    expect((await t.post("cancel", {}, 1)).status).toBe(403);
    expect(t.workers[0]!.running).toBe(true);
    const cancelled = await t.post("cancel");
    expect(cancelled.status, cancelled.data.error).toBe(200);
    expect(cancelled.data.session).toMatchObject({ status: "cancelled", winnerSeat: null, winnerPlayerId: null });
    expect(cancelled.data.clock).toBeNull();
    expect(t.workers[0]!.running).toBe(false);
    expect((await t.post("cancel")).status).toBe(200);
    expect((await t.room()).session.status).toBe("cancelled");
    expect(t.workers).toHaveLength(1);
  });

  it("keeps an eliminated creator's spectator URL readable after cancellation", async () => {
    const t = await table("ffa4", 2);
    await t.start();
    const surrendered = await t.post("surrender");
    expect(surrendered.status, surrendered.data.error).toBe(200);
    expect(surrendered.data.engine!.seats[0]!.eliminated).toBe(true);
    expect((await t.post("view", { spectate: true })).data.role).toBe("spectator");
    expect((await t.post("cancel")).status).toBe(200);
    const result = await t.post("view", { spectate: true });
    expect(result.status, result.data.error).toBe(200);
    expect(result.data).toMatchObject({ role: "player", mySeat: 0, session: { status: "cancelled", winnerSeat: null } });
    expect(result.data.engine).toBeNull();
  });

  it("accepts the owner's FFA4 surrender on turn 5 against three practice bots", async () => {
    const t = await table("ffa4");
    await t.start();
    for (let step = 0; step < 60; step++) {
      const view = (await t.room()).engine!;
      if (view.turn === 5 && view.turnSeat === 0 && view.phase === "main1") break;
      expect(view.result).toBeNull();
      await t.answer(view, 0, view.prompt!.options.some((option) => option.id === "to_ep") ? "to_ep" : undefined);
    }
    expect((await t.room()).engine).toMatchObject({ turn: 5, turnSeat: 0, phase: "main1" });
    const response = await t.post("surrender");
    expect(response.status, response.data.error).toBe(200);
    // With no human left the host drives all three bots to completion.
    expect(t.duels.get(t.session.slug, "g").status).toBe("completed");
    expect(t.duels.get(t.session.slug, "g").winnerSeat).not.toBe(0);
    expect(response.data.engine!.seats[0]!.eliminated).toBe(true);
    expect(response.data.engine!.prompt).toBeNull();
  }, 60_000);

  it.each(FORMATS)("%s: validates Domain decks, fills all bot seats, and plays to a result", async (format) => {
    const t = await table(format, 1, 5);
    const decks = t.duels.privateState(t.session.slug, "g").decks;
    expect(decks).toHaveLength(seatCountFor(format));
    for (const deck of decks) {
      expect(deck.main).toHaveLength(60);
      expect(new Set(deck.main).size).toBe(60);
      expect(deck.deckMaster).toBe(AXE_RAIDER);
      expect(deck.main).not.toContain(AXE_RAIDER);
      expect(deck.side).toEqual([]);
    }
    const invalid: DuelDeck[] = [
      { ...t.deck, deckMaster: undefined }, { ...t.deck, main: t.deck.main.slice(1) },
      { ...t.deck, main: [t.deck.main[0]!, ...t.deck.main.slice(0, 59)] },
      { ...t.deck, main: [AXE_RAIDER, ...t.deck.main.slice(1)] },
      { ...t.deck, side: [t.deck.main[0]!] },
      { ...t.deck, main: [46986414, ...t.deck.main.slice(1)] },
      { ...t.deck, main: [94212438, ...t.deck.main.slice(1)] },
    ];
    for (const deck of invalid) expect((await t.post("deck", { deck })).status).toBe(400);
    await t.start();
    const initial = await t.checkViews();
    for (const view of initial) for (const seat of view.seats) expect(seat.deckMaster).toMatchObject({ inZone: true, returns: 0, nextCost: 0 });
    // A human uses its Deck Master from its own zone through a real prompt.
    const master = initial[0]!.prompt!.options.find((option) => option.id.startsWith("summon:") && option.card?.code === AXE_RAIDER);
    expect(master).toBeTruthy();
    await t.answer(initial[0]!, 0, master!.id);
    let current = await t.room();
    for (let step = 0; step < 1500 && current.session.status === "active"; step++) {
      const view = current.engine!;
      if (view.turn >= seatCountFor(format) * 2) await t.checkViews();
      await t.answer(view);
      current = await t.room();
    }
    expect(current.session.status).toBe("completed");
    const final = current.engine!;
    expect(final.turn).toBeGreaterThanOrEqual(seatCountFor(format) * 2);
    expect(final.prompt).toBeNull();
    if (format === "tag") {
      expect(final.result?.winnerTeam).toBe(teamOfSeat(format, current.session.winnerSeat!));
      expect([0, 1]).toContain(final.result?.winnerTeam);
    } else {
      const living = final.seats.filter((seat) => !seat.eliminated && !seat.pendingElimination);
      expect(living).toHaveLength(1);
      expect(final.result?.winnerSeat).toBe(living[0]!.seat);
    }
    // Saved views for all seats must retain all public Deck Master identities.
    const saved = t.db.prepare("select snapshot_seats_json from duels where web_slug = ?").get(t.session.slug) as { snapshot_seats_json: string };
    for (const view of JSON.parse(saved.snapshot_seats_json) as DuelEngineView[]) {
      expect(view.result).toEqual(final.result);
      expect(view.prompt).toBeNull();
      for (const seat of view.seats) expect(seat.deckMaster?.card.code).toBe(AXE_RAIDER);
    }
  }, 120_000);

  it.each(FORMATS)("%s: surrender gives the right seat or team a win and stores every seat view", async (format) => {
    const t = await table(format, seatCountFor(format));
    await t.start();
    await t.checkViews();
    // Play two rounds before a seat leaves.
    for (let step = 0; step < 100; step++) {
      const views = await t.checkViews();
      if (views[0]!.turn > seatCountFor(format) * 2) break;
      const seat = views.findIndex((view) => view.prompt);
      expect(seat).toBeGreaterThanOrEqual(0);
      const view = views[seat]!;
      await t.answer(view, seat, view.prompt!.options.some((option) => option.id === "to_ep") ? "to_ep" : undefined);
    }
    expect((await t.room()).engine!.turn).toBeGreaterThan(seatCountFor(format) * 2);
    for (let seat = seatCountFor(format) - 1; seat >= 1 && t.duels.get(t.session.slug, "g").status === "active"; seat--) {
      expect((await t.post("surrender", {}, seat)).status).toBe(200);
    }
    const winner = 0;
    const expected = format === "tag" ? { winnerSeat: winner, winnerTeam: 0, reason: "Surrender" } : { winnerSeat: winner, reason: "Surrender" };
    for (let seat = 0; seat < seatCountFor(format); seat++) {
      const room = await t.room(seat);
      expect(room.session.status).toBe("completed");
      expect(room.session.winnerSeat).toBe(winner);
      expect(room.engine?.result).toEqual(expected);
      expect(room.engine?.prompt).toBeNull();
      for (const entry of room.engine!.seats) expect(entry.deckMaster?.card.code).toBe(AXE_RAIDER);
    }
  }, 60_000);

  it.each(FORMATS)("%s: a time limit removes only the FFA seat or ends Tag for its team", async (format) => {
    const t = await table(format, seatCountFor(format));
    await t.start();
    // The first decision of a game has the opening grace on top of the 60 second clock bank.
    t.time.now += 61_000 + DUEL_OPENING_GRACE_MS;
    const after = await t.room();
    if (format === "tag") {
      expect(after.session.status).toBe("completed");
      for (let seat = 0; seat < 4; seat++) expect((await t.room(seat)).engine?.result).toEqual({ winnerSeat: 1, winnerTeam: 1, reason: "Time limit" });
    } else {
      expect(after.session.status).toBe("active");
      const views = await t.checkViews();
      for (const view of views) {
        expect(view.seats[0]!.eliminated).toBe(true);
        expect(view.seats[0]!.deckMaster?.inZone).toBe(false);
        expect(view.turnSeat).toBe(1);
      }
      for (let seat = 1; seat < seatCountFor(format) - 1; seat++) { t.time.now += 61_000; await t.room(seat); }
      for (let seat = 0; seat < seatCountFor(format); seat++) {
        const room = await t.room(seat);
        expect(room.session.status).toBe("completed");
        expect(room.engine?.result).toEqual({ winnerSeat: seatCountFor(format) - 1, reason: "Time limit" });
        expect(room.engine?.prompt).toBeNull();
      }
    }
  }, 60_000);
});
