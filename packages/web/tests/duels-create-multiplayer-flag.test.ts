import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MULTIPLAYER_TABLES_OFF_MESSAGE } from "@yugidraft/shared/duels";

const create = vi.fn();
const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({
  requireDuelActor: vi.fn(async () => ({ ok: true, guildId: "g1", playerId: 1, duels: { create } })),
  duelErrorResponse: vi.fn(),
  callDuelHost: (...args: unknown[]) => callDuelHost(...args),
}));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: vi.fn() }));

import { POST } from "../app/api/duels/route";
import type { NextRequest } from "next/server";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/duels", { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest;
}

beforeEach(() => {
  callDuelHost.mockReset().mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } });
  create.mockReset();
  create.mockReturnValue({ slug: "abc" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/duels with MULTIPLAYER_TABLES off", () => {
  it.each([undefined, "", "0", "off", "false"])("refuses a Tag, 3-player and 4-player table when the flag is %j", async (value) => {
    if (value === undefined) vi.stubEnv("MULTIPLAYER_TABLES", undefined as unknown as string);
    else vi.stubEnv("MULTIPLAYER_TABLES", value);
    for (const format of ["tag", "ffa3", "ffa4"]) {
      const response = await POST(request({ name: "T", mode: "normal", format }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: MULTIPLAYER_TABLES_OFF_MESSAGE });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("still makes 1v1 tables, with and without the format field", async () => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    expect((await POST(request({ name: "T", mode: "normal" }))).status).toBe(201);
    expect((await POST(request({ name: "T", mode: "normal", format: "1v1" }))).status).toBe(201);
    expect((await POST(request({ name: "T", mode: "domain", format: "1v1" }))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("refuses an unknown format with 400, not 403", async () => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    expect((await POST(request({ name: "T", mode: "normal", format: "ffa9" }))).status).toBe(400);
  });
});

describe("POST /api/duels with MULTIPLAYER_TABLES on", () => {
  it.each(["1", "true", "on"])("makes Tag, 3-player and 4-player tables when the flag is %j", async (value) => {
    vi.stubEnv("MULTIPLAYER_TABLES", value);
    for (const format of ["tag", "ffa3", "ffa4", "1v1"]) {
      expect((await POST(request({ name: "T", mode: "normal", format }))).status).toBe(201);
    }
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("reads the flag on every request", async () => {
    vi.stubEnv("MULTIPLAYER_TABLES", "1");
    expect((await POST(request({ name: "T", mode: "normal", format: "ffa4" }))).status).toBe(201);
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    expect((await POST(request({ name: "T", mode: "normal", format: "ffa4" }))).status).toBe(403);
  });
});
