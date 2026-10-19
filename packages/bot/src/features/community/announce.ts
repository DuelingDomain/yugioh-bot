import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
  ModalBuilder, PermissionFlagsBits, Routes, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type APIGuildMember, type APIRole, type RESTGetAPIChannelResult,
} from "discord.js";
import type { CommandModule, ComponentModule, ButtonInteractionLike, ModalInteractionLike, FeatureContext } from "../../runtime/types.js";
import { CommunityError, GOLD, PURPLE, NO_MENTIONS, NO_API_MENTIONS, errorText, requireAdmin } from "./common.js";

type Session = { actorId: string; guildId: string; expires: number; roleId?: string } &
  ({ stage: "modal" } | { stage: "preview"; embed: ReturnType<EmbedBuilder["toJSON"]> });
const PREFIX = "community:announce:";

async function checkRole(context: FeatureContext, actorId: string, roleId?: string): Promise<void> {
  if (!roleId) return;
  const botId = context.client.user?.id;
  if (!botId) throw new CommunityError("The bot is not ready. Try again later.");
  const [roles, actor, bot] = await Promise.all([
    context.rest.get(Routes.guildRoles(context.config.guildId)) as Promise<APIRole[]>,
    context.rest.get(Routes.guildMember(context.config.guildId, actorId)) as Promise<APIGuildMember>,
    context.rest.get(Routes.guildMember(context.config.guildId, botId)) as Promise<APIGuildMember>,
  ]);
  const selected = roles.find(role => role.id === roleId);
  if (!selected || selected.id === context.config.guildId || selected.managed) throw new CommunityError("Select an ordinary server role. The everyone and managed roles are not allowed.");
  const highest = (member: APIGuildMember) => Math.max(0, ...roles.filter(role => member.roles.includes(role.id)).map(role => role.position));
  if (selected.position >= highest(actor) || selected.position >= highest(bot)) throw new CommunityError("The selected role must be below both your top role and the bot's top role.");
  const permissions = roles.filter(role => role.id === context.config.guildId || bot.roles.includes(role.id))
    .reduce((all, role) => all | BigInt(role.permissions), 0n);
  if (!selected.mentionable && !(permissions & (PermissionFlagsBits.MentionEveryone | PermissionFlagsBits.Administrator))) {
    throw new CommunityError("The selected role cannot be pinged. Make it mentionable or give the bot Mention Everyone permission.");
  }
}

function imageUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048) return url.href;
  } catch { /* Fixed validation error below. */ }
  throw new CommunityError("The image URL must be an HTTPS URL without credentials.");
}

