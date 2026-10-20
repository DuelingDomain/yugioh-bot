/** Hosts a stored profile picture may come from. Matches img-src in the Caddyfile CSP. */
export const AVATAR_HOSTS: readonly string[] = ["img.clerk.com"];

/** An https picture on an allowed host, at most 2048 characters; anything else is null (the initials circle). */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && AVATAR_HOSTS.includes(url.hostname) ? value : null;
  } catch {
    return null;
  }
}
