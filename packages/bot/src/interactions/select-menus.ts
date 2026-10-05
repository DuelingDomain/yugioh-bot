import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type InteractionReplyOptions,
} from "discord.js";
import type Database from "better-sqlite3";
import type { DiscordUserLike, DraftMessenger } from "../commands/handlers.js";
import type { PlayerRepository } from "../repositories/players.js";
import type { CardCatalogService } from "../services/card-catalog.js";
import type { DraftImageService } from "../services/draft-images.js";
import type { DraftService } from "../services/drafts.js";
import { createDraftTournamentService, MAX_COPIES_PER_PLAYER } from "@yugidraft/shared/services";
import type { TournamentService } from "@yugidraft/shared/services";
import type { Broadcaster } from "@yugidraft/shared/notify";

type SelectMenuDependencies = {
  tournaments: TournamentService;
  players: PlayerRepository;
  drafts: DraftService;
  cards: CardCatalogService;
  messenger: DraftMessenger;
  db: Database.Database;
  broadcaster: Broadcaster;
};

export type SelectMenuInteractionLike = {
  customId: string;
  channelId: string | null;
  guildId: string | null;
  user: DiscordUserLike;
  values: string[];
  showModal(modal: ModalBuilder): Promise<void> | void;
  reply(
    message: { content: string; ephemeral: boolean; components?: InteractionReplyOptions["components"]; files?: InteractionReplyOptions["files"] },
  ): Promise<void> | void;
};

function requireGuildId(interaction: SelectMenuInteractionLike): string {
  if (!interaction.guildId) {
    throw new Error("This interaction can only be used in a server");
  }

  return interaction.guildId;
}

function displayName(user: DiscordUserLike): string {
  return user.displayName ?? user.username;
}

function requireFormat(value: string): "round_robin" | "single_elim" {
  if (value === "round_robin" || value === "single_elim") {
    return value;
  }

  throw new Error("Unsupported tournament format");
}

