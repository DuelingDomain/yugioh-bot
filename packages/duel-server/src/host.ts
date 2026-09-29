import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createDuelService, type DuelFinalSnapshots } from "@yugidraft/shared/services";
import type { DuelCommand, DuelDeck, DuelEngineView, DuelRoom } from "@yugidraft/shared/duels";
import { GameWorker, type DuelGameWorker } from "./worker-client.js";
import { validateDeck } from "./deck-legality.js";
import { normalizeImportedDeck } from "./deck-import.js";
import { buildPracticeBotDeck, choosePracticeBotAnswer, PracticeBotError } from "./practice-bot.js";

const BOT_ADVANCE_LIMIT = 128;
const DEFAULT_ARCHIVE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_IDLE_WORKER_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
const ARCHIVE_SWEEP_LIMIT = 32;

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class ReplayMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayMismatchError";
  }
}

type LiveGame = { game: DuelGameWorker; lastRequestAt: number; guildId: string };

function freezeView(view: DuelEngineView, result: { winnerSeat: number | null; reason: string }): DuelEngineView {
  return { ...view, prompt: null, result };
}

export interface DuelHost {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export function createDuelHost(options: {
  db: Database.Database;
  dataDirectory: string;
  secret: string;
  searchCards: (query: string) => unknown;
  onChange?: (slug: string, guildId: string) => void | Promise<void>;
  archiveAfterMs?: number;
  idleWorkerMs?: number;
  pollIntervalMs?: number;
  createWorker?: () => DuelGameWorker;
}): DuelHost {
  if (!options.secret) throw new Error("DUEL_INTERNAL_SECRET is required");
  const service = createDuelService(options.db);
  const manifest = JSON.parse(readFileSync(join(options.dataDirectory, "manifest.json"), "utf8")) as { bundleVersion: string };
  if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
  const games = new Map<string, LiveGame>();
  const queues = new Map<string, Promise<unknown>>();
  const spawn = options.createWorker ?? (() => new GameWorker());
  const archiveAfterMs = options.archiveAfterMs ?? DEFAULT_ARCHIVE_AFTER_MS;
  const idleWorkerMs = options.idleWorkerMs ?? DEFAULT_IDLE_WORKER_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let stopped = false;

  async function emitChange(slug: string, guildId: string): Promise<void> {
    try {
      await options.onChange?.(slug, guildId);
    } catch (error) {
      console.warn("[duel] onChange failed", error);
    }
  }

  async function safeClose(game: DuelGameWorker): Promise<void> {
    try {
      await game.close();
    } catch {
      // Worker may already have exited.
    }
  }

  async function disposeGame(slug: string): Promise<void> {
    const entry = games.get(slug);
    games.delete(slug);
    if (entry) await safeClose(entry.game);
  }

  async function captureSnapshots(
    game: DuelGameWorker,
    winnerSeat: number | null,
    reason: string,
  ): Promise<DuelFinalSnapshots> {
    const result = { winnerSeat, reason };
    return {
      public: freezeView(await game.view(null), result),
      seat0: freezeView(await game.view(0), result),
      seat1: freezeView(await game.view(1), result),
    };
  }

  async function persistComplete(
    slug: string,
    guildId: string,
    game: DuelGameWorker,
    winnerSeat: number | null,
    reason: string,
  ): Promise<void> {
    let snapshots: DuelFinalSnapshots;
    try {
      snapshots = await captureSnapshots(game, winnerSeat, reason);
    } catch (error) {
      await disposeGame(slug);
      throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    }
    service.complete(slug, guildId, winnerSeat, reason, snapshots);
    await disposeGame(slug);
    await emitChange(slug, guildId);
  }

  async function advancePracticeBot(slug: string, guildId: string, game: DuelGameWorker): Promise<void> {
    for (let step = 0; step < BOT_ADVANCE_LIMIT; step++) {
      const session = service.get(slug, guildId);
      if (session.status !== "active") return;
      const bot = session.seats.find((seat) => seat.isBot);
      if (!bot) return;
      const view = await game.view(bot.seat);
      if (view.result) return;
      const prompt = view.prompt;
      if (!prompt || prompt.seat !== bot.seat) return;

      let permittedCards;
      if (prompt.kind === "announce-card") {
        permittedCards = await game.search("");
      }
      let answer;
      try {
        answer = choosePracticeBotAnswer(prompt, { permittedCards });
      } catch (error) {
        const message = error instanceof PracticeBotError ? error.message : "Practice bot failed to choose";
        throw new RequestError(message, 500);
      }
      const command: DuelCommand = { promptId: prompt.id, revision: view.revision, answer };
      try {
        await game.answer(bot.seat, prompt.id, answer);
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "Practice bot made an illegal choice", 500);
      }
      try {
        service.recordCommand(slug, guildId, bot.seat, command);
      } catch (error) {
        await disposeGame(slug);
        throw error;
      }
    }
    throw new RequestError("Practice bot failed to make progress", 500);
  }

