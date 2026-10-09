import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: { discordBotEnabled: true, wsInternalUrl: "http://ws", wsInternalSecret: "ws-secret",
  botAnnounceUrl: "http://bot", botAnnounceSecret: "bot-secret" } }));
import { broadcaster, announcer } from "../src/lib/notify";
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["ws", "discord"])("bounds stalled %s notifications even when fetch never settles", async destination => {
  let settled = false;
  const request = destination === "ws" ? broadcaster.draft({ kind: "status", slug: "s", status: "completed" })
    : announcer.announce({ kind: "draft-status", draftId: 1 });
  void request.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await request;
});
