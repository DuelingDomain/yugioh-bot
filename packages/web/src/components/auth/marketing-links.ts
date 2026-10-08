/** Used when `MARKETING_URL` is unset, so the waitlist button never disappears from a dead-end card. */
export const DEFAULT_MARKETING_URL = "https://duelingdomain.com";

/** Explicit app-to-marketing navigation must bypass the signed-in routing hint. */
export function marketingHomeHref(marketingUrl: string | null | undefined, hash?: string): string {
  const url = new URL(marketingUrl || DEFAULT_MARKETING_URL);
  url.searchParams.set("home", "1");
  if (hash !== undefined) url.hash = hash;
  return url.toString();
}

/** The join form on the marketing site. */
export function waitlistHref(marketingUrl: string | null | undefined): string {
  return marketingHomeHref(marketingUrl, "join");
}

/** Where "Back to sign in" goes; keeps a non-default return path. */
export function signInHref(returnTo: string): string {
  return returnTo === "/dashboard" ? "/sign-in" : `/sign-in?redirect_url=${encodeQuery(returnTo)}`;
}

/** Encodes a path for a query value but leaves "/" readable. */
export function encodeQuery(path: string): string {
  return encodeURIComponent(path).replace(/%2F/g, "/");
}
