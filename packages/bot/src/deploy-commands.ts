import "dotenv/config";
import { writeSync } from "node:fs";

if (process.env.DISCORD_BOT_ENABLED !== "1") {
  writeSync(1, "[bot] disabled\n");
} else {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_BOT_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    throw new Error("DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required");
  }
  const { deployCommands } = await import("./runtime/deploy.js");
  const { features } = await import("./features/index.js");
  const count = await deployCommands({ token, clientId, guildId }, features);
  writeSync(1, `Deployed ${count} guild commands\n`);
}
