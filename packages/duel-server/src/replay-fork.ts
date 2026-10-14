import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { assertOwnerReplaySourceAccess, assertReplayForkAccess, resolveOwnerPlayer, ReplayAccessError,
  type OwnerPlayerActor } from "@yugidraft/shared/access/owner-access";
import { createDuelService, createReplayForkService, hashReplayForkPrefix, ReplayForkStorageError,
  type DuelPrivateState } from "@yugidraft/shared/services";
import { isReplayFork, isReplayForkRequest, type DuelCommand, type DuelEngineView, type DuelRoom, type DuelSession, type ReplayForkRequest,
  type ReplayForkResult, type ReplaySource } from "@yugidraft/shared/duels";
import { JournalRunnerError, runJournalPrefix, type JournalResources, type JournalRunResult } from "./journal-runner.js";
import { replayBuildError, replayHasUnsequencedLoss, type ReplayBuildErrorCode } from "./replay-builder.js";
import { replayFrameId, replaySourceVersion, resolveReplayCursor, ReplayCursorError, type ReplayCursorCodec } from "./replay-cursor.js";
import type { DuelGameWorker } from "./worker-client.js";
import { RequestError } from "./request-error.js";
import { pinnedEngineVersion } from "./multi-scripts.js";

export const REPLAY_FORK_TIMEOUT_MS = 20_000;
/** Launch/restart re-run a trusted stored prefix; account for its length. */
export const replayForkTimeoutMs = (prefixCount: number): number => Math.min(25_000, REPLAY_FORK_TIMEOUT_MS + prefixCount * 100);
export const REPLAY_FORK_ACTIVE_LIMIT = 4;
const MAX_DETACHED_FORKS = 2;

interface ActiveReplayFork {
  slug: string;
  sourceSlug: string;
  format: DuelSession["format"];
  createdAt: string;
  lastActivityAt: string;
}

/** Metadata only: abandoned forks remain discoverable without recovering a worker or reading their source. */
export function listActiveReplayForks(db: Database.Database, actor: OwnerPlayerActor): ActiveReplayFork[] {
  const owner = resolveOwnerPlayer(db, actor);
  if (!owner) throw new ReplayAccessError();
  const forks = db.prepare<[string, number], ActiveReplayFork>(`select web_slug as slug,
    case when json_valid(setup_json) then json_extract(setup_json, '$.replayFork.origin.sourceSlug') end as sourceSlug, format,
    created_at as createdAt, coalesce(last_activity_at, created_at) as lastActivityAt
    from duels where guild_id = ? and kind = 'replay-fork' and status = 'active'
    and (coalesce(json_valid(setup_json), 0) = 0
      or case when json_valid(setup_json) then json_extract(setup_json, '$.replayFork.ownerUserId') end = ?)
    order by datetime(created_at) desc, id desc`).all(owner.guildId, owner.userId);
  return forks.filter(fork => {
    try { assertReplayForkAccess(db, fork.slug, owner); return true; }
    catch (error) {
      if (!(error instanceof ReplayAccessError) || error.status !== 404) throw error;
      // No payload or error stack: a damaged row must not hide healthy forks or leak private metadata.
      console.warn("[replay-fork] Skipping invalid active fork", { slug: fork.slug, code: error.code });
      return false;
    }
  });
}

export class ReplayForkLaunchError extends Error {
  readonly status: number;
  readonly recovery?: { limit: number; forksUrl: string };
  constructor(message: string, readonly code: ReplayBuildErrorCode) {
    super(message); this.status = code === "INVALID_CURSOR" ? 400 : code === "FORK_LIMIT" ? 429 : code === "ENGINE_BUSY" ? 503 : 409;
    if (code === "FORK_LIMIT") this.recovery = { limit: REPLAY_FORK_ACTIVE_LIMIT, forksUrl: "/api/admin/duels/forks" };
  }
}

interface ForkLaunchOptions {
  db: Database.Database;
  codec: ReplayCursorCodec;
  sourceOf: (state: DuelPrivateState) => ReplaySource;
  resourcesOf: (state: DuelPrivateState, purpose: "launch" | "restart") => JournalResources | Promise<JournalResources>;
  /** Check the complete source, with the shared bounded replay build, before a prefix can be forked. */
  authorizeSource: (state: DuelPrivateState, actor: OwnerPlayerActor, unchecked: boolean, signal?: AbortSignal) => Promise<JournalResources>;
  /** Recorder is disabled until persistence. The closure supplies the new fork ID after commit. */
  createWorker: (duelId: () => number | undefined, actor: OwnerPlayerActor, session: DuelSession | undefined,
    signal?: AbortSignal) => DuelGameWorker | Promise<DuelGameWorker>;
  /** All engine reads finish before commit. Handoff has no asynchronous failure window. */
  register: (session: DuelSession, worker: DuelGameWorker, views: DuelEngineView[]) => DuelRoom;
  remove: (slug: string, worker: DuelGameWorker) => Promise<void>;
  room: (slug: string, actor: OwnerPlayerActor) => Promise<DuelRoom>;
  timeoutMs?: number;
  isStopped?: () => boolean;
}

