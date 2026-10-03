import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { MULTI_CORE_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";

const { create, host } = vi.hoisted(() => ({ create: vi.fn(), host: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({
  requireDuelActor: vi.fn(async () => ({ ok: true, guildId: "g1", playerId: 1, duels: { create } })),
  duelErrorResponse: vi.fn(),
  callDuelHost: host,
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn() }));

import { POST } from "../app/api/duels/route";

function request(mode: "normal" | "domain", format?: string): NextRequest {
  return new Request("http://localhost/api/duels", {
    method: "POST", body: JSON.stringify({ name: "T", mode, format }),
  }) as NextRequest;
}

beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  create.mockReset().mockReturnValue({ slug: "abc" });
  host.mockReset().mockResolvedValue({
    ok: true, data: { multiplayerTables: true, multiCoreReady: false, multiDomainCoreReady: true },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/duels when the plain multi core is missing", () => {
  it.each(["tag", "ffa3", "ffa4"])("refuses Standard and Domain %s creation with 409 before creating a lobby", async (format) => {
    for (const mode of ["normal", "domain"] as const) {
      const response = await POST(request(mode, format));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: MULTI_CORE_UNAVAILABLE_MESSAGE,
      });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it.each([undefined, "true", null])("keeps multiplayer closed when multiCoreReady is %j", async (multiCoreReady) => {
    host.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady, multiDomainCoreReady: true } });
    expect((await POST(request("normal", "ffa3"))).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["normal", "domain"] as const)("still creates %s 1v1 tables without querying the host", async (mode) => {
    expect((await POST(request(mode, "1v1"))).status).toBe(201);
    expect((await POST(request(mode))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
    expect(host).not.toHaveBeenCalled();
  });

  it.each(["tag", "ffa3", "ffa4"])("creates a Standard %s lobby when the core is ready", async (format) => {
    host.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: false } });
    expect((await POST(request("normal", format))).status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: "normal", format }));
  });
});
