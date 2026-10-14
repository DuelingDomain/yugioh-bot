import { useConsoleObservability } from "../../shared/tests/helpers/recording-observability.mjs";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("sends the typed status operation with the configured guild actor and HMAC signature", async () => {
  vi.resetModules(); await output.install();
  vi.stubEnv("DUEL_INTERNAL_URL", "https://private-host.example"); vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://private-host.example/internal/duel");
    expect(await readSignedRequest(new Request(url, init), { secret: "test-secret", purpose: "duel-host" }))
      .toEqual({ ok: true, body: { op: "engine-data-status", guildId: "g", playerId: 7 } });
    return Response.json({ generatedAt: "2026-10-01T00:00:00Z", engine: { bundleVersion: "v1" } });
  });
  vi.stubGlobal("fetch", fetch);
  const { callEngineDataStatus } = await import("../src/lib/duel-host");
  const result = await callEngineDataStatus({ guildId: "g", playerId: 7 });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.engine.bundleVersion).toBe("v1");
});
it("preserves 503 when the engine is unreachable", async () => {
  vi.resetModules(); await output.install();
  vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  output.warnings.length = 0;
  try {
    const { callEngineDataStatus } = await import("../src/lib/duel-host");
    const result = await callEngineDataStatus({ guildId: "g", playerId: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  } finally { output.warnings.length = 0; }
});

it.each(["request", "body"])("bounds a hanging status %s to five seconds and aborts the request", async stage => {
  vi.resetModules(); await output.install(); vi.useFakeTimers();
  vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    if (stage === "request") return new Promise<Response>(() => {});
    return { ok: true, status: 200, text: () => new Promise(() => {}) } as Response;
  }));
  output.warnings.length = 0;
  try {
    const { callEngineDataStatus } = await import("../src/lib/duel-host");
    const pending = callEngineDataStatus({ guildId: "g", playerId: 7 });
    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
    expect(signal?.aborted).toBe(true);
  } finally { output.warnings.length = 0; }
});

it("keeps the timeout scoped to engine-data-status", async () => {
  vi.resetModules(); await output.install(); vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBeUndefined(); return Response.json({ multiplayerTables: false });
  });
  vi.stubGlobal("fetch", fetch);
  const { callDuelHost } = await import("../src/lib/duel-host");
  expect((await callDuelHost({ op: "capabilities", guildId: "g", playerId: 7 })).ok).toBe(true);
});

const output = useConsoleObservability();
