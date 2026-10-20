import { chainModeOf, toOrdinaryReplayView, teamOfSeat,
  type DuelEngineView, type ReplayErrorCode, type ReplayFrameV2, type ReplayForkStep, type ReplaySource } from "@yugidraft/shared/duels";
import { EngineLoopError } from "./engine-loop-error.js";
import { EngineResourceUnavailableError } from "./engine-resource-resolver.js";
import { eliminationCodeOf } from "./engine.js";
import { JournalRunnerError, runJournalPrefix, validateJournalSource, type JournalResources, type JournalTargetViews } from "./journal-runner.js";
import { replayFrameId, replayPrefixHashes, type ReplayCursorCodec, type ReplayCursorClaims } from "./replay-cursor.js";
import { ReplayJsonEncoder, type SerializedReplayView } from "./replay-json.js";
import type { ReplayWorkerResult } from "./replay-worker.js";
import type { DuelGameWorker } from "./worker-client.js";

// More than three times the largest measured real projection; numeric measurements live in the replay-fork spec.
export const REPLAY_MAX_BUILD_BYTES = 16 * 1024 * 1024;
export const REPLAY_BUILD_TIMEOUT_MS = 25_000;

/** Fixed caps protect live duels regardless of journal/deck length. */
export function replayBuildLimits(_commandCount: number, _seatCount: number) {
  return { timeoutMs: REPLAY_BUILD_TIMEOUT_MS, maxBytes: REPLAY_MAX_BUILD_BYTES };
}

// Local extension: the web/client preserve unknown error codes and show their clear server message.
export type ReplayBuildErrorCode = ReplayErrorCode | "REPLAY_TOO_LARGE";

export class ReplayBuildError extends Error {
  readonly status: number;
  constructor(message: string, readonly code: ReplayBuildErrorCode, readonly familyFailed = false) {
    super(message); this.status = code === "REPLAY_TOO_LARGE" ? 413 : code === "ENGINE_BUSY" ? 503 : 409;
  }
}

export function replayBuildError(error: unknown): ReplayBuildError {
  if (error instanceof ReplayBuildError) return error;
  if (error instanceof EngineResourceUnavailableError || (error instanceof JournalRunnerError && error.code === "ENGINE_UNAVAILABLE_FOR_SOURCE")) {
    return new ReplayBuildError(error.message, "ENGINE_UNAVAILABLE_FOR_SOURCE");
  }
  if (error instanceof JournalRunnerError && error.code !== "ENGINE_BUSY") {
    return new ReplayBuildError("Replay could not reproduce this duel. Use the saved final board if available.", "REPLAY_MISMATCH");
  }
  // Worker and filesystem errors may contain private paths. Keep the external message fixed.
  return new ReplayBuildError(error instanceof EngineLoopError ? "Replay engine stopped at its process limit." : "Replay engine is temporarily unavailable.", "ENGINE_BUSY",
    error instanceof EngineLoopError || (error instanceof JournalRunnerError && error.familyFailed));
}

export interface ReplayBuildOptions {
  /** Persisted fork control boundary supplied by the host. Absent for real-play source journals. */
  manualLossAnswersAfter?: number;
  source: ReplaySource;
  sourceVersion: string;
  resources: JournalResources;
  codec: ReplayCursorCodec;
  dataSeat: number | null;
  /** Server-authorized owner projection only; do not accept this option on the normal replay operation. */
  reveal?: boolean;
  finalView: DuelEngineView | null;
  /** Internal final-state check, before any saved final frame replaces the rebuilt view. */
  verifyFinalViews?: (views: JournalTargetViews) => void;
  createWorker: (signal?: AbortSignal) => DuelGameWorker | Promise<DuelGameWorker>;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Owner-only fallback: finish validating the journal and keep checkpoints after dropping move views. */
  retainStepsOnOverflow?: boolean;
  encodeView?: (view: DuelEngineView) => Promise<SerializedReplayView>;
}

/** An old host-only loss has no safe location in the prefix. Never apply final setup loss flags to early views. */
export function replayHasUnsequencedLoss(source: ReplaySource): boolean {
  return (source.setup?.surrenderedSeats ?? []).some(seat => !source.commands.some(input =>
    input.seat === seat && eliminationCodeOf(input.command.promptId) !== null));
}

