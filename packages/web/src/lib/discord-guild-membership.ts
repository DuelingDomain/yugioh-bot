import { discordFailureCooldownMs } from "./discord-failure-backoff";

export const DISCORD_GUILD_MEMBERSHIP_TTL_MS = 60_000;
export const DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS = 5_000;

export type DiscordGuildMembershipDecision =
  | { ok: true }
  | { ok: false; status: 403 | 503 };

type CacheEntry = {
  decision: DiscordGuildMembershipDecision;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DiscordGuildMembershipDecision>>();

type UnavailableReason = "missing_token" | "cached_failure" | "timeout" | "rate_limited" | "provider_unavailable" | "provider_check_failed";

function warnUnavailable(reason: UnavailableReason, startedAt: number): void {
  console.warn("[web-access] Discord guild check unavailable", {
    reason, durationMs: Math.round(performance.now() - startedAt),
  });
}

export function resetDiscordGuildMembershipCache(): void {
  cache.clear();
  inflight.clear();
}

export async function verifyDiscordGuildMembership(input: {
  guildId: string;
  userId: string;
  botToken: string;
  now?: number;
}): Promise<DiscordGuildMembershipDecision> {
  const startedAt = performance.now();
  if (!input.botToken) {
    warnUnavailable("missing_token", startedAt);
    return { ok: false, status: 503 };
  }
  const key = `${input.guildId}:${input.userId}`;
  const now = input.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    if (!cached.decision.ok && cached.decision.status === 503) warnUnavailable("cached_failure", startedAt);
    return cached.decision;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const lookup = lookupGuildMember(input, key, now);
  inflight.set(key, lookup);
  try {
    return await lookup;
  } finally {
    if (inflight.get(key) === lookup) inflight.delete(key);
  }
}

async function lookupGuildMember(
  input: { guildId: string; userId: string; botToken: string; now?: number },
  key: string,
  now: number,
): Promise<DiscordGuildMembershipDecision> {
  const startedAt = performance.now();
  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(input.guildId)}/members/${encodeURIComponent(input.userId)}`;
  const unavailable = async (reason: UnavailableReason, response?: Response): Promise<DiscordGuildMembershipDecision> => {
    const decision = { ok: false, status: 503 } as const;
    const failedAt = input.now ?? Date.now();
    cache.set(key, { decision, expiresAt: failedAt + await discordFailureCooldownMs(response, failedAt) });
    warnUnavailable(reason, startedAt);
    return decision;
  };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${input.botToken}` },
      signal: AbortSignal.timeout(DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS),
    });
    if (res.status === 200) {
      cache.set(key, { decision: { ok: true }, expiresAt: now + DISCORD_GUILD_MEMBERSHIP_TTL_MS });
      return { ok: true };
    }
    if (res.status === 404) {
      cache.set(key, { decision: { ok: false, status: 403 }, expiresAt: now + DISCORD_GUILD_MEMBERSHIP_TTL_MS });
      return { ok: false, status: 403 };
    }
    return unavailable(res.status === 429 ? "rate_limited" : res.status >= 500 ? "provider_unavailable" : "provider_check_failed", res);
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return unavailable(timeout ? "timeout" : "provider_check_failed");
  }
}
