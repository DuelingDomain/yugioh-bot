import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { fxLabEnabled, isFxLabPublicPath } from "./fx-lab";
import { checkDiscordWebAccess, webAccessError } from "./discord-web-access";

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
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, profile }) {
      const userId = typeof profile?.id === "string" ? profile.id : user.id;
      if (!userId) return accessErrorPage(403);
      const decision = await checkDiscordWebAccess(userId);
      return decision.ok ? true : accessErrorPage(decision.status);
    },
    async jwt({ token, account, profile }) {
      if (account && profile?.id) {
        token.discordId = profile.id as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.discordId as string) ?? token.sub ?? "";
      }
      return session;
    },
    async authorized({ auth, request: { nextUrl } }) {
      if (nextUrl.pathname === "/dev/fx-lab" && !fxLabEnabled()) {
        return new Response(null, { status: 404 });
      }
      const isPublicRoute =
        (fxLabEnabled() && isFxLabPublicPath(nextUrl.pathname)) ||
        nextUrl.pathname === "/login" ||
        nextUrl.pathname === "/api/auth" ||
        nextUrl.pathname.startsWith("/api/auth/") ||
        nextUrl.pathname.startsWith("/_next") ||
        nextUrl.pathname === "/favicon.ico" ||
        nextUrl.pathname.startsWith("/icons/");

      if (isPublicRoute) return true;
      const isApi = nextUrl.pathname.startsWith("/api/");
      if (!auth?.user?.id) {
        return isApi
          ? Response.json({ error: "Unauthorized" }, { status: 401 })
          : Response.redirect(new URL("/login", nextUrl));
      }

      const decision = await checkDiscordWebAccess(auth.user.id);
      if (!decision.ok) {
        return isApi
          ? Response.json({ error: webAccessError(decision.status) }, { status: decision.status })
          : Response.redirect(new URL(accessErrorPage(decision.status), nextUrl));
      }

      return true;
    },
  },
});
