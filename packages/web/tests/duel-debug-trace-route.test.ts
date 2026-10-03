import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actor = { ok: true as const, guildId: "g1", playerId: 7, duels: { room: vi.fn() } };
const callDuelHost = vi.fn();
const requireDuelActor = vi.fn(async (): Promise<unknown> => actor);

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/duel-host", async () => {
  const real = await vi.importActual<typeof import("@/lib/duel-host")>("@/lib/duel-host");
  return { ...real, requireDuelActor, callDuelHost };
});

const ctx = { params: Promise.resolve({ slug: "abc" }) };
const get = () => new Request("http://x");

describe("duel debug-trace route", () => {
  beforeEach(() => {
    callDuelHost.mockReset();
    actor.duels.room.mockReset();
    requireDuelActor.mockClear();
    requireDuelActor.mockImplementation(async () => actor);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers 404 when scenarios are off", async () => {
    const { GET } = await import("../app/api/duels/[slug]/debug-trace/route");
    expect((await GET(get(), ctx)).status).toBe(404);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("passes the host answer through when scenarios are on", async () => {
    vi.stubEnv("DUEL_SCENARIOS", "1");
    callDuelHost.mockResolvedValue({ ok: true, data: { revision: 4, seats: [], worker: { busy: true } } });
    const { GET } = await import("../app/api/duels/[slug]/debug-trace/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: 4, seats: [], worker: { busy: true } });
    expect(callDuelHost.mock.calls[0]![0]).toMatchObject({ op: "debug-trace", slug: "abc", guildId: "g1", playerId: 7 });
  });

  it("uses the actor check and stops when there is no actor", async () => {
    vi.stubEnv("DUEL_SCENARIOS", "1");
    const { NextResponse } = await import("next/server");
    requireDuelActor.mockImplementation(async () => ({ ok: false, response: NextResponse.json({ error: "Sign in" }, { status: 401 }) }));
    const { GET } = await import("../app/api/duels/[slug]/debug-trace/route");
    expect((await GET(get(), ctx)).status).toBe(401);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("does not call the host when the player may not see the duel", async () => {
    vi.stubEnv("DUEL_SCENARIOS", "1");
    actor.duels.room.mockImplementation(() => {
      throw new Error("Duel not found");
    });
    const { GET } = await import("../app/api/duels/[slug]/debug-trace/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(callDuelHost).not.toHaveBeenCalled();
  });
});
