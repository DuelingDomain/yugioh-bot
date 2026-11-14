import type { KwsWorkerIn, KwsWorkerOut } from "./kws-worker";
import type { AsrWorkerOut } from "./asr-worker";
import type { KwsReady } from "./kws-client";

export type WorkerUtterance = Extract<KwsWorkerOut | AsrWorkerOut, { type: "utterance" }>;
export type WorkerInit = Extract<KwsWorkerIn, { type: "init" }>;

/** Owned worker transport; callers serialize ASR requests while KWS frames can stream continuously. */
export class SpeechWorker {
  private worker: Worker | undefined;
  private loading: Promise<KwsReady> | undefined;
  private pending = new Map<number, { resolve(value: WorkerUtterance): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private loadTimer: ReturnType<typeof setTimeout> | undefined;
  private rejectLoad: ((error: Error) => void) | undefined;
  private stopped = false;
  private failure: Error | undefined;
  constructor(private readonly init: WorkerInit, private readonly events: {
    work?(busyMs: number, audioMs: number): void; keywords?(accepted: boolean): void;
    error(message: string): void;
  }) {}
  start(): Promise<KwsReady> {
    if (this.loading) return this.loading;
    const started = performance.now();
    this.loading = new Promise((resolve, reject) => {
      this.rejectLoad = reject;
      const timer = this.loadTimer = setTimeout(() => this.fail(new Error("Worker initialization timed out (120 seconds)")), 120000);
      const worker = this.worker = new Worker(`${this.init.base}worker.js`, { type: "module" });
      worker.onerror = event => this.fail(new Error(event.message || "Speech worker failed"));
      worker.onmessage = (event: MessageEvent<KwsWorkerOut | AsrWorkerOut>) => {
        if (this.stopped) return;
        const m = event.data;
        if (m.type === "ready") {
          clearTimeout(timer); this.rejectLoad = undefined;
          if (!m.accepted) { this.fail(new Error("Worker rejected the phase/turn phrase list")); reject(new Error("Worker rejected the phase/turn phrase list")); return; }
          resolve({ ...m, totalMs: performance.now() - started });
        } else if (m.type === "work") this.events.work?.(m.busyMs, m.audioMs);
        else if (m.type === "keywords") this.events.keywords?.(m.accepted);
        else if (m.type === "utterance") {
          const pending = this.pending.get(m.id); this.pending.delete(m.id);
          if (pending) { clearTimeout(pending.timer); pending.resolve(m); }
        } else if (m.type === "error") { clearTimeout(timer); this.fail(new Error(m.message)); }
      };
      worker.postMessage(this.init);
    });
    return this.loading;
  }
  private fail(error: Error) {
    this.failure = error; clearTimeout(this.loadTimer); this.rejectLoad?.(error); this.rejectLoad = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!this.stopped) this.events.error(error.message);
  }
  send(message: KwsWorkerIn) { if (!this.stopped) this.worker?.postMessage(message); }
  end(id: number): Promise<WorkerUtterance> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.stopped) return Promise.reject(new Error("Listener stopped"));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timer: setTimeout(() => this.fail(new Error("Worker utterance timed out (60 seconds)")), 60000) });
      this.send({ type: "end", id });
    });
  }
  async decode(id: number, samples: Float32Array) {
    await this.start();
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error("Listener stopped");
    this.send({ type: "frames", samples }); return this.end(id);
  }
  stop() {
    this.stopped = true; this.fail(new Error("Listener stopped")); this.worker?.terminate(); this.worker = undefined;
  }
}
