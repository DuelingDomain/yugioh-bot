import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";

const DEFAULT_WEB_URL = "http://localhost:3000";

function webBaseUrl(webUrl?: string): string {
  return (webUrl?.trim() || process.env.WEB_URL?.trim() || DEFAULT_WEB_URL).replace(/\/+$/, "");
}

export function draftCreatedAnnouncement(input: { name: string; webSlug: string; webUrl?: string }): string {
  return `Signups are open for **${input.name}**. Pick cards: ${webBaseUrl(input.webUrl)}/draft/${input.webSlug}`;
}

export function draftStartedAnnouncement(input: { name: string; webSlug: string; webUrl?: string }) {
  return {
    content: `Dueling Domain — **${input.name}** has started. Open the draft to pick your cards.`,
    allowedMentions: { parse: [], users: [] as string[] },
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel("Open draft").setStyle(ButtonStyle.Link)
        .setURL(`${webBaseUrl(input.webUrl)}/draft/${input.webSlug}`),
    )],
  };
}

/** IDs come from the handler's current guild/roster/readiness validation. */
export function draftNudgeAnnouncement(input: {
  name: string; webSlug: string; mentionUserIds: string[]; webUrl?: string;
}) {
  const mentions = input.mentionUserIds.map(id => `<@${id}>`).join(" ");
  return {
    content: [
      `Dueling Domain — Signups are open for **${input.name}**.`,
      ...(mentions ? [`${mentions} — review the lobby and mark Ready when you are set.`] : []),
      "Join in the lobby or use `/draft join` in Discord.",
    ].join("\n"),
    allowedMentions: { parse: [], users: input.mentionUserIds },
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel("Open lobby").setStyle(ButtonStyle.Link)
        .setURL(`${webBaseUrl(input.webUrl)}/draft/${input.webSlug}`),
    )],
  };
}

export function tournamentCreatedAnnouncement(input: {
  name: string;
  format: string;
  webSlug: string;
  organizerUserId: string;
  participantCount: number;
  webUrl?: string;
}): string {
  const formatLabel = input.format === "round_robin" ? "Round Robin" : input.format === "single_elim" ? "Single Elimination" : input.format;
  return [
    `🏆 **${input.name}** — Signups open`,
    `Format: ${formatLabel} · Pending — ${input.participantCount} participant${input.participantCount === 1 ? "" : "s"}`,
    `Organizer: <@${input.organizerUserId}>`,
    `Join: ${webBaseUrl(input.webUrl)}/tournament/${input.webSlug}`,
  ].join("\n");
}

export function tournamentStartedAnnouncement(input: { name: string; webSlug: string; webUrl?: string }): string {
  return `**${input.name}** has started. Bracket: ${webBaseUrl(input.webUrl)}/tournament/${input.webSlug}`;
}

export function tournamentCompletedAnnouncement(input: {
  name: string;
  webSlug: string;
  webUrl?: string;
}): string {
  return `🏆 **${input.name}** has completed! Final standings: ${webBaseUrl(input.webUrl)}/tournament/${input.webSlug}`;
}

export function draftCompletedAnnouncement(input: { name: string; webSlug: string; webUrl?: string }): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    content: `**${input.name}** has completed! View results: ${webBaseUrl(input.webUrl)}/draft/${input.webSlug}`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`draft:create-tournament:${input.webSlug}`)
          .setLabel("Create Tournament")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

export function reportPendingAnnouncement(input: {
  matchId: number;
  tournamentName: string;
  roundNumber: number;
  reporterName: string;
  opponentDiscordId: string;
  opponentLost: boolean;
}): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const verb = input.opponentLost ? "lost" : "won";
  return {
    content:
      `<@${input.opponentDiscordId}> — **${input.reporterName}** reported that you **${verb}** ` +
      `Round ${input.roundNumber} of **${input.tournamentName}**. Approve or deny:`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`dashboard_approve:${input.matchId}:${input.opponentDiscordId}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`dashboard_deny:${input.matchId}:${input.opponentDiscordId}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

/** The DM a challenged player (or a tournament opponent) gets, with a Join duel link button. */
export function duelInviteMessage(input: {
  challengerName: string;
  duelName: string;
  bestOf: 1 | 3;
  ranked: boolean;
  tournamentName: string | null;
  url: string;
}): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle(input.tournamentName ? "Your tournament match is ready" : "You were challenged to a duel")
    .setDescription(
      input.tournamentName
        ? `**${input.challengerName}** started your match in **${input.tournamentName}**.`
        : `**${input.challengerName}** challenged you to a duel.`,
    )
    .setColor(0x7c3aed)
    .addFields(
      { name: "Duel", value: input.duelName, inline: true },
      { name: "Match", value: `Best of ${input.bestOf}`, inline: true },
      {
        name: input.tournamentName ? "Tournament" : "Type",
        value: input.tournamentName ?? (input.ranked ? "Ranked" : "Unranked"),
        inline: true,
      },
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Join duel").setStyle(ButtonStyle.Link).setURL(input.url),
      ),
    ],
  };
}
