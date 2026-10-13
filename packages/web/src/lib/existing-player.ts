import { createUserService } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { clientIpKey, createRateLimiter } from "./rate-limit";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

export const OAUTH_COOKIE = "__Host-dd_existing_player_oauth";
export const IDENTITY_COOKIE = "__Host-dd_existing_player_identity";
export const TICKET_COOKIE = "__Host-dd_existing_player_ticket";
const TTL = 600;
type Purpose = "oauth" | "identity" | "ticket";
export type ProvenIdentity = { userId: number; discordId: string; email: string; discordUsername: string };
export type OAuthProof = { state: string; verifier: string };
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

export function webOrigin(): string {
  const value = process.env.WEB_URL;
  if (!value) throw new Error("Recovery configuration unavailable");
  const url = new URL(value);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("Recovery configuration unavailable");
  return url.origin;
}
function key(): Buffer {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("Recovery configuration unavailable");
  return createHmac("sha256", secret).update("dd-existing-player-cookie-v1").digest();
}
// Authenticated encryption also keeps email and the PKCE verifier unreadable.
// Domain separation prevents replaying an identity cookie as an OAuth proof.
export function sealCookie(purpose: Purpose, value: object): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(`${purpose}:${webOrigin()}`));
  const payload = JSON.stringify({ value, expiresAt: Date.now() + (purpose === "ticket" ? 120 : TTL) * 1000 });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openCookie<T>(purpose: Purpose, cookie: string | undefined): T | null {
  if (!cookie || cookie.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cookie)) return null;
  try {
    const data = Buffer.from(cookie, "base64url");
    if (data.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${purpose}:${webOrigin()}`));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload.value as T;
  } catch { return null; }
}
export function readIdentity(cookie: string | undefined): ProvenIdentity | null {
  const proof = openCookie<ProvenIdentity>("identity", cookie);
  if (!proof || !Number.isSafeInteger(proof.userId) || proof.userId <= 0 || typeof proof.discordId !== "string" || !/^[0-9]{1,25}$/.test(proof.discordId)
    || typeof proof.email !== "string" || !validEmail(proof.email) || typeof proof.discordUsername !== "string") return null;
  return proof;
}
export function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email);
}
export function newOAuthProof(): OAuthProof { return { state: randomBytes(32).toString("base64url"), verifier: randomBytes(32).toString("base64url") }; }
export function pkceChallenge(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }
export function setRecoveryCookie(response: NextResponse, purpose: Purpose, value: object): void {
  const name = purpose === "oauth" ? OAUTH_COOKIE : purpose === "identity" ? IDENTITY_COOKIE : TICKET_COOKIE;
  response.cookies.set(name, sealCookie(purpose, value), { ...cookieOptions, maxAge: purpose === "ticket" ? 120 : TTL });
}
export function clearRecoveryCookies(response: NextResponse): NextResponse {
  for (const name of [OAUTH_COOKIE, IDENTITY_COOKIE]) response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
export function clearTicketCookie(response: NextResponse): NextResponse {
  response.cookies.set(TICKET_COOKIE, "", { ...cookieOptions, maxAge: 0 }); return response;
}
export function recoveryRedirect(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, webOrigin()), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export function recoveryError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export function sameOrigin(request: NextRequest): boolean {
  // Next can construct request.url using the internal container hostname.
  // Compare the browser's Origin against the configured public origin instead.
  return request.headers.get("origin") === webOrigin()
    && request.headers.get("sec-fetch-site") !== "cross-site";
}

// Same bounded fixed-window pattern as /api/waitlist. Caddy replaces incoming
// X-Forwarded-For; web must stay private. Cookie hashes split later NAT traffic.
const take = createRateLimiter(TTL * 1000);
export function recoveryRateLimit(request: NextRequest, stage: string): NextResponse | null {
  const ip = clientIpKey(request);
  const purpose: Purpose | null = stage === "callback" ? "oauth" : stage === "complete" ? "identity" : stage === "ticket" ? "ticket" : null;
  const cookieName = purpose === "oauth" ? OAUTH_COOKIE : purpose === "identity" ? IDENTITY_COOKIE : purpose === "ticket" ? TICKET_COOKIE : null;
  const raw = cookieName ? request.cookies.get(cookieName)?.value : undefined;
  // Only a cookie we sealed gets its own bucket; forged values share the IP bucket and cannot fill the map.
  const cookie = purpose && raw && openCookie(purpose, raw) ? raw : undefined;
  const client = `${stage}:${ip}${cookie ? `:${createHash("sha256").update(cookie).digest("hex")}` : ""}`;
  const retry = take([[client, stage === "start" ? 30 : 10]]);
  if (retry !== null) {
    const response = request.method === "GET" ? recoveryRedirect("/sign-in?error=discord_recovery_busy")
      : recoveryError("Too many attempts. Try again in a few minutes.", 429);
    response.headers.set("Retry-After", String(retry));
    return response;
  }
  return null;
}
export async function signInRecovery(request: NextRequest, clerkUserId: string, discordId: string): Promise<NextResponse> {
  const client = await clerkClient();
  const refuse = () => clearTicketCookie(clearRecoveryCookies(request.method === "POST" && request.headers.get("accept") === "application/json"
    ? recoveryError("Your account needs help linking. Contact support@duelingdomain.com.", 409)
    : recoveryRedirect("/sign-in?error=discord_recovery_support")));
  const linked = () => createUserService(getDb()).findByClerkId(clerkUserId)?.discordUserId === discordId;
  if (!linked()) return refuse();
  let user;
  try { user = await client.users.getUser(clerkUserId); }
  catch (error) { if ((error as { status?: number } | null)?.status === 404) return refuse(); throw error; }
  if (!user || user.id !== clerkUserId || user.banned || user.locked || ("deleted" in user && user.deleted)) return refuse();
  if (!linked()) return refuse();
  const discord = user.externalAccounts.filter(account => account.provider === "oauth_discord" && account.verification?.status === "verified");
  const metadataId = user.privateMetadata.existingPlayerDiscordId;
  const recoveryId = typeof metadataId === "string" && /^[0-9]{1,25}$/.test(metadataId) ? metadataId : null;
  if (discord.some(account => account.providerUserId !== discordId) || (recoveryId !== null && recoveryId !== discordId)) return refuse();
  // Preserve fresh Discord proof before the ticket's first profile sync.
  if (!discord.length && recoveryId === null) {
    await client.users.updateUserMetadata(clerkUserId, { privateMetadata: { existingPlayerDiscordId: discordId } });
  }
  if (!linked()) return refuse();
  const { token } = await client.signInTokens.createSignInToken({ userId: clerkUserId, expiresInSeconds: 120 });
  if (!linked()) return refuse();
  const path = "/sign-in?existing_player=1";
  const response = request.headers.get("accept") === "application/json"
    ? NextResponse.json({ redirectTo: path }, { headers: { "Cache-Control": "no-store" } }) : recoveryRedirect(path);
  clearRecoveryCookies(response);
  setRecoveryCookie(response, "ticket", { ticket: token });
  return response;
}
