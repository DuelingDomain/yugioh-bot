import { MessageFlags, type Interaction, type RepliableInteraction, type InteractionReplyOptions } from "discord.js";
import type { InteractionLike, CommandInteractionLike, ButtonInteractionLike, ModalInteractionLike, AutocompleteInteractionLike } from "./types.js";

const allowedMentions = { parse: [] as never[], repliedUser: false };
const deferredUpdates = new WeakSet<RepliableInteraction>();

function base(interaction: RepliableInteraction): InteractionLike {
  return {
    id: interaction.id, guildId: interaction.guildId, channelId: interaction.channelId,
    user: { id: interaction.user.id, username: interaction.user.username, displayName: interaction.user.displayName },
    async reply(message) {
      if (interaction.deferred) {
        const { flags, ephemeral, ...edit } = message;
        await interaction.editReply({ ...edit, allowedMentions });
      } else if (interaction.replied) {
        await interaction.followUp({ ...message, allowedMentions, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ ...message, allowedMentions, flags: message.flags ?? MessageFlags.Ephemeral });
      }
    },
    async editReply(message) { await interaction.editReply({ ...message, allowedMentions }); },
    async deferReply() {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    },
    async deferUpdate() {
      if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
        deferredUpdates.add(interaction);
      }
    },
    async showModal(modal) {
      if (!interaction.isModalSubmit()) await interaction.showModal(modal);
    },
  };
}
export function toInteractionLike(interaction: Interaction): CommandInteractionLike | ButtonInteractionLike | ModalInteractionLike | AutocompleteInteractionLike | null {
  if (interaction.isAutocomplete()) return {
    guildId: interaction.guildId, commandName: interaction.commandName,
    user: { id: interaction.user.id, username: interaction.user.username, displayName: interaction.user.displayName },
    options: { getFocused: () => { const focused = interaction.options.getFocused(true); return { name: focused.name, value: String(focused.value) }; } },
    respond: async choices => { await interaction.respond(choices); },
  };
  if (interaction.isChatInputCommand()) return {
    ...base(interaction), commandName: interaction.commandName,
    options: {
      getSubcommand: required => interaction.options.getSubcommand(required ?? false),
      getSubcommandGroup: required => interaction.options.getSubcommandGroup(required),
      getString: (name, required) => interaction.options.getString(name, required),
      getInteger: (name, required) => interaction.options.getInteger(name, required),
      getNumber: (name, required) => interaction.options.getNumber(name, required),
      getBoolean: (name, required) => interaction.options.getBoolean(name, required),
      getUser: (name, required) => {
        const user = interaction.options.getUser(name, required);
        return user ? { id: user.id, username: user.username, displayName: user.displayName } : null;
      },
      getRole: (name, required) => {
        const role = interaction.options.getRole(name, required);
        return role ? { id: role.id, name: role.name, position: role.position } : null;
      },
      getChannel: (name, required) => {
        const channel = interaction.options.getChannel(name, required);
        return channel ? { id: channel.id, name: channel.name, type: channel.type } : null;
      },
    },
  };
  if (interaction.isButton()) return { ...base(interaction), customId: interaction.customId };
  if (interaction.isModalSubmit()) return { ...base(interaction), customId: interaction.customId,
    fields: { getTextInputValue: name => interaction.fields.getTextInputValue(name) } };
  return null;
}

export async function refuse(interaction: Interaction, content: string): Promise<void> {
  if (interaction.isAutocomplete()) { await interaction.respond([]); return; }
  if (!interaction.isRepliable()) return;
  if (deferredUpdates.has(interaction)) {
    // A denial after deferUpdate must not replace the shared source message.
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions });
  } else await base(interaction).reply({ content, flags: MessageFlags.Ephemeral } satisfies InteractionReplyOptions);
}
