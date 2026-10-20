import { REST, Routes } from "discord.js";
import { createRegistry } from "./registry.js";
import type { BotConfig, FeatureModule } from "./types.js";

export async function deployCommands(config: Pick<BotConfig, "token" | "clientId" | "guildId" | "restApi">, modules: readonly FeatureModule[]): Promise<number> {
  const registry = createRegistry(modules);
  const rest = new REST({ version: "10", ...(config.restApi ? { api: config.restApi } : {}), timeout: 10_000, retries: 2 }).setToken(config.token);
  try {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: registry.definitions });
    return registry.definitions.length;
  } finally { rest.clearHashSweeper(); rest.clearHandlerSweeper(); }
}
