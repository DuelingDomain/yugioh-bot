import { expect, it, vi } from "vitest";
import { createLoop } from "../src/loop.js";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";
it("reports a failed tick and continues processing", async () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const error = new Error("tick failed");
  const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const loop = createLoop(run);
  await loop.tick(); await loop.tick(); await loop.stop();
  expect(capture).toHaveBeenCalledWith(error, { tags: { operation: "[worker] tick failed" } });
  expect(run).toHaveBeenCalledTimes(2);
});
