import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import { fxLabEnabled, isFxLabPublicPath } from "./fx-lab";
import { checkDiscordWebAccess, webAccessError } from "./discord-web-access";
import { ensureAuthIdentity, resolveJwtIdentity } from "./auth-identity";
import { parseUserId } from "./user-id";

function accessErrorPage(status: 403 | 503) {
  return `/login?error=${status === 403 ? "GuildMembershipRequired" : "GuildMembershipUnavailable"}`;
}

const requiredEnv = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
] as const;

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!isBuildPhase) {
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(
        `[auth] Missing required environment variable: ${key}. Please check your .env file.`
      );
    }
  }
}

/** Provider id of the test-only login. `POST /api/auth/callback/e2e` signs a test user in. */
export const E2E_PROVIDER_ID = "e2e";
export const E2E_AUTH_SECRET_MIN_LENGTH = 32;

/**
 * The test-only login exists only when E2E_AUTH is exactly "1" AND E2E_AUTH_SECRET holds
 * at least 32 characters. Production deploys never set either. NODE_ENV cannot be the gate:
 * the E2E stack runs a production build, so both look the same.
 */
export function isE2EAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_AUTH === "1" && (env.E2E_AUTH_SECRET?.length ?? 0) >= E2E_AUTH_SECRET_MIN_LENGTH;
}

/**
 * Constant-time compare. Hashing first gives equal-length digests, so length never leaks.
 * Uses Web Crypto; Next.js 16 runs this auth module in its Node proxy.
 */
async function secretsMatch(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]).then(([x, y]) => [new Uint8Array(x), new Uint8Array(y)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function e2eProvider() {
  return Credentials({
    id: E2E_PROVIDER_ID,
    name: "E2E test login",
    credentials: { discordId: {}, secret: {}, name: {} },
    async authorize(credentials) {
      // Re-check the gate on every call, so a stale provider can never sign anyone in.
      if (!isE2EAuthEnabled()) return null;
      if (!(await secretsMatch(String(credentials?.secret ?? ""), process.env.E2E_AUTH_SECRET ?? ""))) return null;
      const discordId = String(credentials?.discordId ?? "").trim();
      if (!/^\d{1,25}$/.test(discordId)) return null;
      const name = String(credentials?.name ?? "").trim();
      return { id: discordId, name: name || `E2E ${discordId}` };
    },
  });
}

const e2eEnabled = isE2EAuthEnabled();
if (e2eEnabled && !isBuildPhase) {
  console.warn("[auth] E2E test login is ENABLED (E2E_AUTH=1). Never set E2E_AUTH in production.");
}

const identityCallbacks: Pick<NonNullable<NextAuthConfig["callbacks"]>, "signIn" | "jwt" | "session"> = {
  async signIn({ user, profile, account }) {
    const discordUserId = typeof profile?.id === "string" ? profile.id : user.id;
    if (!discordUserId) return accessErrorPage(403);
    const decision = await checkDiscordWebAccess(discordUserId);
    if (!decision.ok) return accessErrorPage(decision.status);
    ensureAuthIdentity({
      discordUserId,
      displayName: user.name ?? "Unknown",
      providerEmail: profile?.email,
      providerVerified: profile?.verified,
      captureEmail: account?.provider === "discord",
    });
    return true;
  },
  async jwt({ token, account, profile, user }) {
    if (account?.provider === E2E_PROVIDER_ID && user?.id) {
      token.discordId = user.id;
    } else if (account?.provider === "discord" && typeof profile?.id === "string") {
      token.discordId = profile.id;
    }
    const identity = resolveJwtIdentity(token.discordId);
    if (identity) token.userId = identity.id;
    else delete token.userId;
    return token;
  },
  async session({ session, token }) {
    const identity = resolveJwtIdentity(token.discordId);
    session.user.id = identity ? String(identity.id) : "";
    session.user.discordUserId = identity?.discordUserId ?? null;
    return session;
  },
};

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      // Discord sends an RFC 9207 `iss` on the callback, and Auth.js checks it against this value.
      issuer: "https://discord.com",
    }),
    ...(e2eEnabled ? [e2eProvider()] : []),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    ...identityCallbacks,
    async authorized({ auth, request: { nextUrl } }) {
      if (nextUrl.pathname === "/dev/fx-lab" && !fxLabEnabled()) {
        return new Response(null, { status: 404 });
      }
      const isPublicRoute =
        (fxLabEnabled() && isFxLabPublicPath(nextUrl.pathname)) ||
        nextUrl.pathname === "/login" ||
        nextUrl.pathname === "/api/waitlist" ||
        nextUrl.pathname === "/api/auth" ||
        nextUrl.pathname.startsWith("/api/auth/") ||
        nextUrl.pathname.startsWith("/_next") ||
        nextUrl.pathname === "/favicon.ico" ||
        nextUrl.pathname === "/icon.svg" ||
        nextUrl.pathname === "/apple-icon.png" ||
        nextUrl.pathname.startsWith("/icons/");

      if (isPublicRoute) return true;
      const isApi = nextUrl.pathname.startsWith("/api/");
      if (parseUserId(auth?.user?.id) === null) {
        return isApi
          ? Response.json({ error: "Unauthorized" }, { status: 401 })
          : Response.redirect(new URL("/login", nextUrl));
      }

      const decision = auth?.user?.discordUserId
        ? await checkDiscordWebAccess(auth.user.discordUserId)
        : { ok: false as const, status: 403 as const };
      if (!decision.ok) {
        return isApi
          ? Response.json({ error: webAccessError(decision.status) }, { status: decision.status })
          : Response.redirect(new URL(accessErrorPage(decision.status), nextUrl));
      }

      return true;
    },
  },
});
