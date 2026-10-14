import { afterEach, expect, it, vi } from "vitest";
import { GameWorker } from "../src/worker-client.js";
import { EngineAnswerError } from "../src/prompts.js";
import { EngineResourceUnavailableError } from "../src/engine-resource-resolver.js";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";

const transports = vi.hoisted(() => [] as import("node:events").EventEmitter[]);
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    constructor() { super(); transports.push(this); }
    postMessage() {}
    async terminate() { return 0; }
  } };
});
afterEach(() => { transports.length = 0; setObservabilityAdapter({ report() {}, log() {}, async flush() {} }); });
// Original-stack reporting is owned by worker-stack.test.ts across a real thread.
it.each([
  { response: { answerError: true, name: "EngineAnswerError" }, errorType: EngineAnswerError },
  { response: { code: "ENGINE_UNAVAILABLE_FOR_SOURCE", name: "EngineResourceUnavailableError" }, errorType: EngineResourceUnavailableError },
])("preserves expected $response.name rejections without reporting them", async ({ response, errorType }) => {
  const reports: unknown[] = [];
  setObservabilityAdapter({ report(error) { reports.push(error); }, log() {}, async flush() {} });
  const game = new GameWorker();
  try {
    const result = game.view(0).catch(error => error as Error);
    transports[0].emit("message", { id: 1, ok: false, error: "Rejected request", stack: "worker frame", ...response });
    const error = await result;
    expect(error).toBeInstanceOf(errorType);
    expect(error).toHaveProperty("stack", "worker frame");
    if (error instanceof EngineResourceUnavailableError) expect(error.code).toBe("ENGINE_UNAVAILABLE_FOR_SOURCE");
    expect(reports).toEqual([]);
  } finally { await game.close(); }
});
