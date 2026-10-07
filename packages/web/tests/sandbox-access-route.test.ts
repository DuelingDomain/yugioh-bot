import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/sandbox-access", () => ({ requireSandboxActor: mocks.actor }));

import { GET } from "../app/api/sandbox/access/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sandbox/access", () => {
  it("answers allowed true for a listed developer", async () => {
    mocks.actor.mockResolvedValue({ ok: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: true });
  });

  it.each([401, 403, 503])("preserves denial status %i", async (status) => {
    mocks.actor.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const res = await GET();
    expect(res.status).toBe(status);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
