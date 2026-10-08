import { safeReturnPath } from "./auth-return";
import { normalizeMarketingUrl } from "../components/auth/marketing-links";

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a possibly repeated query parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Validated marketing URL with a public default. Read per request. */
export function marketingUrlFromEnv(): string {
  return normalizeMarketingUrl(process.env.MARKETING_URL);
}

/** `?redirect_url=` through the one shared validator. */
export function returnToFromParams(params: SearchParams): string {
  return safeReturnPath(firstParam(params.redirect_url));
}
