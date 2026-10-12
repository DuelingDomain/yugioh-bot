import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey, type TokenPurpose } from "./keys.js";

export function signToken<C>(purpose: TokenPurpose, claims: C, secret: string): string {
  if (!secret) throw new Error("Missing token secret");
  const payload = Buffer.from(JSON.stringify(claims));
  const signature = createHmac("sha256", deriveKey(secret, purpose)).update(payload).digest("base64url");
  return `${payload.toString("base64url")}.${signature}`;
}

export function verifyToken<C>(purpose: TokenPurpose, token: string, secret: string, parse: (v: unknown) => C | null): C | null {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const payload = Buffer.from(parts[0], "base64url");
  const received = Buffer.from(parts[1], "base64url");
  const digest = createHmac("sha256", deriveKey(secret, purpose)).update(payload).digest();
  if (received.length !== digest.length || !timingSafeEqual(received, digest)) return null;
  try {
    const value: unknown = JSON.parse(payload.toString("utf8"), (key, value, context?: { source: string }) => {
      if (purpose !== "duel-room" && key === "userId"
        && (typeof value !== "number" || context?.source !== String(value))) {
        throw new Error("Invalid room user ID");
      }
      return value;
    });
    return parse(value);
  } catch {
    return null;
  }
}
