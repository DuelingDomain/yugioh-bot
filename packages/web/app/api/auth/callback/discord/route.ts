import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createUserService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { joinWaitlist } from "@/lib/waitlist-join";
import { clearRecoveryCookies, discordAuthorizeUrl, newOAuthProof, OAUTH_COOKIE, openCookie, recoveryRateLimit, recoveryRedirect, setRecoveryCookie, signInRecovery, validEmail, webOrigin, type OAuthProof } from "@/lib/existing-player";

export const runtime = "nodejs";
// Discord refuses the silent try (prompt=none) for a person who never authorized the app. Retry once with the consent
// screen. The retry is marked in its sealed proof, so a refusal there (a real Cancel) shows the cancelled banner.
const SILENT_REFUSALS = ["consent_required", "interaction_required", "login_required", "access_denied"];
function retryInteractive(request: NextRequest) {
  const proof = openCookie<OAuthProof>("oauth", request.cookies.get(OAUTH_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state");
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!proof || proof.interactive || !clientId || !SILENT_REFUSALS.includes(request.nextUrl.searchParams.get("error") ?? "")
    || typeof proof.state !== "string" || !state || state.length !== proof.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(proof.state))) return null;
  try {
    const next: OAuthProof = { ...newOAuthProof(), interactive: true, ...(proof.returnTo === undefined ? {} : { returnTo: proof.returnTo }) };
    const response = recoveryRedirect(discordAuthorizeUrl(clientId, next).href);
    clearRecoveryCookies(response); setRecoveryCookie(response, "oauth", next);
    return response;
  } catch { return null; }
}
const WAITLIST_FORM_PATH = "/waitlist?s=form";
/** `/waitlist?s=...` shows the result without any email in the URL. */
async function waitlistPath(email: string, userAgent: string | null): Promise<string> {
  if (!validEmail(email)) return WAITLIST_FORM_PATH;
  const outcome = await joinWaitlist(email, { source: "app-not-invited", userAgent });
  return outcome === "error" ? WAITLIST_FORM_PATH : `/waitlist?s=${outcome === "rejected" ? "retry" : outcome}`;
}
export async function GET(request: NextRequest) {
  const limited = recoveryRateLimit(request, "callback"); if (limited) return clearRecoveryCookies(limited);
  if (request.nextUrl.searchParams.has("error")) return retryInteractive(request) ?? clearRecoveryCookies(recoveryRedirect("/sign-in?error=discord_recovery_cancelled"));
  const proof = openCookie<OAuthProof>("oauth", request.cookies.get(OAUTH_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!proof || typeof proof.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof.state) || typeof proof.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof.verifier)
    || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(proof.state)) || !code || code.length > 2048) {
    return clearRecoveryCookies(recoveryRedirect("/sign-in?error=discord_recovery_expired"));
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
    // Not an existing player. Clerk refused this Discord sign-in (waitlist mode), so put the verified Discord email on
    // the waitlist here instead of asking for it again. Without a verified email, show the one-step email form.
    if (!user) return clearRecoveryCookies(recoveryRedirect(await waitlistPath(profile.verified === true ? email : "", request.headers.get("user-agent"))));
    // A repeat recovery uses only this proven Discord row's stored Clerk ID.
    // Never select a Clerk account using email alone.
    if (user.clerkUserId) return await signInRecovery(request, user.clerkUserId, profile.id, proof.returnTo);
    if (profile.verified !== true || !validEmail(email)) return clearRecoveryCookies(recoveryRedirect(WAITLIST_FORM_PATH));
    const response = clearRecoveryCookies(recoveryRedirect("/welcome-back"));
    setRecoveryCookie(response, "identity", { userId: user.id, discordId: profile.id, email, returnTo: proof.returnTo,
      discordUsername: typeof profile.username === "string" ? profile.username.slice(0, 128) : "" });
    return response;
  } catch { return clearRecoveryCookies(recoveryRedirect("/sign-in?error=discord_recovery_unavailable")); }
}
