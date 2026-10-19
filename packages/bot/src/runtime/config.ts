import type { BotConfig } from "./types.js";

export function readConfig(): BotConfig {
  if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is required");
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) {
    throw new Error("DISCORD_CLIENT_ID and DISCORD_GUILD_ID are required");
  }
  return {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    moderatorRoleId: process.env.DISCORD_MODERATOR_ROLE_ID,
    modLogChannelId: process.env.DISCORD_MOD_LOG_CHANNEL_ID,
    waitlistChannelId: process.env.DISCORD_WAITLIST_CHANNEL_ID,
    statusChannelId: process.env.DISCORD_STATUS_CHANNEL_ID,
    announceChannelId: process.env.DISCORD_ANNOUNCE_CHANNEL_ID,
    healthPath: process.env.BOT_HEALTH_PATH ?? "/tmp/yugidraft-bot-health.json",
  };
}
