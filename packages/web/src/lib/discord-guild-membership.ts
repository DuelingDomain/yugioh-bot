export const DISCORD_GUILD_MEMBERSHIP_TTL_MS = 60_000;
export const DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS = 5_000;

export type DiscordGuildMembershipDecision =
  | { ok: true }
  | { ok: false; status: 403 | 503 };

type CacheEntry = {
  allowed: boolean;
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
    return cached.allowed ? { ok: true } : { ok: false, status: 403 };
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
  input: { guildId: string; userId: string; botToken: string },
  key: string,
  now: number,
): Promise<DiscordGuildMembershipDecision> {
  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(input.guildId)}/members/${encodeURIComponent(input.userId)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${input.botToken}` },
      signal: AbortSignal.timeout(DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS),
    });
    if (res.status === 200) {
      cache.set(key, { allowed: true, expiresAt: now + DISCORD_GUILD_MEMBERSHIP_TTL_MS });
      return { ok: true };
    }
    if (res.status === 404) {
      cache.set(key, { allowed: false, expiresAt: now + DISCORD_GUILD_MEMBERSHIP_TTL_MS });
      return { ok: false, status: 403 };
    }
    return { ok: false, status: 503 };
  } catch {
    return { ok: false, status: 503 };
  }
}
