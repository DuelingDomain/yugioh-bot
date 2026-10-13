import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { seatCountFor } from "@yugidraft/shared/duels";
import { resolveMultiScriptsDirectory } from "./multi-scripts.js";
import { EngineResourceUnavailableError, type EngineResources, type ResourceOptions } from "./engine-resource-resolver.js";

/** Host-only memory cache. Validate mtimes/sizes and hash changed resources in a separate thread.
 * Engine worker creation still hashes every byte as the exact resource gate.
 */
export class EngineResourceCache {
  private readonly entries = new Map<string, EngineResources>();
  private readonly jobs = new Map<string, Promise<EngineResources>>();
  private worker?: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, { accept: (resources: EngineResources) => void; reject: (error: Error) => void }>();
  private closed = false;
  private hashes = 0;
  /** Number of complete resource hashes; useful for cache/latency diagnostics. */
  get hashCount(): number { return this.hashes; }

  private load(key: string, directory: string, options: ResourceOptions, roots: string[]): Promise<EngineResources> {
    if (!this.worker) {
      const source = fileURLToPath(import.meta.url).endsWith(".ts");
      const module = new URL(source ? "./engine-resource-worker.ts" : "./engine-resource-worker.js", import.meta.url);
      const worker = this.worker = source
        ? new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(module.href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true })
        : new Worker(module);
      worker.on("message", message => {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.resources) this.entries.set(message.key, message.resources);
        const resources = this.entries.get(message.key);
        if (!message.error && resources) { this.hashes = message.hashCount; request.accept(resources); }
        else request.reject(new EngineResourceUnavailableError("the current engine resources are incomplete"));
        if (!this.pending.size) worker.unref();
      });
      const fail = () => {
        for (const request of this.pending.values()) request.reject(new EngineResourceUnavailableError("the resource hash worker stopped"));
        this.pending.clear(); this.entries.clear();
        if (this.worker === worker) this.worker = undefined;
      };
      worker.once("error", fail); worker.once("exit", fail);
    }
    this.worker.ref();
    const id = ++this.sequence;
    return new Promise((accept, reject) => {
      this.pending.set(id, { accept, reject });
      this.worker!.postMessage({ id, key, directory, options, roots });
    });
  }

  async get(dataDirectory: string, options: ResourceOptions): Promise<EngineResources> {
    if (this.closed) throw new EngineResourceUnavailableError("the engine resource cache is closed");
    try {
      const directory = resolve(dataDirectory);
      const wrapper = dirname(fileURLToPath(import.meta.resolve("ocgcore-wasm/package.json")));
      const multi = seatCountFor(options.format ?? "1v1") > 2;
      const overlay = multi ? options.multiScriptsDirectory ?? resolveMultiScriptsDirectory(directory) : undefined;
      if (multi && !overlay) throw new Error("Missing overlay");
      const selected = { ...options, ...(overlay ? { multiScriptsDirectory: resolve(overlay) } : {}) };
      const key = JSON.stringify([directory, selected.mode, selected.format ?? "1v1", selected.engine ?? "pinned", overlay ?? null]);
      const pending = this.jobs.get(key); if (pending) return pending;
      const job = this.load(key, directory, selected, [
        ...["manifest.json", "cards.cdb", "card-remaps.json", "card-scripts", "ocgcore.standard.wasm", "ocgcore.domain.wasm",
          "ocgcore.domain.legacy.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm", "ocgcore.multi.SOURCE", "ocgcore.multi-domain.SOURCE"]
          .map(file => join(directory, file)),
        ...["package.json", "dist", "lib/ocgcore.sync.mjs", "lib/ocgcore.sync.wasm"].map(file => join(wrapper, file)),
        ...(overlay ? [resolve(overlay)] : []),
      ]);
      this.jobs.set(key, job);
      try { return await job; } finally { this.jobs.delete(key); }
    } catch { throw new EngineResourceUnavailableError("the current engine resources are incomplete"); }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.worker) await this.worker.terminate();
    this.entries.clear();
  }
}
