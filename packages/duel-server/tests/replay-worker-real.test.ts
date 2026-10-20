import { expect, it, vi } from "vitest";
import { buildReplayData, buildReplayFrames } from "../src/replay-builder.js";
import { createReplayCursorCodec, replaySourceVersion } from "../src/replay-cursor.js";
import { GameWorker } from "../src/worker-client.js";
import { acceptanceSource } from "./support/replay-acceptance.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

describeWithCores("detached replay worker", [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA), needs.installedMulti(DATA)], () => {
  it.each(["1v1", "ffa3", "tag"] as const)("matches the journal transport for %s, including owner reveal", async format => {
    const { source, resources } = acceptanceSource({ mode: "normal", format, engine: "pinned" });
    const options = { source, resources, sourceVersion: replaySourceVersion(source), dataSeat: 1, reveal: true, finalView: null };
    const worker = new GameWorker();
    try {
      const remote = await worker.buildReplay(options);
      const reference = await buildReplayData({ ...options, createWorker: () => {
        const reference = new GameWorker();
        return new Proxy(reference, { get(target, key) {
          if (key === "buildReplay") return undefined;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      } });
      expect(remote.data).toEqual(reference);
      const frames = await buildReplayFrames({ ...options, codec: createReplayCursorCodec("replay-worker-test"),
        createWorker: () => new GameWorker() });
      expect(frames.map(frame => frame.view)).toEqual(remote.data.frames.map(frame => frame.view));
      expect(frames[0]!.cursor).toBeTypeOf("string");
      expect(remote.finalViews.seats).toHaveLength(source.decks.length);
      expect(remote.data.frames.length).toBeGreaterThan(2);
      expect(remote.data.frames.every(frame => frame.view.prompt === null && !("chainMode" in frame.view))).toBe(true);
    } finally { await worker.close(); }
    expect(worker.running).toBe(false);
  }, 30_000);
  it("preserves size, command and resource failures across the worker boundary", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "1v1", engine: "pinned" });
    const input = { source, resources, sourceVersion: replaySourceVersion(source), dataSeat: null, finalView: null };
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [options, code] of [
      [{ ...input, maxBytes: 1 }, "REPLAY_TOO_LARGE"],
      [{ ...input, source: { ...source, commands: source.commands.map(command => ({ ...command, command: { ...command.command, revision: 999 } })) } }, "REPLAY_MISMATCH"],
      [{ ...input, resources: { ...resources, engineIdentity: { ...resources.engineIdentity, wasmHash: "0".repeat(64) } } }, "ENGINE_UNAVAILABLE_FOR_SOURCE"],
    ] as const) {
      const worker = new GameWorker();
      try { await expect(worker.buildReplay(options)).rejects.toMatchObject({ code }); }
      finally { await worker.close(); }
      expect(worker.running).toBe(false);
    }
    expect(diagnostic).not.toHaveBeenCalled();
    const worker = new GameWorker(undefined, undefined, { table: "replay-source" });
    try {
      const error = await worker.buildReplay({ ...input, source: { ...source, engineIdentity: null },
        resources: { ...resources, engineIdentity: undefined, dataDirectory: "/tmp/replay-missing-cards" } })
        .catch(error => error as Error);
      expect(error).toMatchObject({ code: "ENGINE_BUSY", message: "Replay engine is temporarily unavailable." });
      const events = diagnostic.mock.calls.map(([event]) => event);
      expect(events).toContainEqual(expect.objectContaining({
        message: expect.stringContaining("replay-missing-cards"), stack: expect.stringContaining("cards.ts"),
        tags: { table: "replay-source" },
      }));
    } finally { await worker.close(); diagnostic.mockRestore(); }
  }, 30_000);

  it("terminates a detached build on cancellation", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "ffa3" });
    const controller = new AbortController();
    const workers: GameWorker[] = [];
    const timer = setTimeout(() => controller.abort(new Error("cancel replay")), 50);
    try {
      await expect(buildReplayData({ source, resources, sourceVersion: replaySourceVersion(source), dataSeat: null,
        finalView: null, signal: controller.signal, createWorker: () => { const worker = new GameWorker(); workers.push(worker); return worker; } }))
        .rejects.toMatchObject({ code: "ENGINE_BUSY" });
      expect(workers).toHaveLength(1);
      expect(workers[0]!.running).toBe(false);
    } finally { clearTimeout(timer); await Promise.all(workers.map(worker => worker.close())); }
  }, 30_000);

  it("closes a worker acquired after the build deadline", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "1v1", engine: "pinned" });
    let acquired!: GameWorker;
    let resolveAcquired!: () => void;
    const arrived = new Promise<void>(resolve => { resolveAcquired = resolve; });
    try {
      await expect(buildReplayData({ source, resources, sourceVersion: replaySourceVersion(source), dataSeat: null,
        finalView: null, timeoutMs: 5, createWorker: async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          acquired = new GameWorker(); resolveAcquired(); return acquired;
        } })).rejects.toMatchObject({ code: "ENGINE_BUSY" });
      await arrived;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(acquired.running).toBe(false);
    } finally { await acquired?.close(); }
  }, 30_000);

  it("marks a terminated replay engine as a family failure", async () => {
    const { source, resources } = acceptanceSource({ mode: "normal", format: "1v1", engine: "pinned" });
    const worker = new GameWorker();
    const timer = setTimeout(() => { void Reflect.get(worker, "worker").terminate(); }, 50);
    try {
      await expect(buildReplayData({ source, resources, sourceVersion: replaySourceVersion(source), dataSeat: null,
        finalView: null, createWorker: () => worker })).rejects.toMatchObject({ code: "ENGINE_BUSY", familyFailed: true });
    } finally { clearTimeout(timer); await worker.close(); }
  }, 30_000);

});
