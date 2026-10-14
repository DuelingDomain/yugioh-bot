import { expect, it, vi } from "vitest";
import { useConsoleObservability } from "../../shared/tests/helpers/recording-observability.mjs";
vi.mock("@/lib/session-identity", () => ({ auth: vi.fn() }));
import { duelErrorResponse } from "../src/lib/duel-host";
it("reports unexpected route errors and returns a safe response", async () => {
  const error = new Error("route failed");
  const response = duelErrorResponse(error);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Something went wrong" });
  expect(output.errors).toEqual([expect.objectContaining({
    name: "Error", message: "route failed", tags: { operation: "[api/duels]" },
  })]);
});

const output = useConsoleObservability();
