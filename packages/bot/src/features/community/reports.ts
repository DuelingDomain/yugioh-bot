import { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import type { CommandModule } from "../../runtime/types.js";
import { computeStats, hasPresence, listOnline, liveCounts } from "./admin-data.js";
import { FORMAT_LABEL, GOLD, PURPLE, clip, requireAdmin } from "./common.js";

const labels = { signups: "Sign-ups", activeUsers: "Active users", duelsStarted: "Duels started", duelsFinished: "Duels finished",
  draftsStarted: "Drafts started", draftsCompleted: "Drafts completed" } as const;

export const online: CommandModule = {
  data: new SlashCommandBuilder().setName("online").setDescription("Show online site users and their app sections")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  access: "admin",
  async execute(interaction, context) {
    if (!await requireAdmin(interaction,context,"online")) return;
    try {
      const data = listOnline(context.db,Date.now(),context.config.dataGuildId);
      if (!data) { await context.audit({ actorDiscordId: interaction.user.id, action: "online", result: "success", params: { presenceAvailable: false } }); await interaction.reply({ content: "presence not available. The site presence migration is not installed." }); return; }
      const users = data.users.map(user => `${escapeMarkdown(clip(user.name,100))} — ${user.label}`);
      const embed = new EmbedBuilder().setColor(PURPLE).setTitle(`Online • ${data.count}`)
        .setDescription(users.length ? clip(users.join("\n"),3500) : "No users were seen in the last 2 minutes.")
        .setFooter({ text: "Dueling Domain • Last 2 minutes • Up to 500 users" });
      if (data.bySection.length) embed.addFields({ name: "App sections", value: clip(data.bySection.map(group => `${group.label}: ${group.count}`).join("\n"),1024) });
      const files = users.join("\n").length > 3500 ? [new AttachmentBuilder(Buffer.from(data.users.map(user => `${user.name.replace(/[\r\n]/g," ")} — ${user.label}`).join("\n")), { name: "online-users.txt" })] : [];
      await interaction.reply({ embeds: [embed], ...(files.length ? { content: "The full online list is attached.", files } : {}) });
      await context.audit({ actorDiscordId: interaction.user.id, action: "online", result: "success", params: { count: data.count } });
    } catch {
      await context.audit({ actorDiscordId: interaction.user.id, action: "online", result: "failure" });
      await interaction.reply({ content: "Online users could not be read from the database." });
    }
  },
};

export const stats: CommandModule = {
  data: new SlashCommandBuilder().setName("stats").setDescription("Show site use and live tables for admins")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  access: "admin",
  async execute(interaction,context) {
    if (!await requireAdmin(interaction,context,"stats")) return;
    try {
      const now = Date.now();
      const data = computeStats(context.db,context.config.dataGuildId,now), live = liveCounts(context.db,context.config.dataGuildId,now);
      const presence = hasPresence(context.db);
      const embed = new EmbedBuilder().setColor(GOLD).setTitle("Dueling Domain • Stats")
        .setDescription(`ET • ${data.days[0]} to ${data.days.at(-1)}${presence ? "" : "\npresence not available; active users include duel and draft play only."}`)
        .addFields(Object.entries(labels).map(([key,label]) => ({ name: label, inline: true,
          value: `Today: ${data.today[key as keyof typeof labels]}\n7 days: ${data.last7Days[key as keyof typeof labels]}` })))
        .addFields({ name: "Live duels", value: Object.entries(live.duels).map(([format,count]) => `${FORMAT_LABEL[format as keyof typeof FORMAT_LABEL]}: ${count}`).join("\n"), inline: true },
          { name: "Duel lobbies", value: String(live.lobbies), inline: true },
          { name: "Live drafts", value: `Active: ${live.drafts.active}\nWaiting: ${live.drafts.waiting}`, inline: true })
        .setFooter({ text: "Past active-user counts use play and latest visits. Weekly users are distinct. Live lists: up to 100 rows each." });
      await interaction.reply({ embeds: [embed] });
      await context.audit({ actorDiscordId: interaction.user.id, action: "stats", result: "success" });
    } catch {
      await context.audit({ actorDiscordId: interaction.user.id, action: "stats", result: "failure" });
      await interaction.reply({ content: "Stats could not be read from the database." });
    }
  },
};
