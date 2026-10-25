import { normalizeEmailDomain } from "./email-domain.js";

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * Dedupe key for "is this the same inbox?": lower case, ASCII domain, "+tag" removed, and for Gmail the dots removed
 * and googlemail.com read as gmail.com. Only for dedupe. Mail always goes to the address as typed.
 * Returns null for an address that is not usable.
 */
export function emailKey(email: string): string | null {
  const normalized = normalizeEmailDomain(email.trim().toLowerCase());
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) { local = local.replace(/\./g, ""); domain = "gmail.com"; }
  return local ? `${local}@${domain}` : null;
}
