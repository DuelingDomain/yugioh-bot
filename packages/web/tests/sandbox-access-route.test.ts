import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/sandbox-access", () => ({ canUseSandbox: mocks.access }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: mocks.actor }));

import { GET } from "../app/api/sandbox/access/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ ok: true, discordUserId: null });
  mocks.access.mockResolvedValue({ ok: true });
});

describe("GET /api/sandbox/access", () => {
  it("answers allowed true for a listed developer", async () => {
    mocks.actor.mockResolvedValue({ ok: true });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: true });
  });

  it.each([401, 403])("answers allowed false for a signed-in user denied sandbox access with %i", async status => {
    mocks.access.mockResolvedValue({ ok: false, status });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([401, 403, 503])("preserves denial status %i", async (status) => {
    mocks.actor.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    const res = await GET();
    expect(res.status).toBe(status);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
