import type { Interaction } from "discord.js";
import { report } from "@yugidraft/shared/observability";
import { toInteractionLike, refuse } from "./adapters.js";
import { mayUse } from "./guard.js";
import type { Registry } from "./registry.js";
import type { FeatureContext, Handler, InteractionLike, AutocompleteInteractionLike } from "./types.js";

export function createDispatcher(registry: Registry, context: FeatureContext) {
  return async (interaction: Interaction): Promise<void> => {
    if (context.signal.aborted) return;
    try {
      if (interaction.guildId !== context.config.guildId) {
        await refuse(interaction, "Use this bot in the configured server."); return;
      }
      const wrapped = toInteractionLike(interaction);
      if (!wrapped) return;
      const handler = interaction.isChatInputCommand() || interaction.isAutocomplete()
        ? registry.commands.get(interaction.commandName)
        : interaction.isButton() ? registry.button(interaction.customId)
        : interaction.isModalSubmit() ? registry.modal(interaction.customId) : undefined;
      if (!handler) { await refuse(interaction, "This action is no longer available."); return; }
      const autocomplete = interaction.isAutocomplete();
      if (!autocomplete) {
        const acknowledgement = handler.acknowledgement ?? "deferReply";
        if (acknowledgement !== "manual") await (wrapped as InteractionLike)[acknowledgement]();
      }
      if (!await mayUse(handler.access, wrapped.user.id, context)) {
        await context.audit({ actorDiscordId: wrapped.user.id, action: autocomplete ? "autocomplete" : "interaction", result: "denied" });
        await refuse(interaction, "You do not have access to this action."); return;
      }
      if (autocomplete) {
        const command = registry.commands.get(interaction.commandName)!;
        if (command.autocomplete) await command.autocomplete(wrapped as AutocompleteInteractionLike, context);
        else await interaction.respond([]);
        return;
      }
      await (handler as Handler<InteractionLike>).execute(wrapped as InteractionLike, context);
    } catch (error) {
      report(error, { tags: { operation: "bot.interaction" } });
      try { await refuse(interaction, "The action could not be completed. Try again later."); }
      catch (replyError) { report(replyError, { tags: { operation: "bot.interaction.reply" } }); }
    }
  };
}
