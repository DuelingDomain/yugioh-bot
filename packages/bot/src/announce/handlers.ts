import { ChannelType, type Client } from "discord.js";
import type Database from "better-sqlite3";
import type { DraftMessenger } from "../commands/handlers.js";
import type { DraftService } from "../services/drafts.js";
import type { AnnounceHandlers } from "./server.js";
import type { GuildSettingsService } from "@yugidraft/shared/services";
import {
  draftCreatedAnnouncement,
  draftCompletedAnnouncement,
  tournamentCreatedAnnouncement,
  tournamentStartedAnnouncement,
  reportPendingAnnouncement,
  duelInviteMessage,
} from "./messages.js";
import { announceTournamentCompleted } from "../lib/announce-tournament-completed.js";
import { deleteNotifyMessage } from "../lib/notify-message.js";

export function createAnnounceHandlers({
  client,
  db,
  guildSettings,
  drafts,
  messenger,
}: {
  client: Pick<Client, "channels" | "users">;
  db: Database.Database;
  drafts: DraftService;
  messenger: DraftMessenger;
  guildSettings: GuildSettingsService;
}): AnnounceHandlers {
  async function onDraftStatus({ draftId }: { draftId: number }): Promise<void> {
    if (!Number.isSafeInteger(draftId) || draftId <= 0) throw new Error("Invalid draft ID");
    const draft = drafts.findById(draftId);
    if (draft.channelId) await messenger.updateStatus(draft);
  }

  return {
    onDraftStatus,
    async onDraftCreated({ channelId, name, webSlug }) {
      const channel = await client.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildText) return;
      await channel.send(draftCreatedAnnouncement({ name, webSlug }));
    },
    async onDraftStarted() {
      return;
    },
    async onDraftCompleted({ draftId }) {
      const draft = drafts.findById(draftId);
      if (draft.status !== "completed" || !draft.channelId || !draft.webSlug) return;
      // Delivery is at-most-once: claim before Discord I/O, and never retry a failed send.
      const claimed = db.prepare(`update drafts set complete_message_id='worker-claimed'
        where id=? and status='completed' and complete_message_id is null`).run(draftId).changes === 1;
      if (!claimed) return;
      const skip = (reason: string) => {
        db.prepare("update drafts set complete_message_id='skipped' where id=? and complete_message_id='worker-claimed'")
          .run(draftId);
        console.error(`[announce] draft completion skipped for ${draftId}: ${reason}`);
      };
      let channel;
      try {
        channel = await client.channels.fetch(draft.channelId);
      } catch (error) {
        skip(`channel fetch failed (${String(error)})`);
        return;
      }
      if (channel?.type !== ChannelType.GuildText) {
        skip("channel is missing or is not a guild text channel");
        return;
      }
      try {
        const msg = await channel.send(draftCompletedAnnouncement({ name: draft.name, webSlug: draft.webSlug }));
        db.prepare("update drafts set complete_message_id=? where id=? and complete_message_id='worker-claimed'")
          .run(msg.id, draftId);
      } catch (error) {
        console.error(`[announce] draft completion delivery failed for ${draftId}:`, error);
      }
    },
    async onTournamentCreated({ channelId, name, format, webSlug, organizerUserId, participantCount }) {
      const channel = await client.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildText) return;
      await channel.send(
        tournamentCreatedAnnouncement({ name, format, webSlug, organizerUserId, participantCount }),
      );
    },
    async onTournamentStarted({ channelId, name, webSlug }) {
      const channel = await client.channels.fetch(channelId);
      if (channel?.type !== ChannelType.GuildText) return;
      await channel.send(tournamentStartedAnnouncement({ name, webSlug }));
    },

    async onMatchReportPending(p) {
      const channelId = guildSettings.get(p.guildId).announceChannelId;
      if (!channelId) return;
      const channel = await client.channels.fetch(channelId);
      if (!channel || !("send" in channel) || !channel.isTextBased()) return;
      const msg = await channel.send(
        reportPendingAnnouncement({
          matchId: p.matchId,
          tournamentName: p.tournamentName,
          roundNumber: p.roundNumber,
          reporterName: p.reporterName,
          opponentDiscordId: p.opponentDiscordId,
          opponentLost: p.opponentLost,
        }),
      );
      db.prepare(
        "update matches set notify_channel_id = ?, notify_message_id = ? where id = ?",
      ).run(channelId, msg.id, p.matchId);
    },

    async onMatchResolved(p) {
      await deleteNotifyMessage(client, db, p.matchId);
    },

    async onTournamentCompleted({ tournamentId }) {
      await announceTournamentCompleted(client, db, guildSettings, tournamentId);
    },

    async onDuelInvite({ opponentDiscordUserId, challengerName, duelName, bestOf, ranked, tournamentName, url }) {
      // A closed DM or an unknown user must not fail the announce call.
      try {
        const user = await client.users.fetch(opponentDiscordUserId);
        await user.send(duelInviteMessage({ challengerName, duelName, bestOf, ranked, tournamentName, url }));
      } catch (err) {
        console.warn(`[announce] could not DM duel invite to ${opponentDiscordUserId}:`, err);
      }
    },
  };
}