/** Only hand/Extra Deck projections are combined. Set cards, private events and logs keep the selected audience. */
export function revealReplayHands(view: DuelEngineView, ownViews: DuelEngineView[]): DuelEngineView {
  return { ...view, seats: view.seats.map(seat => {
    const own = ownViews[seat.seat]?.seats.find(entry => entry.seat === seat.seat);
    return own ? { ...seat, hand: own.hand, extra: own.extra } : seat;
  }) };
}

/** Internal cache data. Prefix claims are projected to sealed cursors only for owner-capable viewers. */
export type ReplayFrameData = Omit<ReplayFrameV2, "cursor" | "kind">
  & ({ kind: "result"; cursor: null } | { kind: "opening" | "engine"; cursor: ReplayCursorClaims | null });

export function projectReplayFrames(frames: ReplayFrameData[], codec: ReplayCursorCodec, canFork: boolean): ReplayFrameV2[] {
  return frames.map(frame => frame.kind === "result" ? { ...frame, cursor: null }
    : { ...frame, cursor: canFork && frame.cursor ? codec.seal(frame.cursor) : null });
}

export type ReplayStepData = Pick<ReplayFrameData, "step" | "frameId" | "actorSeat" | "kind" | "cursor">;
export function projectReplaySteps(steps: ReplayStepData[], codec: ReplayCursorCodec, canFork = true): ReplayForkStep[] {
  return steps.map(step => ({ ...step, cursor: canFork && step.cursor ? codec.seal(step.cursor) : null }));
}

/** Standalone builder used by engine tools/tests; the host projects its shared cache per viewer. */
export async function buildReplayFrames(options: ReplayBuildOptions): Promise<ReplayFrameV2[]> {
  return projectReplayFrames((await buildReplayData(options)).frames, options.codec, true);
}

export interface ReplayBuildData {
  frames: ReplayFrameData[];
  viewJson: string[];
  /** Conservative wire size: each view once, sealed cursor growth and envelope. */
  bytes: number;
  /** Separate conservative cache accounting for view objects and reusable JSON strings. */
  cacheBytes: number;
  steps: ReplayStepData[];
  oversized: boolean;
}

