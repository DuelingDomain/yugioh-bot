import { ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType, PermissionFlagsBits,
  Events, MessageFlags, type Interaction, type UserContextMenuCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { CommandModule, FeatureContext, InteractionLike } from "../../runtime/types.js";
import { clearConfirmations, failure, userInfo } from "./handlers.js";

const definition = new ContextMenuCommandBuilder().setName("User info").setType(ApplicationCommandType.User)
  .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

/** The phase-0 definition type only names chat commands. The registry preserves
 * the JSON type discriminator and deploys this user command unchanged. */
export const userInfoCommand: CommandModule = {
  access: "moderator",
  data: { toJSON: () => definition.toJSON() as unknown as RESTPostAPIChatInputApplicationCommandsJSONBody },
  async execute() { /* User context interactions are routed by startContextMenu. */ },
};

function adapt(raw: UserContextMenuCommandInteraction): InteractionLike {
  return {
    id: raw.id, guildId: raw.guildId, channelId: raw.channelId,
    user: { id: raw.user.id, username: raw.user.username, displayName: raw.user.displayName },
    async reply(message) {
      const { flags, ephemeral, ...edit } = message;
      await raw.editReply({ ...edit, allowedMentions: { parse: [], repliedUser: false } });
    },
    async editReply(message) { await raw.editReply({ ...message, allowedMentions: { parse: [], repliedUser: false } }); },
    async deferReply() { await raw.deferReply({ flags: MessageFlags.Ephemeral }); },
    async deferUpdate() {}, async showModal() {},
  };
}

/** Local adapter: the phase-0 dispatcher intentionally ignores context menus. */
export function startContextMenu(context: FeatureContext) {
  const inFlight = new Set<Promise<void>>();
  const listener = (raw: Interaction) => {
    if (!raw.isUserContextMenuCommand() || raw.commandName !== "User info" || context.signal.aborted) return;
    // The runtime owns the foreign-guild/DM refusal, so do not double-ack it.
    if (raw.guildId !== context.config.guildId) return;
    const interaction = adapt(raw);
    const task = (async () => {
      await interaction.deferReply();
      await userInfo(interaction, context, raw.targetId);
    })().catch(async () => {
      // Never report the upstream error object: interaction tokens can be in it.
      try { await failure(interaction, context, { kind: "user_info", targetId: raw.targetId, reason: "Moderator user information lookup" }, new Error("Context command failed")); }
      catch { /* A deleted/expired interaction cannot be replied to again. */ }
    });
    inFlight.add(task); void task.finally(() => inFlight.delete(task));
  };
  context.client.on(Events.InteractionCreate, listener);
  return async () => {
    context.client.off(Events.InteractionCreate, listener);
    clearConfirmations(context);
    await Promise.allSettled(inFlight);
  };
}
