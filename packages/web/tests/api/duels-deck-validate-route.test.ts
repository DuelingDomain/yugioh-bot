import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const host = vi.hoisted(() => ({ requireDuelActor: vi.fn(), callDuelHost: vi.fn(), duelErrorResponse: vi.fn() }));
vi.mock("@/lib/duel-host", () => host);
import { POST } from "../../app/api/duels/[slug]/deck/validate/route";

describe("deck validation racing an FFA start", () => {
  beforeEach(() => vi.resetAllMocks());

  async function validate(format: string, message = "Decks are locked after the duel starts") {
    host.requireDuelActor.mockResolvedValue({
      ok: true, guildId: "g", playerId: 1,
      duels: { room: () => ({ session: { format, status: "lobby" } }) },
    });
    host.callDuelHost.mockResolvedValue({ ok: false, response: NextResponse.json({ error: message }, { status: 409 }) });
    return POST(new NextRequest("http://test/api/duels/t/deck/validate", {
      method: "POST", body: JSON.stringify({ main: [] }),
    }), { params: Promise.resolve({ slug: "t" }) });
  }

  it.each(["ffa3", "ffa4"])("reports %s locked decks as a state change without a browser resource error", async (format) => {
    const response = await validate(format);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locked: true, error: "Decks are locked after the duel starts" });
  });

  it.each(["1v1", "tag"])("preserves the existing %s response", async (format) => {
    expect((await validate(format)).status).toBe(409);
  });

  it("preserves unrelated validation conflicts", async () => {
    expect((await validate("ffa3", "Unrelated conflict")).status).toBe(409);
  });
});