  async function recover(slug: string, guildId: string): Promise<DuelGameWorker> {
    const existing = games.get(slug);
    if (existing?.game.running) {
      existing.lastRequestAt = Date.now();
      await advancePracticeBot(slug, guildId, existing.game);
      return existing.game;
    }
    games.delete(slug);
    const state = service.privateState(slug, guildId);
    if (state.session.status !== "active") throw new RequestError("This duel is not active", 409);
    if (!state.seed || !state.bundleVersion) throw new RequestError("Duel has not started", 409);
    if (state.bundleVersion !== manifest.bundleVersion) {
      service.interrupt(slug, guildId, "The pinned engine resources changed; this duel cannot be replayed safely.");
      await emitChange(slug, guildId);
      throw new RequestError("Duel interrupted: engine resource version changed", 409);
    }
    const game = spawn();
    try {
      await game.create({
        mode: state.session.mode,
        decks: state.decks,
        seed: state.seed,
        dataDirectory: options.dataDirectory,
        masterRule: state.session.masterRule,
      });
    } catch (error) {
      await safeClose(game);
      throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
    }
    try {
      for (const input of state.commands) {
        let view: DuelEngineView;
        try {
          view = await game.view(input.seat);
        } catch (error) {
          await safeClose(game);
          throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
        }
        if (view.revision !== input.command.revision || view.prompt?.id !== input.command.promptId) {
          throw new ReplayMismatchError("Duel recovery did not reproduce the saved prompt");
        }
        try {
          await game.answer(input.seat, input.command.promptId, input.command.answer);
        } catch (error) {
          if (!game.running) {
            await safeClose(game);
            throw new RequestError(error instanceof Error ? error.message : "Duel engine is temporarily unavailable", 503);
          }
          throw new ReplayMismatchError(error instanceof Error ? error.message : "Duel recovery could not replay a saved choice");
        }
      }
    } catch (error) {
      await safeClose(game);
      if (error instanceof ReplayMismatchError) {
        service.interrupt(slug, guildId, "The saved engine state could not be recovered.");
        await emitChange(slug, guildId);
        throw new RequestError(error.message, 409);
      }
      throw error;
    }
    games.set(slug, { game, lastRequestAt: Date.now(), guildId });
    await advancePracticeBot(slug, guildId, game);
    return game;
  }

  async function project(slug: string, guildId: string, playerId: number, game?: DuelGameWorker): Promise<DuelRoom> {
    const room = service.room(slug, guildId, playerId);
    if (game && game.running && room.session.status === "active") {
      room.engine = await game.view(room.mySeat);
      if (room.engine.result) {
        await persistComplete(slug, guildId, game, room.engine.result.winnerSeat, room.engine.result.reason);
        return service.room(slug, guildId, playerId);
      }
    }
    return room;
  }

