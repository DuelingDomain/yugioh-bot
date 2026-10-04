import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/duel-host", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/duel-host")>(),
  requireDuelActor: async () => ({
    ok: true, guildId: "g1", playerId: 1, duels: { room: vi.fn() },
  }),
}));

describe("POST /api/duels/[slug]/actions error forwarding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.test:4003");
    vi.stubEnv("DUEL_INTERNAL_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { error: "That player has left. Pick again.", code: "seat_left" },
    { error: "Invalid answer" },
  ])("passes the host's answer error to the browser: $error", async (body) => {
    const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => Response.json(body, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("../app/api/duels/[slug]/actions/route");
    const command = { promptId: "p1", revision: 0, answer: { choice: "opt:0" } };
    const response = await POST(new NextRequest("http://localhost/api/duels/table/actions", {
      method: "POST", body: JSON.stringify(command),
    }), { params: Promise.resolve({ slug: "table" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(body);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
      op: "respond", slug: "table", guildId: "g1", playerId: 1, command,
    });
  });
});
