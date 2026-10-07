import { createHmac, timingSafeEqual } from "node:crypto";
export const E2E_SESSION_COOKIE = "dd_e2e_session";
export const E2E_SESSION_TTL_SECONDS = 3600;
export const E2E_AUTH_SECRET_MIN_LENGTH = 32;
export function isE2EAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Production always has live keys, so E2E login must stay disabled alongside them.
  if (env.CLERK_SECRET_KEY?.startsWith("sk_live_") || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) return false;
  return env.E2E_AUTH === "1" && (env.E2E_AUTH_SECRET?.length ?? 0) >= E2E_AUTH_SECRET_MIN_LENGTH;
}
function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`dd-e2e-session:v1.${payload}`).digest();
}
export function signE2ESession(userId: number, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!Number.isSafeInteger(userId) || userId <= 0 || secret.length < E2E_AUTH_SECRET_MIN_LENGTH) throw new Error("Invalid E2E session input");
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: nowSeconds + E2E_SESSION_TTL_SECONDS })).toString("base64url");
  return `v1.${payload}.${signature(payload, secret).toString("base64url")}`;
}
export function verifyE2ESession(value: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  if (!value || secret.length < E2E_AUTH_SECRET_MIN_LENGTH) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
  try {
    const actual = Buffer.from(parts[2], "base64url");
    const expected = signature(parts[1], secret);
    if (actual.toString("base64url") !== parts[2] || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && Number.isSafeInteger(payload.uid) && payload.uid > 0 && Number.isSafeInteger(payload.exp) && payload.exp > nowSeconds ? payload.uid : null;
  } catch { return null; }
}
