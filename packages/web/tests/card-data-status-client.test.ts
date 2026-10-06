import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("sends the typed status operation with the configured guild actor and HMAC signature", async () => {
  vi.resetModules();
  vi.stubEnv("DUEL_INTERNAL_URL", "https://private-host.example"); vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://private-host.example/internal/duel");
    const raw = String(init?.body);
    expect(JSON.parse(raw)).toEqual({ op: "engine-data-status", guildId: "g", playerId: 7 });
    expect(new Headers(init?.headers).get("x-announce-signature")).toBe(`sha256=${createHmac("sha256", "test-secret").update(raw).digest("hex")}`);
    return Response.json({ generatedAt: "2026-10-01T00:00:00Z", engine: { bundleVersion: "v1" } });
  });
  vi.stubGlobal("fetch", fetch);
  const { callEngineDataStatus } = await import("../src/lib/duel-host");
  const result = await callEngineDataStatus({ guildId: "g", playerId: 7 });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.engine.bundleVersion).toBe("v1");
});
it("preserves 503 when the engine is unreachable", async () => {
  vi.resetModules();
  vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { callEngineDataStatus } = await import("../src/lib/duel-host");
    const result = await callEngineDataStatus({ guildId: "g", playerId: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  } finally { log.mockRestore(); }
});

it.each(["request", "body"])("bounds a hanging status %s to five seconds and aborts the request", async stage => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    if (stage === "request") return new Promise<Response>(() => {});
    return { ok: true, status: 200, text: () => new Promise(() => {}) } as Response;
  }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { callEngineDataStatus } = await import("../src/lib/duel-host");
    const pending = callEngineDataStatus({ guildId: "g", playerId: 7 });
    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(signal?.aborted).toBe(true);
  } finally { log.mockRestore(); }
});

it("keeps the timeout scoped to engine-data-status", async () => {
  vi.resetModules(); vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBeUndefined(); return Response.json({ multiplayerTables: false });
  });
  vi.stubGlobal("fetch", fetch);
  const { callDuelHost } = await import("../src/lib/duel-host");
  expect((await callDuelHost({ op: "capabilities", guildId: "g", playerId: 7 })).ok).toBe(true);
});
