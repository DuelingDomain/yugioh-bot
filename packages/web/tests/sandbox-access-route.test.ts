import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/sandbox-access", () => ({ requireSandboxActor: mocks.actor }));

import { GET } from "../app/api/sandbox/access/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sandbox/access", () => {
  it("answers admin true for an admin", async () => {
    mocks.actor.mockResolvedValue({ ok: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it.each([401, 403, 503])("answers 200 with admin false when the gate says %i", async (status) => {
    mocks.actor.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });
});
