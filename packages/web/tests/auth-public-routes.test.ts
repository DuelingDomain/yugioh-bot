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

  it("allows public icon asset requests without auth", async () => {
    const authorized = await loadAuthorizedCallback();

    const result = await authorized({
      auth: null,
      request: { nextUrl: new URL("http://localhost/icons/spell.svg") },
    });

    expect(result).toBe(true);
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

  it("keeps dotted app routes protected", async () => {
    const authorized = await loadAuthorizedCallback();

    const result = await authorized({
      auth: null,
      request: { nextUrl: new URL("http://localhost/draft/export.csv") },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("http://localhost/login");
  });
  describe("FX lab routes", () => {
    afterEach(() => {
      delete process.env.DUEL_FX_LAB;
    });

    it("lets the lab page and the card art through when DUEL_FX_LAB=1", async () => {
      process.env.DUEL_FX_LAB = "1";
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/fx-lab", "/api/cards/89631139/image"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBe(true);
      }
    });

    it("keeps the lab behind login when the switch is off", async () => {
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/fx-lab", "/api/cards/89631139/image"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBeInstanceOf(Response);
      }
    });

    it("opens only the lab page and card art, nothing else under it", async () => {
      process.env.DUEL_FX_LAB = "1";
      const authorized = await loadAuthorizedCallback();

      for (const path of ["/dev/other", "/api/cards/resolve", "/api/cards/1/image/extra", "/draft/example"]) {
        const result = await authorized({ auth: null, request: { nextUrl: new URL(`http://localhost${path}`) } });
        expect(result, path).toBeInstanceOf(Response);
      }
    });
  });
});
