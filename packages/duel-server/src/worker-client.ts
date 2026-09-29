import { Worker } from "node:worker_threads";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelEngineView, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";

export interface GameOptions {
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
}

export interface DuelGameWorker {
  readonly running: boolean;
  create(options: GameOptions): Promise<void>;
  view(seat: number | null): Promise<DuelEngineView>;
  answer(seat: number, promptId: string, answer: DuelAnswer): Promise<void>;
  search(query: string): Promise<DuelCardInfo[]>;
  close(): Promise<void>;
}

/** A worker owns exactly one core instance; no hidden state leaves via broadcasts. */
export class GameWorker implements DuelGameWorker {
  private readonly worker: Worker;
  private sequence = 0;
  private stopped = false;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor() {
    const development = import.meta.url.endsWith(".ts");
    const module = new URL(development ? "./worker.ts" : "./worker.js", import.meta.url);
    this.worker = development
      ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
      : new Worker(module);
    this.worker.on("message", (message: { id: number; ok: boolean; value?: unknown; error?: string }) => {
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

  private request<T>(message: Record<string, unknown>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Engine worker is no longer running"));
    const id = ++this.sequence;
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

  async close(): Promise<void> {
    this.fail(new Error("Engine worker closed"));
    await this.worker.terminate();
  }
}
