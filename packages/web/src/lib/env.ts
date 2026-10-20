export const env = {
  discordBotEnabled: process.env.DISCORD_BOT_ENABLED === "1",
  webUrl: process.env.WEB_URL ?? "",
  // Site data scope. Keep this stable when moving the admin bot to another server.
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  discordBotGuildId: process.env.DISCORD_BOT_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID || "",
  discordDefaultChannelId: process.env.DISCORD_DEFAULT_CHANNEL_ID ?? process.env.DISCORD_REMINDER_CHANNEL_ID ?? "",
  botAnnounceUrl: process.env.BOT_ANNOUNCE_URL ?? "",
  botAnnounceSecret: process.env.BOT_ANNOUNCE_SECRET ?? "",
  wsInternalUrl: process.env.WS_INTERNAL_URL ?? "",
  wsInternalSecret: process.env.WS_INTERNAL_SECRET ?? "",
  duelInternalUrl: process.env.DUEL_INTERNAL_URL ?? "http://127.0.0.1:4003",
  duelInternalSecret: process.env.DUEL_INTERNAL_SECRET ?? "",
};
