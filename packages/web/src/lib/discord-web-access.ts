import { env } from "./env";
import { verifyDiscordGuildMembership, type DiscordGuildMembershipDecision } from "./discord-guild-membership";
import { verifyDiscordGuildAdmin } from "./discord-guild-admin";

export type WebAccessLevel = "member" | "admin";

// Keep the Discord access policy in one place, shared by sign-in, proxy and routes.
export async function checkDiscordWebAccess(
  discordUserId: string,
  level: WebAccessLevel = "member",
): Promise<DiscordGuildMembershipDecision> {
  if (!env.discordGuildId) return { ok: false, status: 503 };
  const input = { guildId: env.discordGuildId, userId: discordUserId, botToken: process.env.DISCORD_TOKEN ?? "" };
  const membership = await verifyDiscordGuildMembership(input);
  if (!membership.ok || level === "member") return membership;
  return verifyDiscordGuildAdmin(input);
}

export function webAccessError(status: 403 | 503): string {
  return status === 403
    ? "You must be a member of the Discord server and have permission for this action"
    : "Cannot verify Discord server membership or permissions. Please try again later.";
}
