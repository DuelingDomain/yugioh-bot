import { Worker } from "node:worker_threads";
import type { EngineCoreInfo, EngineDiagnostic, EngineStartupScript } from "./engine.js";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelFormat, DuelMasterRule, DuelMode, DuelSettings } from "@yugidraft/shared/duels";

export interface GameOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  settings?: DuelSettings;
  /** Seat and team layout; `decks` holds one deck per seat. Default `1v1`. */
  format?: DuelFormat;
  /** Saved FIRST_TURN_DRAW flag. */
  firstTurnDraw?: boolean;
  /** Lua chunks that run before the duel starts (hand scenarios). */
  startupScripts?: EngineStartupScript[];
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
  view(seat: number | null): Promise<DuelEngineView>;
  answer(seat: number, promptId: string, answer: DuelAnswer): Promise<void>;
  search(query: string): Promise<DuelCardInfo[]>;
  /** Remove a duelist from a duel with more than two seats. Rejects when the core has no `Debug.EliminateDuelist`. Optional so that test doubles may omit it (the host then uses autopilot). */
  eliminate?(seat: number, reason: number): Promise<void>;
  /** The engine's triage ring buffer (host report only). */
  diagnostics?(): Promise<EngineDiagnostic[]>;
  /** Worker state for debug-trace, reports and the stall watchdog. Optional so that test doubles may omit it. */
  debugState?(): WorkerDebugState;
  close(): Promise<void>;
}

/** A worker owns exactly one core instance; no hidden state leaves via broadcasts. */
export class GameWorker implements DuelGameWorker {
  private readonly worker: Worker;
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private lastOp: string | null = null;
  private lastOpAt: number | null = null;
  private info: EngineCoreInfo | null = null;

  constructor() {
    const development = import.meta.url.endsWith(".ts");
    const module = new URL(development ? "./worker.ts" : "./worker.js", import.meta.url);
    this.worker = development
      ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
      : new Worker(module);
    this.worker.on("message", (message: { id: number; ok: boolean; value?: unknown; error?: string; info?: EngineCoreInfo }) => {
      if (message.info) this.info = message.info;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(message.error ?? "Engine rejected the request"));
    });
    this.worker.on("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on("exit", (code) => this.fail(new Error(`Engine worker exited (${code})`)));
  }

  private fail(error: Error) {
    this.stopped = true;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  get running(): boolean {
    return !this.stopped;
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

  view(seat: number | null): Promise<DuelEngineView> {
    return this.request({ op: "view", seat });
  }

  answer(seat: number, promptId: string, answer: DuelAnswer): Promise<void> {
    return this.request({ op: "answer", seat, promptId, answer });
  }

  search(query: string): Promise<DuelCardInfo[]> {
    return this.request({ op: "search", query });
  }

  eliminate(seat: number, reason: number): Promise<void> {
    return this.request({ op: "eliminate", seat, reason });
  }

  diagnostics(): Promise<EngineDiagnostic[]> {
    return this.request({ op: "diagnostics" });
  }

  async close(): Promise<void> {
    this.fail(new Error("Engine worker closed"));
    await this.worker.terminate();
  }
}
