import { expect, it, vi } from "vitest";
import { GameWorker } from "../src/worker-client.js";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";

it("preserves the original stack across a real worker thread", async () => {
  const capture = vi.fn();
  setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const worker = new GameWorker(undefined, undefined, "table-stack");
  try {
    const error = await worker.create({ mode: "normal", decks: [], seed: [], dataDirectory: "/tmp/observability-missing-engine" }).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("stack", expect.stringContaining("worker.ts"));
    expect(capture).toHaveBeenCalledWith(error, { tags: { table: "table-stack" } });
  } finally { await worker.close(); }
}, 15_000);
