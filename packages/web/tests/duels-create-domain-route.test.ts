import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";

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
  // These tests are about Domain at multi-seat tables, so the tables flag is on.
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  create.mockReset();
  create.mockReturnValue({ slug: "abc" });
  callDuelHost.mockReset();
  callDuelHost.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: false } });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/duels with Domain", () => {
  it.each(["tag", "ffa3", "ffa4"])("refuses Domain at a %s table with a clear message and makes no table", async (format) => {
    const response = await POST(request({ name: "T", mode: "domain", format }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: MULTI_DOMAIN_UNAVAILABLE_MESSAGE });
    expect(create).not.toHaveBeenCalled();
  });

  it("still makes a Domain 1v1 table and a Standard FFA table", async () => {
    expect((await POST(request({ name: "T", mode: "domain", format: "1v1" }))).status).toBe(201);
    expect((await POST(request({ name: "T", mode: "normal", format: "ffa4" }))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "true", null])("fails closed with 409 when multiDomainCoreReady is %j", async (multiDomainCoreReady) => {
    callDuelHost.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady } });
    const response = await POST(request({ name: "T", mode: "domain", format: "ffa3" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: MULTI_DOMAIN_UNAVAILABLE_MESSAGE });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["ffa3", "ffa4", "tag"])("makes a Domain %s table when the host has its core", async (format) => {
    callDuelHost.mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true, multiDomainCoreReady: true } });
    expect((await POST(request({ name: "T", mode: "domain", format }))).status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ mode: "domain", format }));
    expect(callDuelHost).toHaveBeenCalledWith({ op: "capabilities", guildId: "g1", playerId: 1 });
  });

  it.each(["normal", "domain"])("blocks %s multiplayer creation when the web flag is off", async (mode) => {
    vi.stubEnv("MULTIPLAYER_TABLES", "0");
    const response = await POST(request({ name: "T", mode, format: "ffa3" }));
    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(callDuelHost).not.toHaveBeenCalled();
    expect((await POST(request({ name: "T", mode, format: "1v1" }))).status).toBe(201);
  });

  it("blocks creation when the host flag is off", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: true } });
    expect((await POST(request({ name: "T", mode: "domain", format: "ffa4" }))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns the host error when its core status cannot be read", async () => {
    callDuelHost.mockResolvedValue({ ok: false, response: Response.json({ error: "Host unavailable" }, { status: 503 }) });
    const response = await POST(request({ name: "T", mode: "domain", format: "tag" }));
    expect(response.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
});
