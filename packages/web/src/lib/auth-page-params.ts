import { safeReturnPath } from "./auth-return";

export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a possibly repeated query parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The marketing site origin without a trailing slash, or null when `MARKETING_URL` is unset. Read per request. */
export function marketingUrlFromEnv(): string | null {
  return process.env.MARKETING_URL?.trim().replace(/\/+$/, "") || null;
}

/** `?redirect_url=` through the one shared validator. */
export function returnToFromParams(params: SearchParams): string {
  return safeReturnPath(firstParam(params.redirect_url));
}
