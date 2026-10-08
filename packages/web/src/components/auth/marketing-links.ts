/** Used when `MARKETING_URL` is unset or invalid. */
export const DEFAULT_MARKETING_URL = "https://duelingdomain.com";

export const normalizeMarketingUrl = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return DEFAULT_MARKETING_URL;
  try {
    new URL(trimmed);
    return trimmed.replace(/\/+$/, "");
  } catch { return DEFAULT_MARKETING_URL; }
};

/** Explicit app-to-marketing navigation must bypass the signed-in routing hint. */
export function marketingHomeHref(marketingUrl: string | null | undefined, hash?: string): string {
  const url = new URL(normalizeMarketingUrl(marketingUrl));
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