/** Detached read-only re-run. Each call has its own projection delta positions and closes its worker. */
export async function buildReplayData(options: Omit<ReplayBuildOptions, "codec">): Promise<ReplayBuildData> {
  const { source, sourceVersion, dataSeat } = options;
  options.signal?.throwIfAborted();
  if (source.session.status !== "completed" && source.session.status !== "interrupted") {
    throw new ReplayBuildError("Replays are available after the duel ends", "NOT_PLAYABLE");
  }
  const frames: ReplayFrameData[] = [];
  const viewJson: string[] = [];
  const steps: ReplayStepData[] = [];
  let oversized = false;
  let lastFrame: ReplayFrameData | undefined;
  let stepBytes = 64 * 1024;
  const encoder = options.encodeView ? undefined : new ReplayJsonEncoder();
  const encodeView = options.encodeView ?? (view => encoder!.encode(view));
  const seen = { log: 0, events: 0 };
  const limits = replayBuildLimits(source.commands.length, source.decks.length);
  const maxBytes = Math.min(REPLAY_MAX_BUILD_BYTES, options.maxBytes ?? limits.maxBytes);
  let bytes = 64 * 1024; // Envelope/session allowance; frame metadata and cursor growth counted below.
  let worker: DuelGameWorker | undefined;
  const controller = new AbortController();
  const workerSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const playable = !replayHasUnsequencedLoss(source);
  const prefixHashes = replayPrefixHashes(source);
  const append = async (view: DuelEngineView, kind: ReplayFrameV2["kind"], actorSeat: number | null, prefixCount: number) => {
    const log = view.log.filter(entry => entry.id > seen.log);
    const events = view.events.filter(entry => entry.id > seen.events);
    for (const entry of log) seen.log = Math.max(seen.log, entry.id);
    for (const entry of events) seen.events = Math.max(seen.events, entry.id);
    const step = steps.length; const frameId = replayFrameId(sourceVersion, step);
    const result = view.result?.reason === "Surrendered" ? { ...view.result, reason: "Surrender" } : view.result;
    const frame: ReplayFrameData = { step, frameId, kind, actorSeat,
      cursor: kind !== "result" && playable ? {
        sourceId: source.session.id, sourceSlug: source.session.slug, guildId: source.session.guildId,
        sourceVersion, frameId, step, prefixCount, prefixHash: prefixHashes[prefixCount]!, revision: view.revision,
      } : null,
      view: toOrdinaryReplayView({ ...view, log, events, result }) } as ReplayFrameData;
    const { view: _view, ...metadata } = frame;
    // Twice the small claims JSON plus 128 bytes bounds the base64url encrypted cursor.
    const metadataBytes = Buffer.byteLength(JSON.stringify(metadata)) * 2 + 128;
    stepBytes += metadataBytes;
    steps.push(metadata); lastFrame = frame;
    if (oversized) {
      if (stepBytes > maxBytes) throw new ReplayBuildError("Replay checkpoints exceed the size limit.", "REPLAY_TOO_LARGE");
      return;
    }
    const serialized = await encodeView(frame.view);
    bytes += serialized.bytes + metadataBytes;
    if (bytes > maxBytes) {
      if (!options.retainStepsOnOverflow || stepBytes > maxBytes) {
        throw new ReplayBuildError("Replay is too large to load safely (16 MiB limit). Open the saved final board.", "REPLAY_TOO_LARGE");
      }
      oversized = true; frames.length = 0; viewJson.length = 0;
      return;
    }
    frames.push(frame); viewJson.push(serialized.json);
  };
  const check = () => { options.signal?.throwIfAborted(); };
  const work = async () => {
    check();
    validateJournalSource({ source, resources: options.resources, prefixCount: source.commands.length,
      checkpointSeat: dataSeat, manualLossAnswersAfter: options.manualLossAnswersAfter });
    worker = await options.createWorker(workerSignal);
    if (expired || workerSignal.aborted) {
      try { await worker.close(); } catch { /* Preserve the deadline/cancellation failure. */ }
      workerSignal.throwIfAborted();
      throw new ReplayBuildError("Replay timed out.", "ENGINE_BUSY");
    }
    if (worker.buildReplay) {
      // Whitelist data: buildReplayFrames callers may also carry a codec with functions.
      let result: ReplayWorkerResult;
      try { result = await worker.buildReplay({ source, sourceVersion, dataSeat, resources: options.resources,
        manualLossAnswersAfter: options.manualLossAnswersAfter, reveal: options.reveal, finalView: options.finalView,
        maxBytes: options.maxBytes, timeoutMs: options.timeoutMs, retainStepsOnOverflow: options.retainStepsOnOverflow }); }
      catch (error) {
        const failure = replayBuildError(error);
        // A crashed/OOM worker may belong to an unknown historical engine family. Let the
        // host try the other installed family, just as the journal transport does.
        if (!worker.running && failure.code === "ENGINE_BUSY") throw new ReplayBuildError(failure.message, failure.code, true);
        throw error;
      }
      check();
      options.verifyFinalViews?.(result.finalViews);
      return result.data;
    }
    const result = await runJournalPrefix({ source, resources: options.resources, prefixCount: source.commands.length,
      manualLossAnswersAfter: options.manualLossAnswersAfter,
      createWorker: async () => {
        // Adapters without batched execution use the same reserved worker.
        if (expired || workerSignal.aborted) {
          try { await worker!.close(); } catch { /* Keep the request failure. */ }
          workerSignal.throwIfAborted();
          throw new ReplayBuildError("Replay timed out.", "ENGINE_BUSY");
        }
        return worker!;
      }, checkpointSeat: dataSeat,
      checkpointHistory: () => ({ logAfter: seen.log, eventsAfter: seen.events }),
      onCheckpoint: async ({ view, input, actorSeat, beforeRevision, prefixCount }) => {
        check();
        if (expired) throw new ReplayBuildError("Replay timed out.", "ENGINE_BUSY");
        if (input && chainModeOf(input.command.promptId) !== null && view.revision === beforeRevision) return;
        if (options.reveal) {
          const seats: DuelEngineView[] = [];
          for (let seat = 0; seat < source.decks.length; seat++) seats.push(seat === dataSeat ? view : await worker!.view(seat));
          view = revealReplayHands(view, seats);
        }
        await append(view, view.result ? "result" : prefixCount === 0 ? "opening" : "engine", actorSeat, prefixCount);
      },
    });
    if (expired) throw new ReplayBuildError("Replay timed out.", "ENGINE_BUSY");
    check();
    options.verifyFinalViews?.(result.views);
    const last = dataSeat === null ? result.views.public : result.views.seats[dataSeat]!;
    if (!last.result) {
      const session = source.session;
      let final = options.finalView ?? { ...last, log: [], events: [], result: { winnerSeat: session.winnerSeat,
        ...(session.format === "tag" ? { winnerTeam: session.winnerSeat === null ? null : teamOfSeat("tag", session.winnerSeat) } : {}),
        reason: session.resultReason ?? "Duel ended" } };
      // A saved final snapshot can have a host-only result. Its reveal projection is supplied by the authorized caller.
      if (options.reveal && !options.finalView) final = revealReplayHands(final, result.views.seats);
      await append(final, "result", null, source.commands.length);
    }
    if (oversized) {
      // Keep one final board; the separate step list never pretends to display earlier boards.
      const frame: ReplayFrameData = { ...lastFrame!, kind: "result", cursor: null };
      const serialized = await encodeView(frame.view);
      bytes = stepBytes;
      if (bytes + serialized.bytes <= maxBytes) {
        bytes += serialized.bytes; frames.push(frame); viewJson.push(serialized.json);
      }
    }
    return { frames, viewJson, bytes, cacheBytes: bytes * 2, steps, oversized };
  };
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      onAbort = () => reject(options.signal!.reason);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new ReplayBuildError("Replay timed out.", "ENGINE_BUSY")); }, Math.min(REPLAY_BUILD_TIMEOUT_MS, options.timeoutMs ?? limits.timeoutMs));
    })]);
  } catch (error) { throw replayBuildError(error); }
  finally {
    controller.abort(new ReplayBuildError("Replay request ended.", "ENGINE_BUSY"));
    clearTimeout(timer);
    await encoder?.close();
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    if (worker?.running) { try { await worker.close(); } catch { /* The detached worker may already have exited. */ } }
  }
}

