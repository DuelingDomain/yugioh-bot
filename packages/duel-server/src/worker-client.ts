import type { ReplayWorkerOptions, ReplayWorkerResult } from "./replay-worker.js";
import { workerResponseError } from "./worker-error.js";
import { report } from "@yugidraft/shared/observability";
import type { DuelScriptError, DuelScriptFatalError } from "./script-errors.js";
import { Worker } from "node:worker_threads";
import { RequestError } from "./request-error.js";
import { workerLimitsFromEnv } from "./config.js";
import type { PromptTraceEntry } from "./prompt-trace.js";
import type { EngineCoreInfo, EngineDiagnostic, EngineStartupScript, EngineViewHistory } from "./engine.js";
import type { DuelWorkerResponse, WorkerCreateTimings } from "./worker-protocol.js";
import type { DuelAnswer, DuelCardInfo, DuelChainMode, DuelDeck, DuelEngineChoice, DuelEngineView, DuelFormat, DuelMasterRule, DuelMode, DuelSettings, DuelScriptErrorMode, EngineIdentity } from "@yugidraft/shared/duels";

const PROMPT_LOG_LIMIT = 5_000;

export interface GameOptions {
  /** Internal fork control boundary in accepted journal commands. Original prefix rules stay unchanged. */
  manualLossAnswersAfter?: number;
  engineIdentity?: EngineIdentity;
  scriptErrorMode?: DuelScriptErrorMode;
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  /** Saved creation rules, including settings.genesys for field geometry; omission keeps the historical layout. */
  settings?: DuelSettings;
  /** Seat and team layout; `decks` holds one deck per seat. Default `1v1`. */
  format?: DuelFormat;
  /** Saved FIRST_TURN_DRAW flag. */
  firstTurnDraw?: boolean;
  /** Server-selected exact multi overlay for a saved journal. */
  multiScriptsDirectory?: string;
  /** Lua chunks that run before the duel starts (hand scenarios). */
  startupScripts?: EngineStartupScript[];
  /** Engine of a 1v1 table (see `DuelWorkerCreateOptions.engine`). Absent: the merged engine. */
  engine?: DuelEngineChoice;
}

/** What the host knows about a worker without asking it (the worker may be stuck inside the core). */
export interface WorkerDebugState {
  /** A request is still waiting for its answer. */
  busy: boolean;
  lastOp: string | null;
  /** When the last request was sent (ms since epoch), or null. */
  lastOpAt: number | null;
  /** The core identity and counters as of the last completed request. */
  wasmSha: string | null;
  wasmFile: string | null;
  callsSinceLastPrompt: number;
  messagesSinceLastPrompt: number;
}

export interface DuelGameWorker {
  readonly running: boolean;
  readonly closing?: boolean;
  /** Bound the complete recovery/replay initialization before live operations resume. */
  initialize?<T>(work: () => Promise<T>): Promise<T>;
  create(options: GameOptions): Promise<void>;
  /** Optional batched replay; test doubles and older adapters retain the journal transport. */
  buildReplay?(options: ReplayWorkerOptions): Promise<ReplayWorkerResult>;
  view(seat: number | null, history?: EngineViewHistory): Promise<DuelEngineView>;
  answer(seat: number, promptId: string, answer: DuelAnswer): Promise<void>;
  search(query: string, seat?: number): Promise<DuelCardInfo[]>;
  /** Flag a core loss. `atTurnEnd` identifies retired journal commands, which the engine refuses. */
  eliminate?(seat: number, reason: number, atTurnEnd?: boolean): Promise<void>;
  /**
   * Set a seat's chain response mode. True when it passed the window that was open for the seat (the duel moved on);
   * false when it only stored the mode. Optional so that test doubles may omit it (the host then refuses the toggle).
   */
  setChainMode?(seat: number, mode: DuelChainMode): Promise<boolean>;
  /** The engine's triage ring buffer (host report only). */
  diagnostics?(): Promise<EngineDiagnostic[]>;
  /** Worker state for debug-trace, reports and the stall watchdog. Optional so that test doubles may omit it. */
  debugState?(): WorkerDebugState;
  /** Scenario-only snapshot of the last 5,000 prompts, oldest first, captured before any next answer. */
  promptLog?(): readonly PromptTraceEntry[];
  /** Startup costs from this thread, without any game or actor data. */
  startupTimings?(): (WorkerCreateTimings & { workerSpawnMs: number }) | null;
  close(): Promise<void>;
}