  async function operate(body: Record<string, unknown>): Promise<unknown> {
    const { op, guildId, playerId } = body;
    if (typeof guildId !== "string" || !guildId || !Number.isSafeInteger(playerId) || (playerId as number) <= 0) {
      throw new RequestError("Authenticated guild and player are required", 400);
    }
    const actor = playerId as number;
    if (op === "cards") {
      if (typeof body.query !== "string" || body.query.length > 200) throw new RequestError("Invalid card search", 400);
      if (typeof body.slug === "string" && body.slug) {
        const room = service.room(body.slug, guildId, actor);
        if (room.mySeat === null) throw new RequestError("Join this duel before searching its choices", 403);
        if (room.session.status !== "active") throw new RequestError("This duel is not active", 409);
        const game = await recover(body.slug, guildId);
        const view = await game.view(room.mySeat);
        if (view.prompt?.kind !== "announce-card") throw new RequestError("No card announcement is waiting", 409);
        return { cards: await game.search(body.query) };
      }
      return { cards: options.searchCards(body.query) };
    }
    if (typeof body.slug !== "string" || !body.slug || body.slug.length > 128) throw new RequestError("Duel slug is required", 400);
    const slug = body.slug;
    const room = service.room(slug, guildId, actor);
    if (op === "view") {
      const game = room.session.status === "active" ? await recover(slug, guildId) : games.get(slug)?.game;
      return project(slug, guildId, actor, game);
    }
    if (op === "add-bot") {
      if (actor !== room.session.organizerPlayerId) throw new RequestError("Only the organizer can add a practice bot", 403);
      if (room.session.status !== "lobby") throw new RequestError("A practice bot can only be added before the duel starts", 409);
      const deck = buildPracticeBotDeck(room.session.mode, options.dataDirectory);
      validateDeck(room.session.mode, deck, options.dataDirectory);
      const session = service.addPracticeBot(slug, guildId, actor, deck);
      await emitChange(slug, guildId);
      return { session };
    }
    if (op === "archive") {
      service.archive(slug, guildId, actor);
      await disposeGame(slug);
      await emitChange(slug, guildId);
      return service.room(slug, guildId, actor);
    }
    if (op === "cancel") {
      service.cancel(slug, guildId, actor);
      await emitChange(slug, guildId);
      return service.room(slug, guildId, actor);
    }
    if (room.mySeat === null) throw new RequestError("Join this duel first", 403);
    const seat = room.mySeat;
    if (op === "deck") {
      if (room.session.status !== "lobby") throw new RequestError("Decks are locked after the duel starts", 409);
      const deckInput = body.deck as DuelDeck;
      const deck = await normalizeImportedDeck(deckInput, options.dataDirectory, options.db);
      validateDeck(room.session.mode, deck, options.dataDirectory);
      const session = service.setDeck(slug, guildId, actor, deck);
      await emitChange(slug, guildId);
      return { session };
    }
    if (op === "start") {
      if (actor !== room.session.organizerPlayerId) throw new RequestError("Only the organizer can start", 403);
      if (room.session.status !== "lobby") throw new RequestError("Duel already started", 409);
      if (room.session.seats.length !== 2 || room.session.seats.some((entry) => !entry.ready)) {
        throw new RequestError("Two players must submit valid decks before starting", 409);
      }
      const state = service.privateState(slug, guildId);
      for (const deck of state.decks) validateDeck(state.session.mode, deck, options.dataDirectory);
      const bytes = randomBytes(32);
      const seed = [0, 8, 16, 24].map((offset) => bytes.readBigUInt64LE(offset).toString());
      const game = spawn();
      try {
        await game.create({
          mode: state.session.mode,
          decks: state.decks,
          seed,
          dataDirectory: options.dataDirectory,
          masterRule: state.session.masterRule,
        });
        service.activate(slug, guildId, actor, seed, manifest.bundleVersion);
        games.set(slug, { game, lastRequestAt: Date.now(), guildId });
        await emitChange(slug, guildId);
        await advancePracticeBot(slug, guildId, game);
        return await project(slug, guildId, actor, game);
      } catch (error) {
        games.delete(slug);
        await safeClose(game);
        throw error;
      }
    }
    if (room.session.status !== "active") throw new RequestError("This duel is not active", 409);
    if (op === "surrender") {
      const game = await recover(slug, guildId);
      const current = await project(slug, guildId, actor, game);
      if (current.session.status !== "active") return current;
      const opponent = room.session.seats.find((entry) => entry.seat !== seat);
      if (!opponent) throw new RequestError("Opponent is missing", 409);
      await persistComplete(slug, guildId, game, opponent.seat, "Surrender");
      return service.room(slug, guildId, actor);
    }
    if (op !== "respond") throw new RequestError("Unknown duel operation", 400);
    const command = body.command as DuelCommand | undefined;
    if (!command || typeof command.promptId !== "string" || !Number.isSafeInteger(command.revision) || !command.answer || typeof command.answer !== "object") {
      throw new RequestError("Invalid engine command", 400);
    }
    const game = await recover(slug, guildId);
    const before: DuelEngineView = await game.view(seat);
    if (before.revision !== command.revision || before.prompt?.id !== command.promptId) {
      throw new RequestError("That choice is stale. Refresh the current duel state.", 409);
    }
    try {
      await game.answer(seat, command.promptId, command.answer);
    } catch (error) {
      throw new RequestError(error instanceof Error ? error.message : "Invalid engine choice", 400);
    }
    try {
      service.recordCommand(slug, guildId, seat, command);
      await emitChange(slug, guildId);
      await advancePracticeBot(slug, guildId, game);
      return await project(slug, guildId, actor, game);
    } catch (error) {
      await disposeGame(slug);
      throw error;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    for (const [slug, entry] of [...games]) {
      if (stopped) return;
      if (queues.has(slug)) continue;
      if (now - entry.lastRequestAt < idleWorkerMs) continue;
      games.delete(slug);
      await safeClose(entry.game);
    }
    if (stopped) return;
    try {
      const archived = service.archiveDue(ARCHIVE_SWEEP_LIMIT, archiveAfterMs);
      for (const session of archived) {
        await emitChange(session.slug, session.guildId);
      }
    } catch (error) {
      console.warn("[duel] archive sweep failed", error);
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  timer.unref();
  void tick();

  return {
    async handle(request: Request): Promise<Response> {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/internal/duel") return new Response("Not found", { status: 404 });
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 64 * 1024) return Response.json({ error: "Request too large" }, { status: 413 });
      const signature = request.headers.get("x-announce-signature") ?? "";
      const expected = "sha256=" + createHmac("sha256", options.secret).update(raw).digest("hex");
      if (Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      try {
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw); } catch { throw new RequestError("Invalid JSON", 400); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Invalid request", 400);
        const key = typeof body.slug === "string" ? body.slug : "catalog";
        const previous = queues.get(key) ?? Promise.resolve();
        const operation = previous.catch(() => {}).then(() => operate(body));
        queues.set(key, operation);
        try {
          return Response.json(await operation, { headers: { "cache-control": "no-store" } });
        } finally {
          if (queues.get(key) === operation) queues.delete(key);
        }
      } catch (error) {
        const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 400;
        return Response.json({ error: error instanceof Error ? error.message : "Duel request failed" }, { status });
      }
    },
    async close(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...queues.values()]);
      await Promise.all([...games.values()].map((entry) => safeClose(entry.game)));
      games.clear();
    },
  };
}
