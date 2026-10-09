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
  if (!input.botToken) return { ok: false, status: 503 };
  const key = `${input.guildId}:${input.userId}`;
  const now = input.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
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
  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(input.guildId)}/members/${encodeURIComponent(input.userId)}`;
  const unavailable = async (response?: Response): Promise<DiscordGuildMembershipDecision> => {
    const decision = { ok: false, status: 503 } as const;
    const failedAt = input.now ?? Date.now();
    cache.set(key, { decision, expiresAt: failedAt + await discordFailureCooldownMs(response, failedAt) });
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
    return unavailable(res);
  } catch {
    return unavailable();
  }
}
