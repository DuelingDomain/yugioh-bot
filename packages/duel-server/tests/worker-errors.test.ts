import { afterEach, expect, it, vi } from "vitest";
import { GameWorker } from "../src/worker-client.js";
import { handleWorkerRequest } from "../src/worker.js";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";

const transports = vi.hoisted(() => [] as import("node:events").EventEmitter[]);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { parentPort: null, Worker: class extends EventEmitter {
    constructor() { super(); transports.push(this); }
    postMessage() {}
    async terminate() { return 0; }
  } };
});
const failure = vi.hoisted(() => {
  const error = new TypeError("core failed");
  error.stack = "TypeError: core failed\n    at workerFrame (worker.ts:10:2)";
  return error;
});
vi.mock("../src/engine.js", () => ({ createEngineGame: async () => { throw failure; } }));
vi.mock("../src/legacy/index.js", () => ({ createLegacyEngineGame: async () => { throw failure; } }));
afterEach(() => { transports.length = 0; setObservabilityAdapter({ report() {}, log() {}, async flush() {} }); });
it("preserves worker error details on the main thread and reports the table", async () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const options = { mode: "normal" as const, decks: [], seed: [], dataDirectory: "/unused" };
  const response = await handleWorkerRequest({ id: 1, op: "create", options });
  expect(response).toMatchObject({ ok: false, name: "TypeError", message: "core failed", error: "core failed", stack: failure.stack });
  const game = new GameWorker(undefined, undefined, "table-one");
  const result = game.create(options).catch(error => error as Error);
  transports[0].emit("message", response);
  const error = await result;
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: "TypeError", message: "core failed", stack: failure.stack });
  expect(capture).toHaveBeenCalledWith(error, { tags: { table: "table-one" } });
  await game.close();
});
it("keeps answer rejections out of reporting", async () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const game = new GameWorker();
  const result = game.view(0).catch(error => error as Error);
  transports[0].emit("message", { id: 1, ok: false, error: "Invalid answer", answerError: true, name: "EngineAnswerError", stack: "worker frame" });
  expect(await result).toMatchObject({ name: "EngineAnswerError", stack: "worker frame" });
  expect(capture).not.toHaveBeenCalled();
  await game.close();
});
