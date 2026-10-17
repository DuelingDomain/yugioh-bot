import { afterEach, expect, it, vi } from "vitest";
import { createBroadcaster } from "../../src/notify/broadcaster.js";
import { setObservabilityAdapter } from "../../src/observability/index.js";
import { consoleAdapter } from "../../src/observability/console-adapter.js";
afterEach(() => setObservabilityAdapter(consoleAdapter));
it("logs rejected broadcasts without including response text", async () => {
  const warning = vi.fn(); const capture = vi.fn();
  setObservabilityAdapter({ report: capture, log: warning, async flush() {} });
  await createBroadcaster({ post: async () => ({ ok: false, status: 503, text: "private response" }) }).draft({ kind: "seats", slug: "private-slug" });
  expect(warning).toHaveBeenCalledWith("warn", "Broadcast rejected", { channel: "draft", kind: "seats", status: 503 });
  expect(capture).not.toHaveBeenCalled();
});
