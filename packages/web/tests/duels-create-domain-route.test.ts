import { beforeEach, describe, expect, it, vi } from "vitest";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";

const create = vi.fn();
vi.mock("@/lib/duel-host", () => ({
  requireDuelActor: vi.fn(async () => ({ ok: true, guildId: "g1", playerId: 1, duels: { create } })),
  duelErrorResponse: vi.fn(),
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
});

describe("POST /api/duels with Domain", () => {
  it.each(["tag", "ffa3", "ffa4"])("refuses Domain at a %s table with a clear message and makes no table", async (format) => {
    const response = await POST(request({ name: "T", mode: "domain", format }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: MULTI_DOMAIN_UNAVAILABLE_MESSAGE });
    expect(create).not.toHaveBeenCalled();
  });

  it("still makes a Domain 1v1 table and a Standard FFA table", async () => {
    expect((await POST(request({ name: "T", mode: "domain", format: "1v1" }))).status).toBe(201);
    expect((await POST(request({ name: "T", mode: "normal", format: "ffa4" }))).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
