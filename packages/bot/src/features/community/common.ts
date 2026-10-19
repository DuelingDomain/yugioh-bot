import { MessageFlags, RateLimitError } from "discord.js";
import type { FeatureContext, InteractionLike } from "../../runtime/types.js";

export const PURPLE = 0x7652b8;
export const GOLD = 0xd8b86a;
export const NO_MENTIONS = { parse: [] as never[], repliedUser: false };
export const NO_API_MENTIONS = { parse: [] as never[], replied_user: false };
export const FORMAT_LABEL = { "1v1": "1v1 duel", tag: "Tag duel", ffa3: "3-way duel", ffa4: "4-way duel" } as const;
export type Format = keyof typeof FORMAT_LABEL;
export const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export class CommunityError extends Error {}

export async function requireAdmin(interaction: InteractionLike, context: FeatureContext, action: string): Promise<boolean> {
  if (interaction.guildId === context.config.guildId && (await context.shared.adminAccess(interaction.user.id)).isAdmin) return true;
  await context.audit({ actorDiscordId: interaction.user.id, action, result: "denied" });
  await interaction.reply({ content: "You do not have access to this action.", flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
  return false;
}

/** Only fixed messages reach Discord. Never include upstream response bodies or credentials. */
export function errorText(error: unknown): string {
  if (error instanceof CommunityError) return error.message;
  const value = error as { status?: number; code?: number; name?: string } | null;
  if (value?.status === 403 || value?.code === 50013 || value?.code === 50001) return "The bot does not have permission for this action. Check its channel permissions.";
  if (value?.status === 404) return "The channel, role or message was not found. Check the configuration and try again.";
  if (value?.status === 429 || error instanceof RateLimitError) return "Discord has a rate limit. Wait and try again.";
  return "The action could not be completed. Try again later.";
}