/** A worker owns exactly one core instance; no hidden state leaves via broadcasts. */
export class GameWorker implements DuelGameWorker {
  private readonly worker: Worker;
  private readonly spawnedAt = performance.now();
  private createTimings: (WorkerCreateTimings & { workerSpawnMs: number }) | null = null;
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private lastOp: string | null = null;
  private lastOpAt: number | null = null;
  private info: EngineCoreInfo | null = null;
  private readonly prompts: PromptTraceEntry[] = [];
  /** Index of the oldest prompt in the ring. Writes never shift the retained entries. */
  private promptStart = 0;

  private readonly table?: string | (() => string | undefined);

  constructor(onScriptError?: (error: DuelScriptError) => void, onFatalScriptError?: (error: DuelScriptFatalError) => void,
    options: { heapMb?: number; onExit?: () => void; table?: string | (() => string | undefined) } = {}) {
    this.table = options.table;
    const development = import.meta.url.endsWith(".ts");
    const module = new URL(development ? "./worker.ts" : "./worker.js", import.meta.url);
    const resourceLimits = { maxOldGenerationSizeMb: options.heapMb ?? workerLimitsFromEnv().heapMb };
    this.worker = development
      ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true, resourceLimits })
      : new Worker(module, { resourceLimits });
    this.worker.on("message", (message: DuelWorkerResponse) => {
      if (this.stopped) return;
      if (message.ok && message.createTimings) {
        this.createTimings = { ...message.createTimings,
          // Includes thread startup, module imports and transport overhead, before the first create reply.
          workerSpawnMs: Math.max(0, performance.now() - this.spawnedAt - message.createTimings.cardDbLoadMs - message.createTimings.engineCreateMs) };
      }
      for (const error of message.scriptErrors ?? []) onScriptError?.(error);
      for (const error of message.fatalScriptErrors ?? []) onFatalScriptError?.(error);
      if (message.ok && message.info) this.info = message.info;
      if (message.ok && message.promptTrace) {
        const latest = this.prompts[(this.promptStart + this.prompts.length - 1) % PROMPT_LOG_LIMIT];
        if (latest?.promptId !== message.promptTrace.promptId) {
          if (this.prompts.length < PROMPT_LOG_LIMIT) this.prompts.push(message.promptTrace);
          else {
            this.prompts[this.promptStart] = message.promptTrace;
            this.promptStart = (this.promptStart + 1) % PROMPT_LOG_LIMIT;
          }
        }
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else {
        const error = workerResponseError(message);
        if (!message.answerError && !message.code && !message.replayError) this.reportError(error);
        request.reject(error);
      }
    });
    this.worker.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on("exit", (code) => {
      this.fail(new Error(`Engine worker exited (${code})`));
      options.onExit?.();
    });
  }

  private reportError(error: Error) {
    let table: string | undefined;
    try { table = typeof this.table === "function" ? this.table() : this.table; } catch {}
    report(error, table ? { tags: { table } } : {});
  }

  private fail(error: Error, unexpected = true) {
    if (this.stopped) return;
    if (unexpected) this.reportError(error);
    this.stopped = true;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  get running(): boolean {
    return !this.stopped;
  }

  startupTimings(): (WorkerCreateTimings & { workerSpawnMs: number }) | null {
    return this.createTimings ? { ...this.createTimings } : null;
  }

  promptLog(): readonly PromptTraceEntry[] {
    return this.prompts.slice(this.promptStart).concat(this.prompts.slice(0, this.promptStart));
  }

  debugState(): WorkerDebugState {
    return {
      busy: this.pending.size > 0,
      lastOp: this.lastOp,
      lastOpAt: this.lastOpAt,
      wasmSha: this.info?.wasmSha ?? null,
      wasmFile: this.info?.wasmFile ?? null,
      callsSinceLastPrompt: this.info?.callsSinceLastPrompt ?? 0,
      messagesSinceLastPrompt: this.info?.messagesSinceLastPrompt ?? 0,
    };
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Engine worker is no longer running"));
    const id = ++this.sequence;
    this.lastOp = String(message.op ?? "");
    this.lastOpAt = Date.now();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  buildReplay(options: ReplayWorkerOptions): Promise<ReplayWorkerResult> {
    return this.request({ op: "replay", options });
  }

  create(options: GameOptions): Promise<void> {
    return this.request({ op: "create", options });
  }

  view(seat: number | null, history?: EngineViewHistory): Promise<DuelEngineView> {
    return this.request({ op: "view", seat, ...(history ? { history } : {}) });
  }

  answer(seat: number, promptId: string, answer: DuelAnswer): Promise<void> {
    return this.request({ op: "answer", seat, promptId, answer });
  }

  search(query: string, seat?: number): Promise<DuelCardInfo[]> {
    return this.request({ op: "search", query, seat });
  }

  eliminate(seat: number, reason: number, atTurnEnd = false): Promise<void> {
    return this.request({ op: "eliminate", seat, reason, atTurnEnd });
  }

  setChainMode(seat: number, mode: DuelChainMode): Promise<boolean> {
    return this.request({ op: "chain-mode", seat, mode });
  }

  diagnostics(): Promise<EngineDiagnostic[]> {
    return this.request({ op: "diagnostics" });
  }

  async close(): Promise<void> {
    this.fail(new Error("Engine worker closed"), false);
    this.prompts.length = 0;
    this.promptStart = 0;
    await this.worker.terminate();
  }
}

export interface LimitedGameWorker extends DuelGameWorker {
  initialize<T>(work: () => Promise<T>): Promise<T>;
}

export function limitWorkerOperations(worker: DuelGameWorker, timeoutMs: number, onClose: () => void, createTimeoutMs = workerLimitsFromEnv().createTimeoutMs): LimitedGameWorker {
  let stopped = false;
  let initializing = false;
  let closing: Promise<void> | undefined;
  const pending = new Set<(error: Error) => void>();
  const timeoutError = () => new RequestError("The duel engine did not answer in time.", 503);
  const operations = new Set(["create", "view", "answer", "search", "eliminate", "setChainMode", "diagnostics", "buildReplay"]);

  function bounded<T>(work: () => Promise<T>, ms: number, isClose = false): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    let cancel: (error: Error) => void;
    const result = new Promise<T>((resolve, reject) => {
      cancel = reject;
      if (!isClose) pending.add(cancel);
      timer = setTimeout(() => {
        reject(timeoutError());
        if (!isClose) void close().catch(() => {});
      }, ms);
      Promise.resolve().then(work).then(resolve, reject);
    });
    return result.finally(() => { clearTimeout(timer); pending.delete(cancel); });
  }

  function close(): Promise<void> {
    if (closing) return closing;
    stopped = true;
    for (const cancel of pending) cancel(new RequestError("The duel engine is no longer running.", 503));
    closing = bounded(async () => {
      await worker.close();
      onClose();
    }, timeoutMs, true);
    return closing;
  }

  async function initialize<T>(work: () => Promise<T>): Promise<T> {
    if (stopped) throw new RequestError("The duel engine is no longer running.", 503);
    initializing = true;
    try {
      return await bounded(work, createTimeoutMs);
    } finally {
      initializing = false;
    }
  }

  return new Proxy(worker, {
    get(target, key) {
      if (key === "running") return !stopped && target.running;
      if (key === "closing") return closing !== undefined;
      if (key === "close") return close;
      if (key === "initialize") return initialize;
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!operations.has(String(key))) return value.bind(target);
      return (...args: unknown[]) => {
        if (stopped) return Promise.reject(new RequestError("The duel engine is no longer running.", 503));
        return bounded(() => value.apply(target, args), initializing || key === "create" || key === "buildReplay" ? createTimeoutMs : timeoutMs);
      };
    },
  }) as LimitedGameWorker;
}
