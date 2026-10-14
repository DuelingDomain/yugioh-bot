import { expect, it, vi } from "vitest";
import { reportInteractionError } from "../../src/interactions/errors.js";
import { setObservabilityAdapter } from "@yugidraft/shared/observability";
it("reports a failed error reply without rejecting the interaction handler", async () => {
  const capture = vi.fn(); setObservabilityAdapter({ report: capture, log() {}, async flush() {} });
  const error = new Error("reply failed");
  await expect(reportInteractionError({ isAutocomplete: () => false, isRepliable: () => true, reply: async () => { throw error; } }, new Error("command failed"))).resolves.toBeUndefined();
  expect(capture).toHaveBeenCalledWith(error, { tags: { operation: "[bot] Could not send the error reply" } });
});
