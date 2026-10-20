import { Routes, type RESTGetAPIGuildMemberResult } from "discord.js";
import type { Access, FeatureContext } from "./types.js";

export async function mayUse(access: Access, discordUserId: string, context: FeatureContext): Promise<boolean> {
  if (access === "public") return true;
  if ((await context.shared.adminAccess(discordUserId)).isAdmin) return true;
  if (access !== "moderator" || !context.config.moderatorRoleId) return false;
  // Fetch at each interaction: a cached member must not retain a revoked role.
  const member = await context.rest.get(Routes.guildMember(context.config.guildId, discordUserId)) as RESTGetAPIGuildMemberResult;
  return member.roles.includes(context.config.moderatorRoleId);
}
