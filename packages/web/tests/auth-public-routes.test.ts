import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config: Record<string, unknown>) => {
    authState.config = config;
    return {
      handlers: { GET: vi.fn(), POST: vi.fn() },
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  }),
}));

vi.mock("next-auth/providers/discord", () => ({
  default: vi.fn(() => ({})),
}));

async function loadAuthorizedCallback() {
  authState.config = null;
  vi.resetModules();
  await import("../src/lib/auth");
  return (authState.config as unknown as {
    callbacks: {
      authorized: (args: {
        auth: { user?: unknown } | null;
        request: { nextUrl: URL };
      }) => Response | boolean | Promise<Response | boolean>;
    };
  }).callbacks.authorized;
}

describe("auth public routes", () => {
  it("allows exactly the anonymous waitlist endpoint", async () => {
    const authorized = await loadAuthorizedCallback();
    expect(await authorized({ auth: null, request: { nextUrl: new URL("http://localhost/api/waitlist") } })).toBe(true);
  });

  it.each(["/api/waitlistx", "/api/waitlist/extra", "/api/anything-else"])("keeps %s protected", async (path) => {
    const authorized = await loadAuthorizedCallback();
    const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "discord-client-id";
    process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
  });

  afterEach(() => {
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it.each(["/icons/spell.svg", "/favicon.ico", "/icon.svg", "/apple-icon.png"])("allows %s without auth", async (path) => {
    const authorized = await loadAuthorizedCallback();

    const result = await authorized({
      auth: null,
      request: { nextUrl: new URL(`http://localhost${path}`) },
    });

    expect(result).toBe(true);
  });

  it.each([46986418, 23995346, 89631146, 5405694])("keeps the card image API protected for login artwork %s", async (id) => {
    const authorized = await loadAuthorizedCallback();
    const response = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost/api/cards/${id}/image?variant=small`) } });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });

  it("redirects unauthenticated draft pages to login", async () => {
    const authorized = await loadAuthorizedCallback();

    const result = await authorized({
      auth: null,
      request: { nextUrl: new URL("http://localhost/draft/example") },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("http://localhost/login");
  });

  it.each(["/draft/export.csv", "/icon.svg/private", "/apple-icon.png/private"])("keeps %s protected", async (path) => {
    const authorized = await loadAuthorizedCallback();

    const result = await authorized({
      auth: null,
      request: { nextUrl: new URL(`http://localhost${path}`) },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("http://localhost/login");
  });
  describe("FX lab routes", () => {
    afterEach(() => {
      delete process.env.DUEL_FX_LAB;
    });

    it("allows the lab page and card art without login when DUEL_FX_LAB=1", async () => {
      process.env.DUEL_FX_LAB = "1";
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/fx-lab", "/dev/table-preview", "/dev/table-preview/ffa3", "/dev/table-preview/tag", "/dev/solid-preview", "/dev/solid-preview/domain", "/api/cards/89631139/image"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBe(true);
      }
    });

    it("returns 404 for the lab when disabled and protects card art", async () => {
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/fx-lab", "/dev/table-preview", "/dev/table-preview/ffa3", "/api/cards/89631139/image"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBeInstanceOf(Response);
        if (path === "/dev/fx-lab") expect((result as Response).status).toBe(404);
      }
    });

    it("opens only the lab page and card art, nothing else under it", async () => {
      process.env.DUEL_FX_LAB = "1";
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/other", "/dev/table-previews", "/dev/solid-previews", "/api/cards/resolve", "/api/cards/1/image/extra", "/draft/example"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBeInstanceOf(Response);
      }
    });
  });
});
