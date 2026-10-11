import { Worker } from "node:worker_threads";
import type { DuelEngineView, DuelReplay, DuelReplayV2 } from "@yugidraft/shared/duels";

export interface SerializedReplayView { json: string; bytes: number }

/** Shared by the host's bounded replay jobs; only one frame crosses the thread at a time. */
export class ReplayJsonEncoder {
  private worker?: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: SerializedReplayView): void; reject(error: Error): void }>();
  async encode(view: DuelEngineView): Promise<SerializedReplayView> {
    if (!this.worker) {
      const development = import.meta.url.endsWith(".ts");
      const module = new URL(development ? "./replay-json-worker.ts" : "./replay-json-worker.js", import.meta.url);
      const worker = this.worker = development
        ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
        : new Worker(module);
      worker.on("message", message => {
        const request = this.pending.get(message.id); if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error("Replay serialization failed"));
        else request.resolve({ json: message.json, bytes: message.bytes });
        if (!this.pending.size) worker.unref();
      });
      const fail = () => {
        for (const request of this.pending.values()) request.reject(new Error("Replay serialization worker stopped"));
        this.pending.clear();
        if (this.worker === worker) this.worker = undefined;
      };
      worker.once("error", fail); worker.once("exit", fail);
    }
    this.worker.ref();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, view });
    });
  }
  async close(): Promise<void> { await this.worker?.terminate(); this.worker = undefined; }
}

export interface ReplayHttpResult {
  replay: DuelReplay | DuelReplayV2;
  viewJson: string[];
}

/** Reuse worker-encoded views; stringify only the small envelope and frame/cursor metadata.
 * Pull one frame at a time and yield, so the HTTP response cannot monopolize live-table work.
 */
export function replayJsonResponse({ replay, viewJson }: ReplayHttpResult, signal?: AbortSignal): Response {
  const { frames, ...envelope } = replay;
  const encoder = new TextEncoder();
  let index = -1;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise<void>(resolve => setImmediate(resolve));
      signal?.throwIfAborted();
      if (index < 0) {
        controller.enqueue(encoder.encode(JSON.stringify(envelope).slice(0, -1) + ',"frames":[')); index = 0;
      } else if (index < frames.length) {
        const { view: _view, ...metadata } = frames[index]!;
        controller.enqueue(encoder.encode((index ? "," : "") + JSON.stringify(metadata).slice(0, -1)
          + ',"view":' + viewJson[index] + "}")); index++;
      } else { controller.enqueue(encoder.encode("]}")); controller.close(); }
    },
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