/** Launch and restart own their detached worker until successful handoff. Source data is always read-only. */
export function createReplayForkLauncher(options: ForkLaunchOptions) {
  const { db } = options, store = createReplayForkService(db), duels = createDuelService(db);
  let pending = 0;
  const owners = new Set<number>();
  const activeCount = (actor: OwnerPlayerActor) => listActiveReplayForks(db, actor).length;
  const reserve = (actor: OwnerPlayerActor, enforceActive: boolean) => {
    const owner = resolveOwnerPlayer(db, actor);
    if (!owner) throw new ReplayAccessError();
    const count = activeCount(owner);
    if (owners.has(owner.userId)) {
      throw new ReplayForkLaunchError("A replay fork is still launching. Try again shortly.", "ENGINE_BUSY");
    }
    if (enforceActive && count >= REPLAY_FORK_ACTIVE_LIMIT) {
      throw new ReplayForkLaunchError("Replay fork limit reached. Cancel a fork and try again.", "FORK_LIMIT");
    }
    if (pending >= MAX_DETACHED_FORKS) throw new ReplayForkLaunchError("Replay fork workers are busy.", "ENGINE_BUSY");
    pending++; owners.add(owner.userId);
    return () => { pending--; owners.delete(owner.userId); };
  };

  async function detached(actor: OwnerPlayerActor, state: DuelPrivateState, prefixCount: number,
    target: { revision: number } | undefined, save: (defaults: Array<{ seat: number; command: DuelCommand }>, resources: JournalResources,
      rules: JournalRunResult["creationRules"]) => { session: DuelSession; reused: boolean },
    enforceActive: boolean, restore?: () => void, signal?: AbortSignal, selectedResources?: JournalResources): Promise<DuelRoom> {
    signal?.throwIfAborted();
    const release = reserve(actor, enforceActive);
    let worker: DuelGameWorker | undefined, committed: DuelSession | undefined, recorderId: number | undefined;
    const controller = new AbortController();
    const workerSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let expired = false, handedOff = false, timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      signal?.throwIfAborted();
      if (options.isStopped?.()) throw new ReplayForkLaunchError("The duel host is shutting down. Retry the fork request.", "ENGINE_BUSY");
      if (expired) throw new ReplayForkLaunchError("Replay fork engine timed out.", "ENGINE_BUSY");
    };
    const work = async () => {
      const source = options.sourceOf(state);
      const resources = selectedResources ?? await options.resourcesOf(state, restore ? "restart" : "launch"); check();
      const result: JournalRunResult = await runJournalPrefix({ source, resources, prefixCount, target,
        manualLossAnswersAfter: prefixCount,
        createWorker: async () => {
          worker = await options.createWorker(() => recorderId, actor, restore ? state.session : undefined, workerSignal);
          try { check(); workerSignal.throwIfAborted(); }
          catch (error) { try { await worker.close(); } catch { /* Keep the request failure. */ } throw error; }
          return worker;
        } });
      check();
      if (result.views.public.result || !result.views.public.seats.some(s => !s.eliminated)) {
        throw new ReplayForkLaunchError("This checkpoint has no playable engine state.", "NOT_PLAYABLE");
      }
      if (!worker!.setChainMode) throw new ReplayForkLaunchError("This engine has no response-window control.", "ENGINE_UNAVAILABLE_FOR_SOURCE");
      const defaults: Array<{ seat: number; command: DuelCommand }> = [];
      for (const seat of result.views.public.seats.filter(s => !s.eliminated).map(s => s.seat)) {
        const before = await worker!.view(seat); check();
        await worker!.setChainMode(seat, "always"); check();
        defaults.push({ seat, command: { promptId: "chain-mode:always", revision: before.revision, answer: {} } });
      }
      const views: DuelEngineView[] = [];
      for (const seat of source.session.seats) {
        views.push(await worker!.view(seat.seat)); check();
      }
      if (views.some(view => view.result)) throw new ReplayForkLaunchError("This checkpoint has no playable engine state.", "NOT_PLAYABLE");
      check();
      const saved = save(defaults, resources, result.creationRules);
      if (saved.reused) {
        await worker!.close(); worker = undefined;
        check(); return options.room(saved.session.slug, actor);
      }
      committed = saved.session; recorderId = committed.id;
      check();
      const room = options.register(committed, worker!, views); check();
      assertReplayForkAccess(db, committed.slug, actor);
      handedOff = true;
      return room;
    };
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        onAbort = () => reject(signal!.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
      }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new ReplayForkLaunchError("Replay fork engine timed out.", "ENGINE_BUSY")); },
          Math.min(25_000, options.timeoutMs ?? replayForkTimeoutMs(prefixCount)));
      })]);
    } catch (error) {
      if (error instanceof JournalRunnerError && error.cause instanceof RequestError && error.cause.status === 429) throw error.cause;
      if (error instanceof ReplayAccessError || error instanceof ReplayForkLaunchError || error instanceof ReplayCursorError
        || error instanceof ReplayForkStorageError) throw error;
      if (error instanceof Error && "code" in error && error.code === "ENGINE_UNAVAILABLE_FOR_SOURCE") {
        throw new ReplayForkLaunchError("The exact source engine resources are unavailable.", "ENGINE_UNAVAILABLE_FOR_SOURCE");
      }
      const failure = replayBuildError(error);
      throw new ReplayForkLaunchError(failure.message, failure.code);
    } finally {
      controller.abort(new ReplayForkLaunchError("Replay fork request ended.", "ENGINE_BUSY"));
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      if (!handedOff) {
        if (worker) { try { await worker.close(); } catch { /* Worker already exited. */ } }
        if (committed) {
          await options.remove(committed.slug, worker!);
          if (restore) restore();
          else {
            // Cleanup still works after access revocation. Only this new marked row is changed.
            db.prepare(`update duels set status = 'cancelled', ended_at = datetime('now'), archived_at = datetime('now'),
              clock_json = null, result_reason = 'Fork launch failed', winner_player_id = null, winner_seat = null
              where id = ? and kind = 'replay-fork' and status = 'active'`).run(committed.id);
          }
        }
      }
      release();
    }
  }

  return {
    async launch(slug: string, actor: OwnerPlayerActor, request: ReplayForkRequest, signal?: AbortSignal): Promise<ReplayForkResult> {
      if (!resolveOwnerPlayer(db, actor)) throw new ReplayAccessError();
      if (!isReplayForkRequest(request)) throw new ReplayForkLaunchError("Invalid replay fork request.", "INVALID_CURSOR");
      const cursorDigest = createHash("sha256").update(request.cursor).digest("hex");
      const retry = store.retry({ actor, requestId: request.requestId, sourceSlug: slug, sourceVersion: request.sourceVersion, cursorDigest });
      if (retry) {
        const room = await options.room(retry.session.slug, actor);
        assertReplayForkAccess(db, retry.session.slug, actor);
        return { slug: room.session.slug, sourceFrameId: room.fork!.origin.sourceFrameId, initialSeat: room.fork!.actingSeat, room };
      }
      assertOwnerReplaySourceAccess(db, slug, actor);
      const state = duels.privateState(slug, actor.guildId);
      if (isReplayFork(state.session)) {
        throw new ReplayForkLaunchError("A replay fork cannot be forked", "NOT_PLAYABLE");
      }
      const source = options.sourceOf(state);
      if (!["completed", "interrupted"].includes(state.session.status) || replayHasUnsequencedLoss(source)) {
        throw new ReplayForkLaunchError("This source has no safe playable checkpoint.", "NOT_PLAYABLE");
      }
      const claims = resolveReplayCursor(options.codec, request.cursor, source);
      if (claims.sourceVersion !== request.sourceVersion) throw new ReplayCursorError("SOURCE_CHANGED");
      if (claims.frameId !== replayFrameId(claims.sourceVersion, claims.step)) throw new ReplayCursorError("INVALID_CURSOR");
      const resources = await options.authorizeSource(state, actor, request.unchecked === true, signal);
      signal?.throwIfAborted();
      const origin = { sourceSlug: slug, sourceVersion: claims.sourceVersion, frameId: claims.frameId, step: claims.step,
        prefixCount: claims.prefixCount, prefixHash: hashReplayForkPrefix(source.commands.slice(0, claims.prefixCount)),
        sourceSeats: source.session.seats.map(s => ({ seat: s.seat, displayName: s.displayName })) };
      const room = await detached(actor, state, claims.prefixCount, { revision: claims.revision }, (defaults, resources, rules) => db.transaction(() => {
        const savedRetry = store.retry({ actor, requestId: request.requestId, sourceSlug: slug, sourceVersion: request.sourceVersion, cursorDigest });
        if (savedRetry) return savedRetry;
        assertOwnerReplaySourceAccess(db, slug, actor);
        if (claims.sourceVersion !== replaySourceVersion(options.sourceOf(duels.privateState(slug, actor.guildId)))) {
          throw new ReplayCursorError("SOURCE_CHANGED");
        }
        const owner = resolveOwnerPlayer(db, actor)!;
        if (activeCount(owner) >= REPLAY_FORK_ACTIVE_LIMIT) {
          throw new ReplayForkLaunchError("Replay fork limit reached. Cancel a fork and try again.", "FORK_LIMIT");
        }
        const saved = store.create({ actor, requestId: request.requestId, cursorDigest, source, origin,
          ...(resources.engineIdentity ? { resources: { ...rules, engineIdentity: resources.engineIdentity,
            bundleVersion: pinnedEngineVersion(resources.bundleVersion, source.decks.length, resources.engineIdentity.multiOverlayHash) } } : {}) });
        if (!saved.reused) for (const { seat, command } of defaults) duels.recordCommand(saved.session.slug, actor.guildId, seat, command, null);
        return saved;
      }).immediate(), true, undefined, signal, resources);
      return { slug: room.session.slug, sourceFrameId: claims.frameId, initialSeat: room.fork!.actingSeat, room };
    },
    async restart(slug: string, actor: OwnerPlayerActor, signal?: AbortSignal): Promise<DuelRoom> {
      assertReplayForkAccess(db, slug, actor);
      const state = store.privateState(slug, actor), sourceVersion = replaySourceVersion(options.sourceOf(state));
      const count = state.setup!.replayFork!.origin.prefixCount;
      let undo: (() => void) | undefined;
      return detached(actor, state, count, undefined, defaults => db.transaction(() => {
        const current = store.privateState(slug, actor);
        if (sourceVersion !== replaySourceVersion(options.sourceOf(current))) throw new ReplayCursorError("SOURCE_CHANGED");
        const owner = resolveOwnerPlayer(db, actor)!;
        if (current.session.status !== "active" && activeCount(owner) >= REPLAY_FORK_ACTIVE_LIMIT) {
          throw new ReplayForkLaunchError("Replay fork limit reached. Cancel a fork and try again.", "FORK_LIMIT");
        }
        // Keep the previous branch and final board if the replacement worker cannot be registered.
        const row = db.prepare("select * from duels where id = ?").get(state.session.id) as Record<string, unknown>;
        const journal = db.prepare("select * from duel_commands where duel_id = ? order by seq").all(state.session.id) as Array<Record<string, unknown>>;
        undo = () => db.transaction(() => {
          const columns = Object.keys(row).filter(key => key !== "id");
          db.prepare(`update duels set ${columns.map(key => `${key} = ?`).join(", ")} where id = ?`)
            .run(...columns.map(key => row[key]), state.session.id);
          db.prepare("delete from duel_commands where duel_id = ?").run(state.session.id);
          for (const entry of journal) {
            const fields = Object.keys(entry);
            db.prepare(`insert into duel_commands (${fields.join(", ")}) values (${fields.map(() => "?").join(", ")})`)
              .run(...fields.map(key => entry[key]));
          }
        }).immediate();
        db.prepare(`delete from duel_commands where duel_id = ? and seq not in
          (select seq from duel_commands where duel_id = ? order by seq limit ?)`).run(state.session.id, state.session.id, count);
        db.prepare(`update duels set status = 'active', ended_at = null, archived_at = null, winner_player_id = null,
          winner_seat = null, result_reason = null, snapshot_public_json = null, snapshot_seat0_json = null,
          snapshot_seat1_json = null, snapshot_seats_json = null, turn_count = null, snapshot_compacted_at = null, clock_json = null, opening_json = null,
          last_activity_at = datetime('now') where id = ? and kind = 'replay-fork'`).run(state.session.id);
        for (const { seat, command } of defaults) duels.recordCommand(slug, actor.guildId, seat, command, null);
        return { session: duels.get(slug, actor.guildId), reused: false };
      }).immediate(), state.session.status !== "active", () => undo?.(), signal);
    },
  };
}
