import { expect, it, vi } from "vitest";
import { GameWorker } from "../src/worker-client.js";

it("preserves the original stack and resolves table context when a real worker fails", async () => {
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  let table = "source-table";
  const worker = new GameWorker(undefined, undefined, { table: () => table });
  try {
    const result = worker.create({ mode: "normal", decks: [], seed: [], dataDirectory: "/tmp/observability-missing-engine" }).catch(error => error as Error);
    // Fork persistence assigns the destination slug while the thread is still running.
    table = "fork-table";
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("stack", expect.stringContaining("worker.ts"));
    const events = diagnostic.mock.calls.map(([event]) => event);
    expect(events).toEqual([expect.objectContaining({
      name: "Error", message: expect.any(String), stack: expect.stringContaining("worker.ts"),
      tags: { table: "fork-table" },
    })]);
  } finally { await worker.close(); diagnostic.mockRestore(); }
}, 15_000);