export function announcementHandlers() {
  const sessions = new Map<string, Session>();
  const prune = () => { for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key); };
  const command: CommandModule = {
    data: new SlashCommandBuilder().setName("announce").setDescription("Preview and post Dueling Domain news")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption(option => option.setName("role").setDescription("Optional role ping from the server role list; default: none")),
    access: "admin", acknowledgement: "manual",
    async execute(interaction, context) {
      if (!await requireAdmin(interaction, context, "announce")) return;
      try {
        if (!context.config.announceChannelId) throw new CommunityError("Set DISCORD_ANNOUNCE_CHANNEL_ID before you use this command.");
        const roleId = interaction.options.getRole("role")?.id;
        await checkRole(context, interaction.user.id, roleId);
        prune();
        if (sessions.size >= 1000) throw new CommunityError("Too many announcement forms are open. Try again later.");
        const nonce = randomBytes(16).toString("hex");
        sessions.set(nonce, { stage: "modal", actorId: interaction.user.id, guildId: context.config.guildId, roleId, expires: Date.now() + 15 * 60_000 });
        const input = (id: string, label: string, style: TextInputStyle, max: number, required = true) =>
          new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required));
        try {
          await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}${nonce}`).setTitle("Dueling Domain announcement")
            .addComponents(input("title", "Title", TextInputStyle.Short, 256), input("body", "Body (Markdown)", TextInputStyle.Paragraph, 4000),
              input("image", "Image URL (HTTPS, optional)", TextInputStyle.Short, 2048, false)));
        } catch (error) { sessions.delete(nonce); throw error; }
      } catch (error) {
        await context.audit({ actorDiscordId: interaction.user.id, action: "announce", result: "failure" });
        await interaction.reply({ content: errorText(error), flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
      }
    },
  };
  const modal: ComponentModule<ModalInteractionLike> = {
    prefix: PREFIX, access: "admin",
    async execute(interaction, context) {
      if (!await requireAdmin(interaction, context, "announce")) return;
      const nonce = interaction.customId.slice(PREFIX.length), entry = sessions.get(nonce);
      if (!entry || entry.expires <= Date.now() || entry.stage !== "modal") {
        sessions.delete(nonce); await interaction.reply({ content: "This announcement form has expired." }); return;
      }
      if (entry.actorId !== interaction.user.id || entry.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Only the member who opened this form can use it." }); return;
      }
      sessions.delete(nonce);
      try {
        const title = interaction.fields.getTextInputValue("title").trim(), body = interaction.fields.getTextInputValue("body").trim();
        if (!title || title.length > 256 || !body || body.length > 4000) throw new CommunityError("Enter a title (1–256 characters) and body (1–4000 characters).");
        const image = imageUrl(interaction.fields.getTextInputValue("image"));
        const embed = new EmbedBuilder().setColor(PURPLE).setAuthor({ name: "Dueling Domain • News" }).setTitle(title)
          .setDescription(body).setFooter({ text: "Dueling Domain • Play. Build. Belong." });
        if (image) embed.setImage(image);
        // Freeze exactly the payload shown. No input is read again at confirmation time.
        const id = randomBytes(16).toString("hex");
        sessions.set(id, { ...entry, stage: "preview", expires: Date.now() + 60_000, embed: embed.toJSON() });
        await interaction.reply({ content: `Preview • Role ping: ${entry.roleId ? `<@&${entry.roleId}>` : "none"}. Post within 60 seconds.`,
          embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}post:${id}`).setLabel("Post").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`${PREFIX}cancel:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
          )] });
      } catch (error) {
        await context.audit({ actorDiscordId: interaction.user.id, action: "announce", result: "failure" });
        await interaction.reply({ content: errorText(error) });
      }
    },
  };
  const button: ComponentModule<ButtonInteractionLike> = {
    prefix: PREFIX, access: "admin", acknowledgement: "manual",
    async execute(interaction, context) {
      if (!await requireAdmin(interaction, context, "announce")) return;
      const [decision, nonce, extra] = interaction.customId.slice(PREFIX.length).split(":"), entry = sessions.get(nonce);
      if (extra || !["post", "cancel"].includes(decision) || !entry || entry.stage !== "preview" || entry.expires <= Date.now()) {
        if (entry?.expires && entry.expires <= Date.now()) sessions.delete(nonce);
        await interaction.reply({ content: "This announcement preview has expired. Run /announce again." }); return;
      }
      if (entry.actorId !== interaction.user.id || entry.guildId !== interaction.guildId) {
        await interaction.reply({ content: "Only the member who made this preview can post or cancel it." }); return;
      }
      sessions.delete(nonce); // Claim synchronously, before any REST calls or updates.
      await interaction.deferUpdate();
      if (decision === "cancel") {
        await context.audit({ actorDiscordId: interaction.user.id, action: "announce.cancel", result: "success" });
        await interaction.editReply({ content: "Announcement cancelled.", embeds: [], components: [] }); return;
      }
      let messageId: string | undefined, published = false, publishError: string | undefined;
      let content: string;
      try {
        await checkRole(context, interaction.user.id, entry.roleId);
        const channelId = context.config.announceChannelId;
        if (!channelId) throw new CommunityError("Set DISCORD_ANNOUNCE_CHANNEL_ID before you post.");
        const destination = await context.rest.get(Routes.channel(channelId)) as RESTGetAPIChannelResult;
        if (!("guild_id" in destination) || destination.guild_id !== context.config.guildId) throw new CommunityError("The announcement channel must be in the configured server.");
        if (destination.type !== ChannelType.GuildAnnouncement && destination.type !== ChannelType.GuildText) throw new CommunityError("Select a text or announcement channel for announcements.");
        const message = await context.rest.post(Routes.channelMessages(channelId), { body: {
          embeds: [entry.embed], ...(entry.roleId ? { content: `<@&${entry.roleId}>` } : {}),
          allowed_mentions: { ...NO_API_MENTIONS, ...(entry.roleId ? { roles: [entry.roleId] } : {}) },
          nonce: interaction.id, enforce_nonce: true,
        }, signal: context.signal }) as { id: string };
        messageId = message.id;
        if (destination.type === ChannelType.GuildAnnouncement) {
          try { await context.rest.post(Routes.channelMessageCrosspost(channelId, messageId), { signal: context.signal }); published = true; }
          catch (error) { publishError = errorText(error); }
        }
        content = publishError ? `Announcement posted, but it could not be published. ${publishError}`
          : `Announcement posted${published ? " and published" : ""}.`;
      } catch (error) {
        content = messageId ? "Announcement posted. The final update failed; do not post it again." : errorText(error);
      }
      // Record the outcome once. A failed preview edit must not create a second audit row.
      try {
        await context.audit({ actorDiscordId: interaction.user.id, action: "announce", result: messageId ? "success" : "failure",
          params: { channelId: context.config.announceChannelId, messageId, roleId: entry.roleId ?? null, published,
            ...(publishError ? { publishFailed: true } : {}) },
          reason: messageId ? publishError ? "Posted; publishing failed." : "Announcement posted." : "Announcement failed." });
      } catch {
        content = messageId ? "Announcement posted, but its audit log could not be saved. Do not post it again."
          : "The action failed and its audit log could not be saved.";
      }
      try {
        await interaction.editReply({ content, embeds: messageId ? [new EmbedBuilder(entry.embed).setColor(GOLD)] : [], components: [] });
      } catch {
        await interaction.reply({ content: messageId ? "Announcement posted. The preview update failed; do not post it again." : content, components: [] });
      }
    },
  };
  return { command, modal, button, stop: () => sessions.clear() };
}
