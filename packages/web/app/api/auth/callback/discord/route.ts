import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createUserService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { clearRecoveryCookies, OAUTH_COOKIE, openCookie, recoveryError, recoveryRateLimit, recoveryRedirect, setRecoveryCookie, signInRecovery, validEmail, webOrigin, type OAuthProof } from "@/lib/existing-player";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const limited = recoveryRateLimit(request, "callback"); if (limited) return clearRecoveryCookies(limited);
  const proof = openCookie<OAuthProof>("oauth", request.cookies.get(OAUTH_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!proof || typeof proof.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof.state) || typeof proof.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof.verifier)
    || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(proof.state)) || !code || code.length > 2048) {
    return clearRecoveryCookies(recoveryError("Discord sign-in expired. Return to sign in and try again.", 400));
  }
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Recovery configuration unavailable");
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        grant_type: "authorization_code", code, redirect_uri: `${webOrigin()}/api/auth/callback/discord`, code_verifier: proof.verifier }) });
    if (!tokenResponse.ok) throw new Error("Discord authorization unavailable");
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Discord authorization unavailable");
    const profileResponse = await fetch("https://discord.com/api/users/@me", { cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new Error("Discord authorization unavailable");
    const profile = await profileResponse.json();
    if (typeof profile.id !== "string" || !/^[0-9]{1,25}$/.test(profile.id)) throw new Error("Discord identity unavailable");
    const user = createUserService(getDb()).findByDiscordId(profile.id);
    const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
    if (!user || profile.verified !== true || !validEmail(email)) return clearRecoveryCookies(recoveryRedirect("/access"));
    // A repeat recovery uses only this proven Discord row's stored Clerk ID.
    // Never select a Clerk account using email alone.
    if (user.clerkUserId) return await signInRecovery(request, user.clerkUserId);
    const response = clearRecoveryCookies(recoveryRedirect("/welcome-back"));
    setRecoveryCookie(response, "identity", { userId: user.id, discordId: profile.id, email,
      discordUsername: typeof profile.username === "string" ? profile.username.slice(0, 128) : "" });
    return response;
  } catch { return clearRecoveryCookies(recoveryError("Discord sign-in is having trouble. Return to sign in and try again.", 503)); }
}
