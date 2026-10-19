import { InteractionContextType, PermissionFlagsBits } from "discord.js";
import type { FeatureModule, ComponentModule } from "./types.js";

export function createRegistry(modules: readonly FeatureModule[]) {
  const commands = new Map(modules.flatMap(module => module.commands).map(command => [command.data.toJSON().name, command]));
  if (commands.size !== modules.reduce((total, module) => total + module.commands.length, 0)) throw new Error("Duplicate command name");
  const buttons = modules.flatMap(module => module.buttons);
  const modals = modules.flatMap(module => module.modals);
  for (const handlers of [buttons, modals]) {
    for (let i = 0; i < handlers.length; i++) {
      const prefix = handlers[i].prefix;
      if (!prefix || prefix.startsWith("confirm:") || "confirm:".startsWith(prefix)) throw new Error("Invalid or reserved component prefix");
      if (handlers.slice(i + 1).some(other => other.prefix.startsWith(prefix) || prefix.startsWith(other.prefix))) throw new Error("Overlapping component prefixes");
    }
  }
  return {
    commands,
    button: (id: string) => buttons.find(handler => id.startsWith(handler.prefix)),
    modal: (id: string) => modals.find(handler => id.startsWith(handler.prefix)),
    definitions: [...commands.values()].map(command => ({
      ...command.data.toJSON(), contexts: [InteractionContextType.Guild],
      default_member_permissions: command.access === "public" ? null
        : (command.access === "moderator" ? PermissionFlagsBits.ModerateMembers : PermissionFlagsBits.Administrator).toString(),
    })),
  };
}
export type Registry = ReturnType<typeof createRegistry>;
