import { expect, it, vi } from "vitest";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";
vi.mock("@/lib/session-identity", () => ({ auth: vi.fn() }));
import { duelErrorResponse } from "../src/lib/duel-host";
it("reports unexpected route errors and preserves the current response", async () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const error = new Error("route failed");
  const response = duelErrorResponse(error);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to process duel request" });
  expect(capture).toHaveBeenCalledWith(error, { tags: { operation: "[api/duels]" } });
});
