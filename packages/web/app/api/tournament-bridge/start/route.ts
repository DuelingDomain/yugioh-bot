// Tournament bridge: the existing Clerk sign-in/sign-up flow returns here.
import { currentUser } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { createTournamentBridgeUsers, signTournamentAssertion, validTournamentReturn } from "@yugidraft/shared/tournament-bridge";
import { getDb } from "@/lib/db";
import { TOURNAMENT_RETURN_COOKIE, tournamentCallbackRedirect, tournamentSignInRedirect } from "@/lib/tournament-auth-return";
import { requireWebAccess } from "@/lib/web-access";
import { tournamentBridgeConfig, tournamentJson } from "@/lib/tournament-bridge";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const config = tournamentBridgeConfig();
  if (config instanceof Response) return config;
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return") ?? "/";
  if (!validTournamentReturn(returnTo)) return tournamentJson({ error: "invalid_return" }, 400);
  const access = await requireWebAccess();
  if (!access.ok) {
    if (access.response.status !== 401) {
      access.response.headers.set("Cache-Control", "no-store");
      return access.response;
    }
    return tournamentSignInRedirect(url, 302);
  }
  let clerkUser: Awaited<ReturnType<typeof currentUser>> = null;
  try { clerkUser = await currentUser(); } catch { /* Optional Discord refresh may be unavailable. */ }
  const db = getDb();
  const users = createTournamentBridgeUsers(db);
  // Keep a concurrent account deletion from restoring a profile after its cleanup.
  const user = db.transaction(() => {
    const user = users.find(access.userId);
    if (!user) return null;
    if (!clerkUser) return user;
    const discord = clerkUser.externalAccounts.find(account => account.provider === "oauth_discord" && account.providerUserId === user.discordUserId);
    const discordUsername = discord?.username ?? null;
    users.refreshDiscordUsername(user.id, discordUsername);
    return { ...user, discordUsername };
  }).immediate();
  if (!user) return tournamentJson({ error: "not_found" }, 404);
  const callback = new URL(`${config.url}/auth/callback`);
  callback.searchParams.set("assertion", signTournamentAssertion({ secret: config.secret, return: returnTo, user }));
  return tournamentCallbackRedirect(callback, request.cookies.has(TOURNAMENT_RETURN_COOKIE));
}
