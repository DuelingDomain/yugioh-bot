import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder,
  type SlashCommandStringOption, type SlashCommandUserOption } from "discord.js";
import type { CommandModule, FeatureModule } from "../../runtime/types.js";
import { button, command } from "./handlers.js";
import { startContextMenu, userInfoCommand } from "./context-menu.js";

const user = (option: SlashCommandUserOption) => option.setName("user").setDescription("Target user").setRequired(true);
const reason = (option: SlashCommandStringOption) => option.setName("reason").setDescription("Reason for the moderation action").setMaxLength(500);
function base(name: string, description: string) {
  return new SlashCommandBuilder().setName(name).setDescription(description)
    .setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
}
function handler(data: CommandModule["data"]): CommandModule { return { data, access: "moderator", execute: command }; }

const commands: CommandModule[] = [
  handler(base("timeout", "Set or remove a member timeout")
    .addUserOption(user).addStringOption(option => option.setName("duration").setDescription("Examples: 30m, 2h, 1d12h (max 28d); remove or 0 clears timeout").setRequired(true).setMaxLength(100))
    .addStringOption(reason)),
  handler(base("untimeout", "Remove a member timeout").addUserOption(user).addStringOption(reason)),
  handler(base("kick", "Kick a member after confirmation").addUserOption(user).addStringOption(reason)),
  handler(base("ban", "Ban a user after confirmation").addUserOption(user).addStringOption(reason)
    .addIntegerOption(option => option.setName("delete-message-days").setDescription("Days of message history to delete (0–7)").setMinValue(0).setMaxValue(7))),
  handler(base("unban", "Unban a Discord user ID").addStringOption(option => option.setName("user-id").setDescription("Discord user ID to unban").setRequired(true).setMaxLength(20)).addStringOption(reason)),
  handler(base("purge", "Delete from the latest 1–100 messages; skip messages at least 14 days old")
    .addIntegerOption(option => option.setName("count").setDescription("Number of recent messages to scan (1–100); confirms above 10").setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption(option => option.setName("user").setDescription("Only delete messages from this user"))
    .addStringOption(reason)),
  handler(base("warn", "Save a warning and try to DM the user").addUserOption(user)
    .addStringOption(option => reason(option).setRequired(true))),
  handler(base("warnings", "List a user's warnings; site admins can clear one after confirmation").addUserOption(user)
    .addIntegerOption(option => option.setName("page").setDescription("Warning page (10 warnings per page)").setMinValue(1))
    .addIntegerOption(option => option.setName("clear").setDescription("Warning ID to clear (site admins only)").setMinValue(1))
    .addStringOption(reason)),
  handler(base("slowmode", "Set channel slowmode; use 0 to disable")
    .addChannelOption(option => option.setName("channel").setDescription("Channel to change").addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia).setRequired(true))
    .addIntegerOption(option => option.setName("seconds").setDescription("Slowmode seconds (0–21600)").setMinValue(0).setMaxValue(21600).setRequired(true))
    .addStringOption(reason)),
  ...(["lock", "unlock"] as const).map(name => handler(base(name, name === "lock" ? "Deny @everyone Send Messages; save the previous overwrite" : "Restore the exact @everyone overwrite saved by lock")
    .addChannelOption(option => option.setName("channel").setDescription("Channel (defaults to this channel)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia))
    .addStringOption(reason))),
  userInfoCommand,
];

export const moderation: FeatureModule = {
  commands, buttons: [{ prefix: "mod:", access: "moderator", acknowledgement: "manual", execute: button }], modals: [], start: startContextMenu,
};
