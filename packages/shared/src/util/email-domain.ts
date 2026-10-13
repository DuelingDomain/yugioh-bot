import { domainToASCII } from "node:url";

/** Normalize the domain, preserving the local part; return null for unusable syntax. */
export function normalizeEmailDomain(email: string): string | null {
  // domainToASCII can strip paths and queries, so reject URL syntax first.
  if (!/^[^\s@]+@[^\s@:/\\?#%]+$/.test(email)) return null;
  const at = email.lastIndexOf("@");
  const domain = domainToASCII(email.slice(at + 1)).toLowerCase();
  return domain ? `${email.slice(0, at)}@${domain}` : null;
}
