import { cookies } from "next/headers";
import { DEFAULT_RETURN, safeReturnPath, TOURNAMENT_BRIDGE_START } from "./auth-return";
import { openCookie, TICKET_COOKIE } from "./existing-player";
import { TOURNAMENT_RETURN_COOKIE, TOURNAMENT_RETURN_MARKER } from "./tournament-auth-return";
import { tournamentBridgeConfig } from "./tournament-bridge";
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

/** Keep an explicit destination. A prior tournament visit can replace the implicit dashboard return. */
export async function returnToFromParams(params: SearchParams): Promise<string> {
  const explicit = firstParam(params.redirect_url);
  if (explicit !== undefined) return safeReturnPath(explicit);
  const recovering = firstParam(params.existing_player) === "1";
  const tournamentEnabled = firstParam(params.via) !== "creator" && !(tournamentBridgeConfig() instanceof Response);
  if (!recovering && !tournamentEnabled) return DEFAULT_RETURN;
  const jar = await cookies();
  if (recovering) {
    const proof = openCookie<{ returnTo?: string }>("ticket", jar.get(TICKET_COOKIE)?.value);
    if (proof?.returnTo !== undefined) return safeReturnPath(proof.returnTo);
  }
  if (tournamentEnabled && jar.get(TOURNAMENT_RETURN_COOKIE)?.value === TOURNAMENT_RETURN_MARKER) {
    return TOURNAMENT_BRIDGE_START;
  }
  return DEFAULT_RETURN;
}
