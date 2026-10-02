import { discordFailureCooldownMs } from "./discord-failure-backoff";
import {
  DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS,
  DISCORD_GUILD_MEMBERSHIP_TTL_MS,
  type DiscordGuildMembershipDecision,
} from "./discord-guild-membership";

type Input = { guildId: string; userId: string; botToken: string; now?: number };
type CacheEntry = { decision: DiscordGuildMembershipDecision; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DiscordGuildMembershipDecision>>();
const MANAGE_SERVER = 0x8n | 0x20n;

export async function verifyDiscordGuildAdmin(input: Input): Promise<DiscordGuildMembershipDecision> {
  if (!input.botToken) return { ok: false, status: 503 };
  const key = `${input.guildId}:${input.userId}`;
  const now = input.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.decision;
  const pending = inflight.get(key);
  if (pending) return pending;

  const lookup = lookupGuildAdmin(input, key);
  inflight.set(key, lookup);
  try {
    const decision = await lookup;
    if (decision.ok || decision.status === 403) {
      cache.set(key, { decision, expiresAt: now + DISCORD_GUILD_MEMBERSHIP_TTL_MS });
    }
    return decision;
  } finally {
    if (inflight.get(key) === lookup) inflight.delete(key);
  }
}

async function lookupGuildAdmin(input: Input, key: string): Promise<DiscordGuildMembershipDecision> {
  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(input.guildId)}`;
  const options = () => ({
    headers: { Authorization: `Bot ${input.botToken}` },
    signal: AbortSignal.timeout(DISCORD_GUILD_MEMBERSHIP_TIMEOUT_MS),
    cache: "no-store" as const,
  });
  const unavailable = async (response?: Response): Promise<DiscordGuildMembershipDecision> => {
    const decision = { ok: false, status: 503 } as const;
    const failedAt = input.now ?? Date.now();
    cache.set(key, { decision, expiresAt: failedAt + await discordFailureCooldownMs(response, failedAt) });
    return decision;
  };
  try {
    const memberResponse = await fetch(`${url}/members/${encodeURIComponent(input.userId)}`, options());
    if (memberResponse.status === 404) return { ok: false, status: 403 };
    if (memberResponse.status !== 200) return unavailable(memberResponse);
    const member = await memberResponse.json() as { roles?: unknown };
    if (!Array.isArray(member.roles) || member.roles.some((id) => typeof id !== "string")) {
      return unavailable();
    }

    const guildResponse = await fetch(url, options());
    if (guildResponse.status !== 200) return unavailable(guildResponse);
    const guild = await guildResponse.json() as {
      owner_id?: unknown;
      roles?: Array<{ id: string; permissions: string }>;
    };
    if (typeof guild.owner_id !== "string") return unavailable();
    if (guild.owner_id === input.userId) return { ok: true };
    if (!Array.isArray(guild.roles)) return unavailable();

    const roleIds = new Set<string>([input.guildId, ...member.roles]);
    let permissions = 0n;
    for (const role of guild.roles) {
      if (!roleIds.has(role.id)) continue;
      if (typeof role.permissions !== "string" || !/^\d+$/.test(role.permissions)) {
        return unavailable();
      }
      permissions |= BigInt(role.permissions);
    }
    return (permissions & MANAGE_SERVER) !== 0n ? { ok: true } : { ok: false, status: 403 };
  } catch {
    return unavailable();
  }
}
