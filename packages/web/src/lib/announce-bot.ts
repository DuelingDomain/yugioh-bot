import type { AnnouncePayload } from "@yugidraft/shared/notify";
import { env } from "./env";
import { announcer } from "./notify";

type DuelInvite = Omit<Extract<AnnouncePayload, { kind: "duel-invite" }>, "kind" | "url"> & { slug: string };

/** Public web base URL. Falls back to the request origin, then to localhost. */
export function webBaseUrl(request?: Request): string {
  const configured = env.webUrl.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // Fall through to the default.
    }
  }
  return "http://localhost:3000";
}

export function duelUrl(slug: string, request?: Request): string {
  return `${webBaseUrl(request)}/duels/${slug}`;
}

/** Asks the bot to DM a duel invite and says whether the bot accepted it. Never throws; a failure is logged. */
export async function sendDuelInvite(invite: DuelInvite, request?: Request): Promise<boolean> {
  if (!env.discordBotEnabled) return false;
  const { slug, ...rest } = invite;
  try {
    const result = await announcer.announce({ kind: "duel-invite", ...rest, url: duelUrl(slug, request) });
    if (result && !result.ok) {
      console.warn(`[announce-bot] duel-invite failed: ${result.error}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[announce-bot] duel-invite failed", error);
    return false;
  }
}

/** Fire and forget version of `sendDuelInvite`. */
export function announceDuelInvite(invite: DuelInvite, request?: Request): void | false {
  if (!env.discordBotEnabled) return false;
  void sendDuelInvite(invite, request);
}
