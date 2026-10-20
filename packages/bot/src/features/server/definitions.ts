import { ChannelType as T, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder,
  type SlashCommandSubcommandBuilder as Sub } from "discord.js";

export const commonPermissions = {
  view: PermissionFlagsBits.ViewChannel, send: PermissionFlagsBits.SendMessages,
  "read-history": PermissionFlagsBits.ReadMessageHistory, attach: PermissionFlagsBits.AttachFiles,
  embed: PermissionFlagsBits.EmbedLinks, react: PermissionFlagsBits.AddReactions,
  connect: PermissionFlagsBits.Connect, speak: PermissionFlagsBits.Speak,
  "manage-messages": PermissionFlagsBits.ManageMessages,
} as const;
export const channelTypes = { text: T.GuildText, voice: T.GuildVoice, announcement: T.GuildAnnouncement,
  forum: T.GuildForum, stage: T.GuildStageVoice } as const;
const base = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description)
  .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
const name = (s: Sub, required = false) => s.addStringOption(o => o.setName("name").setDescription("Name").setMinLength(1).setMaxLength(100).setRequired(required));
const channel = (s: Sub) => s.addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)
  .addChannelTypes(T.GuildText, T.GuildVoice, T.GuildAnnouncement, T.GuildForum, T.GuildStageVoice));
const category = (s: Sub, required = false) => s.addChannelOption(o => o.setName("category").setDescription("Category").addChannelTypes(T.GuildCategory).setRequired(required));
const topic = (s: Sub) => s.addStringOption(o => o.setName("topic").setDescription("Topic; use an empty value to clear").setMaxLength(1024));
const slowmode = (s: Sub) => s.addIntegerOption(o => o.setName("slowmode").setDescription("Slowmode in seconds (0 disables)").setMinValue(0).setMaxValue(21600));
const role = (s: Sub) => s.addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true));
const appearance = (s: Sub) => s.addStringOption(o => o.setName("colour").setDescription("Hex colour, for example #336699; #000000 clears"))
  .addBooleanOption(o => o.setName("hoist").setDescription("Show role members in a separate group"))
  .addBooleanOption(o => o.setName("mentionable").setDescription("Let everyone mention this role"));

export const channelDefinition = base("channel", "Manage server channels")
  .addSubcommand(s => slowmode(topic(category(name(s.setName("create").setDescription("Create a channel"), true)
    .addStringOption(o => o.setName("type").setDescription("Channel type").setRequired(true)
      .addChoices(...Object.keys(channelTypes).map(value => ({ name: value, value })))))))
    .addBooleanOption(o => o.setName("private").setDescription("Restrict visibility to admins and selected roles"))
    .addStringOption(o => o.setName("roles").setDescription("Private channel role IDs or mentions, separated by spaces or commas").setMaxLength(400)))
  .addSubcommand(s => slowmode(topic(category(name(channel(s.setName("edit").setDescription("Edit a channel"))))))
    .addIntegerOption(o => o.setName("position").setDescription("Channel position").setMinValue(0).setMaxValue(499))
    .addBooleanOption(o => o.setName("nsfw").setDescription("Require age verification"))
    .addBooleanOption(o => o.setName("uncategorized").setDescription("Remove the parent category")))
  .addSubcommand(s => channel(s.setName("delete").setDescription("Delete a channel after confirmation")));

export const categoryDefinition = base("category", "Manage server categories")
  .addSubcommand(s => name(s.setName("create").setDescription("Create a category"), true))
  .addSubcommand(s => name(category(s.setName("rename").setDescription("Rename a category"), true), true))
  .addSubcommand(s => category(s.setName("delete").setDescription("Delete an empty category or move its children"), true)
    .addChannelOption(o => o.setName("move-to").setDescription("Move children to this category before deletion").addChannelTypes(T.GuildCategory))
    .addBooleanOption(o => o.setName("move-to-root").setDescription("Move children out of all categories")));

export const permissionsDefinition = base("permissions", "Manage channel permission overwrites")
  .addSubcommand(s => s.setName("set").setDescription("Change one permission after confirmation")
    .addChannelOption(o => o.setName("channel").setDescription("Channel or category").setRequired(true)
      .addChannelTypes(T.GuildText, T.GuildVoice, T.GuildAnnouncement, T.GuildForum, T.GuildStageVoice, T.GuildCategory))
    .addStringOption(o => o.setName("permission").setDescription("Permission to change").setRequired(true)
      .addChoices(...Object.keys(commonPermissions).map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("state").setDescription("Overwrite state").setRequired(true)
      .addChoices({ name: "Allow", value: "allow" }, { name: "Deny", value: "deny" }, { name: "Neutral", value: "neutral" }))
    .addRoleOption(o => o.setName("role").setDescription("Target role (choose role or member)"))
    .addUserOption(o => o.setName("member").setDescription("Target member (choose role or member)")))
  .addSubcommand(s => s.setName("view").setDescription("Show all permission overwrites")
    .addChannelOption(o => o.setName("channel").setDescription("Channel or category").setRequired(true)
      .addChannelTypes(T.GuildText, T.GuildVoice, T.GuildAnnouncement, T.GuildForum, T.GuildStageVoice, T.GuildCategory)));

export const roleDefinition = base("role", "Manage server roles")
  .addSubcommand(s => appearance(name(s.setName("create").setDescription("Create a role without server permissions"), true)))
  .addSubcommand(s => appearance(name(role(s.setName("edit").setDescription("Edit a role")))))
  .addSubcommand(s => role(s.setName("delete").setDescription("Delete a role after confirmation")))
  .addSubcommand(s => role(s.setName("give").setDescription("Give a role to a member")
    .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true))))
  .addSubcommand(s => role(s.setName("take").setDescription("Take a role from a member")
    .addUserOption(o => o.setName("member").setDescription("Member").setRequired(true))));

export const setupDefinition = base("setup", "Set up recommended bot channels")
  .addSubcommand(s => s.setName("channels").setDescription("Create or repair the admin layout after confirmation"));