/** Keys must include source version, verified resources, projection and reveal. Recheck access before every call. */
export class ReplayBuildCache<T = unknown> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly rejected = new Map<string, ReplayBuildError>();
  private totalBytes = 0;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly sizeOf: (value: T) => number, private readonly limits: { maxBytes: number; maxEntries: number; maxConcurrent: number; maxWaiting?: number }
    = { maxBytes: 64 * 1024 * 1024, maxEntries: 16, maxConcurrent: 2, maxWaiting: 8 }) {}
  get size() { return this.entries.size; }
  get bytes() { return this.totalBytes; }
  async getOrBuild(key: string, build: () => Promise<T>, cacheFamilyFailures = false): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return cached.value; }
    const rejected = this.rejected.get(key);
    if (rejected) {
      this.rejected.delete(key);
      if (rejected.code === "REPLAY_TOO_LARGE" || cacheFamilyFailures) { this.rejected.set(key, rejected); throw rejected; }
    }
    const pending = this.pending.get(key); if (pending) return pending;
    let ready: Promise<void>;
    if (this.active < this.limits.maxConcurrent) { this.active++; ready = Promise.resolve(); }
    else {
      if (this.waiting.length >= (this.limits.maxWaiting ?? 8)) {
        throw new ReplayBuildError("Replay workers are busy. Try again shortly.", "ENGINE_BUSY");
      }
      ready = new Promise(resolve => this.waiting.push(resolve));
    }
    const job = ready.then(build).then(value => {
      const bytes = this.sizeOf(value);
      if (bytes > this.limits.maxBytes) throw new ReplayBuildError("Replay is too large to load safely. Open the saved final board.", "REPLAY_TOO_LARGE");
      if (this.limits.maxEntries > 0) {
        while (this.entries.size && (this.entries.size >= this.limits.maxEntries || this.totalBytes + bytes > this.limits.maxBytes)) {
          const oldest = this.entries.keys().next().value!; this.totalBytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
        }
        this.entries.set(key, { value, bytes }); this.totalBytes += bytes;
      }
      return value;
    }).catch(error => {
      // The first checked family's mismatch survives a budget retry. Other families and transient failures retry.
      if (error instanceof ReplayBuildError && this.limits.maxEntries > 0 && (error.code === "REPLAY_TOO_LARGE"
        || (cacheFamilyFailures && (error.code === "REPLAY_MISMATCH" || error.code === "REPLAY_UNVERIFIED")))) {
        while (this.rejected.size >= this.limits.maxEntries) this.rejected.delete(this.rejected.keys().next().value!);
        this.rejected.set(key, error);
      }
      throw error;
    }).finally(() => {
      this.pending.delete(key);
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    });
    this.pending.set(key, job); return job;
  }
  async settle(): Promise<void> { await Promise.allSettled(this.pending.values()); }
  clear(): void { this.entries.clear(); this.rejected.clear(); this.totalBytes = 0; }
}
