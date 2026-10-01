import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Provider = {
  id?: string;
  authorize?: (credentials: Record<string, unknown> | undefined) => Promise<unknown>;
};
type AuthConfig = {
  providers: Provider[];
  callbacks: {
    jwt: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
    session: (args: Record<string, unknown>) => Promise<{ user: { id: string } }>;
  };
};

const authState = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("next-auth", () => ({
  default: vi.fn((config: unknown) => {
    authState.config = config;
    return { handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
}));
vi.mock("next-auth/providers/discord", () => ({ default: vi.fn(() => ({ id: "discord" })) }));
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((options: Provider) => ({ ...options })),
}));

const STRONG_SECRET = "s".repeat(32);

async function loadConfig(): Promise<AuthConfig> {
  authState.config = null;
  vi.resetModules();
  await import("../src/lib/auth");
  return authState.config as AuthConfig;
}

const e2eProvider = (config: AuthConfig) => config.providers.find((provider) => provider.id === "e2e");

describe("E2E test login provider", () => {
  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "discord-client-id";
    process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
    delete process.env.E2E_AUTH;
    delete process.env.E2E_AUTH_SECRET;
  });

  afterEach(() => {
    for (const key of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "NEXTAUTH_SECRET", "E2E_AUTH", "E2E_AUTH_SECRET"]) {
      delete process.env[key];
    }
    vi.restoreAllMocks();
  });

  it("is absent when neither variable is set", async () => {
    const config = await loadConfig();
    expect(config.providers.map((provider) => provider.id)).toEqual(["discord"]);
  });

  it("is absent when E2E_AUTH is not exactly 1", async () => {
    process.env.E2E_AUTH_SECRET = STRONG_SECRET;
    for (const value of ["0", "true", "yes", ""]) {
      process.env.E2E_AUTH = value;
      expect(e2eProvider(await loadConfig())).toBeUndefined();
    }
  });

  it("is absent when only E2E_AUTH is set", async () => {
    process.env.E2E_AUTH = "1";
    expect(e2eProvider(await loadConfig())).toBeUndefined();
  });

  it("is absent when the secret is shorter than 32 characters", async () => {
    process.env.E2E_AUTH = "1";
    process.env.E2E_AUTH_SECRET = "s".repeat(31);
    expect(e2eProvider(await loadConfig())).toBeUndefined();
  });

  it("is absent when only the secret is set", async () => {
    process.env.E2E_AUTH_SECRET = STRONG_SECRET;
    expect(e2eProvider(await loadConfig())).toBeUndefined();
  });

  it("is present, and warns, when both variables are valid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.E2E_AUTH = "1";
    process.env.E2E_AUTH_SECRET = STRONG_SECRET;
    const config = await loadConfig();
    expect(config.providers.map((provider) => provider.id)).toEqual(["discord", "e2e"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("E2E test login is ENABLED"));
  });

  describe("authorize", () => {
    async function authorize(credentials: Record<string, unknown> | undefined) {
      process.env.E2E_AUTH = "1";
      process.env.E2E_AUTH_SECRET = STRONG_SECRET;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const provider = e2eProvider(await loadConfig());
      return provider?.authorize?.(credentials);
    }

    it("returns a user whose id is the Discord id for the right secret", async () => {
      await expect(authorize({ discordId: "100000000000000001", secret: STRONG_SECRET, name: "Alice" }))
        .resolves.toEqual({ id: "100000000000000001", name: "Alice" });
    });

    it("falls back to a generated name", async () => {
      await expect(authorize({ discordId: "42", secret: STRONG_SECRET }))
        .resolves.toEqual({ id: "42", name: "E2E 42" });
    });

    it("rejects a wrong secret, a wrong-length secret and a missing secret", async () => {
      await expect(authorize({ discordId: "42", secret: "x".repeat(32) })).resolves.toBeNull();
      await expect(authorize({ discordId: "42", secret: "short" })).resolves.toBeNull();
      await expect(authorize({ discordId: "42" })).resolves.toBeNull();
      await expect(authorize(undefined)).resolves.toBeNull();
    });

    it("rejects a missing or malformed Discord id", async () => {
      await expect(authorize({ secret: STRONG_SECRET })).resolves.toBeNull();
      await expect(authorize({ discordId: "abc", secret: STRONG_SECRET })).resolves.toBeNull();
      await expect(authorize({ discordId: "1; drop", secret: STRONG_SECRET })).resolves.toBeNull();
    });

    it("rejects everyone once the gate closes, even for a provider built earlier", async () => {
      process.env.E2E_AUTH = "1";
      process.env.E2E_AUTH_SECRET = STRONG_SECRET;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const provider = e2eProvider(await loadConfig());
      delete process.env.E2E_AUTH;
      await expect(provider?.authorize?.({ discordId: "42", secret: STRONG_SECRET })).resolves.toBeNull();
    });
  });

  describe("session shape", () => {
    it("gives the test user the same discordId and session.user.id as the Discord provider", async () => {
      process.env.E2E_AUTH = "1";
      process.env.E2E_AUTH_SECRET = STRONG_SECRET;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { callbacks } = await loadConfig();

      const fromE2e = await callbacks.jwt({
        token: { sub: "ignored" },
        account: { provider: "e2e" },
        user: { id: "100000000000000001" },
      });
      const fromDiscord = await callbacks.jwt({
        token: { sub: "ignored" },
        account: { provider: "discord" },
        profile: { id: "100000000000000001" },
      });
      expect(fromE2e.discordId).toBe("100000000000000001");
      expect(fromDiscord.discordId).toBe("100000000000000001");

      const session = await callbacks.session({ session: { user: {} }, token: fromE2e });
      expect(session.user.id).toBe("100000000000000001");
    });
  });

  it("still requires the Discord variables even when the test login is on", async () => {
    process.env.E2E_AUTH = "1";
    process.env.E2E_AUTH_SECRET = STRONG_SECRET;
    delete process.env.DISCORD_CLIENT_ID;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadConfig()).rejects.toThrow("DISCORD_CLIENT_ID");
  });

  it("adds no test login button to the login page", () => {
    const page = readFileSync(new URL("../app/(auth)/login/page.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/e2e/i);
    expect(page).toContain('signIn("discord"');
  });
});
