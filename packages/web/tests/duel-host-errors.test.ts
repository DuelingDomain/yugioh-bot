import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const call = { op: "validate-deck" as const, slug: "abc", guildId: "guild-1", playerId: 1 };

async function loadHost() {
  // env binds process.env at module load.
  return import("../src/lib/duel-host");
}

describe("callDuelHost error messages", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DUEL_INTERNAL_URL = "http://duel.test:4003";
    process.env.DUEL_INTERNAL_SECRET = "s3cret";
  });

  afterEach(() => {
    delete process.env.DUEL_INTERNAL_URL;
    delete process.env.DUEL_INTERNAL_SECRET;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("names the missing secret instead of 'not configured'", async () => {
    process.env.DUEL_INTERNAL_SECRET = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toContain("DUEL_INTERNAL_SECRET is missing");
    expect(body.error).not.toBe("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the engine did not answer when the host is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toMatch(/did not answer \(fetch failed\)/);
  });

  it("explains a secret mismatch instead of passing the host's 401 through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 })));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(503);
    const body = (await result.response.json()) as { error: string };
    expect(body.error).toContain("do not match");
  });

  it("keeps the host's own error text for rule errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Decks are locked after the duel starts" }, { status: 409 })));
    const { callDuelHost } = await loadHost();

    const result = await callDuelHost(call);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({ error: "Decks are locked after the duel starts" });
  });
});