export async function handleSelectMenu(
  interaction: SelectMenuInteractionLike,
  deps: SelectMenuDependencies,
): Promise<void> {
  const draftPickCard = /^draft_pick_card:(\d+)$/.exec(interaction.customId);

  if (draftPickCard) {
    const draftId = Number(draftPickCard[1]);
    const draft = deps.drafts.findById(draftId);
    const guildId = interaction.guildId ?? draft.guildId;

    if (interaction.guildId && draft.guildId !== interaction.guildId) {
      throw new Error("Draft not found in this server");
    }

    const player = deps.players.upsert(guildId, interaction.user.id, displayName(interaction.user));
    const options = deps.drafts.pickOptions(draftId, player.id);

    if (options.length === 0) {
      const progress = deps.db.prepare(
        "select pick_count, finished_at from draft_players where draft_id = ? and player_id = ?",
      ).get(draftId, player.id) as { pick_count: number; finished_at: string | null } | undefined;
      if (
        draft.status === "active" && progress &&
        (progress.finished_at !== null || progress.pick_count >= (draft.config.cardsPerPlayer ?? 40))
      ) {
        await interaction.reply({
          content: "You have finished drafting. Waiting for other players.",
          ephemeral: true,
        });
        return;
      }
      const picked = deps.db.prepare(
        "select 1 from draft_picks where draft_id = ? and player_id = ? and wave_number = ? and pick_step = ?",
      ).get(draftId, player.id, draft.currentPackRound, draft.currentPickStep);
      const pack = deps.drafts.currentPackOptions(draftId, player.id);
      const content = draft.status === "completed"
        ? "This draft has completed."
        : picked
          ? "You already picked this step. Waiting for other players."
          : deps.drafts.hasPassedStep(draftId, player.id)
            ? "You passed this pick because there was nothing in the pack you could take. Waiting for other players."
            : pack.length > 0
              ? `Nothing in this pack you can take (you have ${MAX_COPIES_PER_PLAYER} of each). Waiting for the next pack.`
              : "You have no card to take this step. Waiting for the next pack.";
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const draftCardId = Number(interaction.values[0]);
    const pickedCard = options.find((card) => card.id === draftCardId);
    if (!pickedCard) {
      const cappedChoice = deps.drafts.currentPackOptions(draftId, player.id).some((card) => card.id === draftCardId);
      await interaction.reply({
        content: cappedChoice
          ? `You already have ${MAX_COPIES_PER_PLAYER} copies of that card. Choose another card from your current pack.`
          : "This choice is no longer in your current pack. Open your current pack and choose again.",
        ephemeral: true,
      });
      return;
    }
    const beforePickDraft = deps.drafts.findById(draftId);
    deps.drafts.pickCard(draftId, player.id, draftCardId);

    const updatedDraft = deps.drafts.findById(draftId);
    const advancedPickStep =
      updatedDraft.currentPackRound !== beforePickDraft.currentPackRound ||
      updatedDraft.currentPickStep !== beforePickDraft.currentPickStep;

    if (updatedDraft.webSlug) {
      void deps.broadcaster.draft({
        kind: "pick", slug: updatedDraft.webSlug, playerId: player.id,
        packRound: beforePickDraft.currentPackRound, pickStep: beforePickDraft.currentPickStep,
      });
      if (updatedDraft.status === "completed") {
        void deps.broadcaster.draft({ kind: "complete", slug: updatedDraft.webSlug });
      } else if (advancedPickStep) {
        void deps.broadcaster.draft({
          kind: "resync", slug: updatedDraft.webSlug,
          packRound: updatedDraft.currentPackRound, pickStep: updatedDraft.currentPickStep,
        });
      }
    }

    const catalogCards = deps.cards.findByIds([pickedCard.catalogCardId]);
    const cardName = catalogCards[0]?.name ?? "Unknown";

    const forcedNote = pickedCard.forced
      ? ` You have ${MAX_COPIES_PER_PLAYER} of each card here. You can use this extra copy in your deck.`
      : "";
    await interaction.reply({ content: `You picked ${cardName}.${forcedNote}`, ephemeral: true });

    if (updatedDraft.status === "active" && advancedPickStep) {
      await deps.messenger.updateStatus(updatedDraft);
    }

    return;
  }

  const draftTournamentFormat = /^draft:tournament-format:([a-z0-9-]+)$/.exec(interaction.customId);

  if (draftTournamentFormat) {
    const webSlug = draftTournamentFormat[1];
    const format = interaction.values[0];

    if (format !== "round_robin" && format !== "single_elim") {
      await interaction.reply({ content: "Invalid format.", ephemeral: true });
      return;
    }

    const draftRow = deps.db
      .prepare("select id, created_by_user_id, status from drafts where web_slug = ?")
      .get(webSlug) as { id: number; created_by_user_id: string; status: string } | undefined;

    if (!draftRow) {
      await interaction.reply({ content: "Draft not found.", ephemeral: true });
      return;
    }

    if (draftRow.created_by_user_id !== interaction.user.id) {
      await interaction.reply({ content: "Only the draft creator can create a tournament.", ephemeral: true });
      return;
    }

    const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
    const service = createDraftTournamentService(deps.db);
    try {
      const result = service.createTournamentFromDraft({
        draftId: draftRow.id,
        format,
        createdByUserId: interaction.user.id,
      });
      void deps.broadcaster.draft({ kind: "seats", slug: webSlug });
      const link = result.webSlug ? ` View: ${WEB_URL}/tournament/${result.webSlug}` : "";
      await interaction.reply({ content: `Tournament **${result.tournamentName}** created.${link}`, ephemeral: true });
    } catch (err) {
      await interaction.reply({
        content: err instanceof Error ? err.message : "Failed to create tournament.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.customId !== "dashboard_create_event_format") {
    throw new Error("Unsupported select menu interaction");
  }

  const format = requireFormat(interaction.values[0] ?? "");

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`dashboard_create_event:${format}`)
      .setTitle("Create Event")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("Event name")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
      ),
  );
}
