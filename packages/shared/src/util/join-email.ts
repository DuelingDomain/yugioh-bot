import { normalizeEmailDomain } from "./email-domain.js";

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})+$`);

/**
 * The email rules of every public join form (/api/waitlist, /api/join/<code>, owner allowlist): no format characters
 * in the local part, trimmed and lower case, at most 254 chars, ASCII domain made of valid host labels.
 * Returns the address to store and send to, or null when it is not usable.
 */
export function normalizeJoinEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Check before trimming, which would remove a leading U+FEFF format character.
  if (/\p{Cf}/u.test(raw.slice(0, raw.lastIndexOf("@")))) return null;
  const submitted = raw.trim().toLowerCase();
  if (submitted.length > 254) return null;
  // Storage, notification claims and Clerk all use the same ASCII domain.
  const email = normalizeEmailDomain(submitted);
  if (!email || email.length > 254) return null;
  return DOMAIN.test(email.slice(email.lastIndexOf("@") + 1)) ? email : null;
}
