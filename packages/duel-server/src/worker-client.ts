import type { SandboxEngineSnapshot } from "./sandbox-snapshot.js";
import type { DuelScriptError, DuelScriptFatalError } from "./script-errors.js";
import { Worker } from "node:worker_threads";
import type { PromptTraceEntry } from "./prompt-trace.js";
import type { EngineViewHistory, EngineCoreInfo, EngineDiagnostic, EngineStartupScript } from "./engine.js";
import type { DuelWorkerResponse, WorkerCreateTimings } from "./worker-protocol.js";
import { EngineAnswerError } from "./prompts.js";
import { EngineLoopError } from "./engine-loop-error.js";
import { EngineResourceUnavailableError } from "./engine-resource-resolver.js";
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
  create(options: GameOptions): Promise<void>;
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
  private spawnedAt = performance.now();
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

  private onScriptError?: (error: DuelScriptError) => void;
  private onFatalScriptError?: (error: DuelScriptFatalError) => void;

  constructor(onScriptError?: (error: DuelScriptError) => void, onFatalScriptError?: (error: DuelScriptFatalError) => void) {
    this.onScriptError = onScriptError;
    this.onFatalScriptError = onFatalScriptError;
    const development = import.meta.url.endsWith(".ts");
    const module = new URL(development ? "./worker.ts" : "./worker.js", import.meta.url);
    this.worker = development
      ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
      : new Worker(module);
    this.worker.on("message", (message: DuelWorkerResponse) => {
      if (this.stopped) return;
      if (message.ok && message.createTimings) {
        this.createTimings = { ...message.createTimings,
          // Includes thread startup, module imports and transport overhead, before the first create reply.
          workerSpawnMs: Math.max(0, performance.now() - this.spawnedAt - message.createTimings.cardDbLoadMs - message.createTimings.engineCreateMs) };
      }
      for (const error of message.scriptErrors ?? []) this.onScriptError?.(error);
      for (const error of message.fatalScriptErrors ?? []) this.onFatalScriptError?.(error);
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
      else request.reject(message.code === "ENGINE_UNAVAILABLE_FOR_SOURCE"
        ? new EngineResourceUnavailableError("the worker cannot use the recorded engine resources")
        : message.engineLoop ? new EngineLoopError() : message.answerError || message.code
        ? new EngineAnswerError(message.error, message.code)
        : new Error(message.error ?? "Engine rejected the request"));
    });
    this.worker.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on("exit", (code) => this.fail(new Error(`Engine worker exited (${code})`)));
  }

  /**
   * Gives an idle, warmed thread to a game: the callbacks of the game replace the ones it was built with, and the
   * startup clock restarts, so the startup timings only count what the game still waits for.
   */
  adopt(callbacks: { onScriptError?: (error: DuelScriptError) => void; onFatalScriptError?: (error: DuelScriptFatalError) => void }): void {
    this.onScriptError = callbacks.onScriptError;
    this.onFatalScriptError = callbacks.onFatalScriptError;
    this.spawnedAt = performance.now();
  }

  /** Loads the card data in the thread now (the thread is idle). */
  warm(dataDirectory: string): Promise<void> {
    return this.request({ op: "warm", dataDirectory }) as Promise<void>;
  }

  private fail(error: Error) {
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

  sandboxSnapshot(): Promise<SandboxEngineSnapshot> {
    return this.request({ op: "sandbox-snapshot" });
  }

  diagnostics(): Promise<EngineDiagnostic[]> {
    return this.request({ op: "diagnostics" });
  }

  async close(): Promise<void> {
    this.fail(new Error("Engine worker closed"));
    this.prompts.length = 0;
    this.promptStart = 0;
    await this.worker.terminate();
  }
}
