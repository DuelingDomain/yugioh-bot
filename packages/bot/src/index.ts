import { reportInteractionError } from "./interactions/errors.js";
import "dotenv/config";
import cron from "node-cron";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  handleCommand,
  type CommandInteractionLike,
  type DraftMessenger,
} from "./commands/handlers.js";
import {
  createCardCatalogService,
  createCubeService,
  createDraftImageService,
  createDraftService,
  createGuildSettingsService,
} from "@yugidraft/shared/services";
import type { Draft } from "@yugidraft/shared/types";
import { openDatabase } from "./db/connection.js";
import { createDraftCleanupService } from "./services/draft-cleanup.js";
import {
  handleAutocomplete,
  type AutocompleteInteractionLike,
} from "./interactions/autocomplete.js";
import { handleButton, type ButtonInteractionLike } from "./interactions/buttons.js";
import { handleModal, type ModalInteractionLike } from "./interactions/modals.js";
import {
  handleSelectMenu,
  type SelectMenuInteractionLike,
} from "./interactions/select-menus.js";
import { createPlayerRepository } from "./repositories/players.js";
import {
  formatTournamentReminder,
  selectTournamentReminderTargets,
} from "./reminders/tournament-reminders.js";
import { createNotifyCleanupService } from "./services/notify-cleanup.js";
import { createMatchService } from "@yugidraft/shared/services";
import { createTournamentService } from "@yugidraft/shared/services";
import { createAnnounceHandlers } from "./announce/handlers.js";
import { createAnnounceServer } from "./announce/server.js";
import { deleteNotifyMessage } from "./lib/notify-message.js";
import { announceTournamentCompleted } from "./lib/announce-tournament-completed.js";
import { createHttpNotifyDuelChange } from "./lib/notify-duel.js";
import { createBroadcaster, httpTransport } from "@yugidraft/shared/notify";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN is required");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const db = openDatabase();
const cardImageCacheDir = process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images";
const cleanup = createDraftCleanupService(db, { imageCacheDir: cardImageCacheDir });

function buildDraftStatus(draft: Draft) {
  const draftService = deps.drafts;
  const playerService = deps.players;
  const players = draftService.players(draft.id);
  const picks = draftService.picks(draft.id);
  const currentPicks = picks.filter(
    (p) => p.waveNumber === draft.currentPackRound && p.pickStep === draft.currentPickStep,
  );
  const pickedPlayerIds = new Set(currentPicks.map((p) => p.playerId));
  const pickedCount = pickedPlayerIds.size;
  const waitingPlayers = players.filter((p) => !pickedPlayerIds.has(p.playerId));

  const remainingSeconds = draft.pickDeadlineAt
    ? Math.max(0, Math.ceil((new Date(draft.pickDeadlineAt).getTime() - Date.now()) / 1000))
    : 0;

  const embed = new EmbedBuilder()
    .setTitle(draft.name)
    .setColor(
      draft.status === "active" ? 0x3498db : draft.status === "completed" ? 0x2ecc71 : 0xe74c3c,
    );

  if (draft.status === "active") {
    embed.setDescription(`Pack ${draft.currentPackRound}, Pick ${draft.currentPickStep}`);
    embed.addFields(
      { name: "⏱️ Timer", value: `${remainingSeconds}s`, inline: true },
      { name: "✅ Picked", value: `${pickedCount}/${players.length}`, inline: true },
      {
        name: "⏳ Waiting for",
        value:
          waitingPlayers
            .map((p) => playerService.findById(p.playerId)?.displayName ?? "Unknown")
            .join(", ") || "None",
        inline: false,
      },
    );
  } else if (draft.status === "completed") {
    embed.setDescription("Draft completed!");
  } else if (draft.status === "cancelled") {
    embed.setDescription("Draft cancelled.");
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (draft.status === "active") {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`draft_pick:${draft.id}`)
          .setLabel("Pick Card")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`draft_pool:${draft.id}`)
          .setLabel("View My Pool")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }

  return { embed, components };
}

const guildSettings = createGuildSettingsService(db);

const broadcaster = createBroadcaster(
  httpTransport({ url: process.env.WS_INTERNAL_URL ?? "", secret: process.env.WS_INTERNAL_SECRET ?? "" }),
);

const notifyDuelChange = createHttpNotifyDuelChange({
  url: process.env.WS_INTERNAL_URL ?? "",
  secret: process.env.WS_INTERNAL_SECRET ?? "",
});

const deps = {
  db,
  matches: createMatchService(db),
  players: createPlayerRepository(db),
  tournaments: createTournamentService(db),
  drafts: createDraftService(db),
  cards: createCardCatalogService(db),
  deleteNotifyMessage: (matchId: number) => deleteNotifyMessage(client, db, matchId),
  announceTournamentCompleted: (tournamentId: number) => announceTournamentCompleted(client, db, guildSettings, tournamentId),
  templates: createCubeService(db, createCardCatalogService(db)),
  draftImages: createDraftImageService({ cacheDir: cardImageCacheDir }),
  guildSettings,
  cleanup,
  broadcaster,
  notifyDuelChange,
  messenger: {
    async postStatus(draft: Draft) {
      const channel = await client.channels.fetch(draft.channelId);

      if (channel?.type !== ChannelType.GuildText) {
        return;
      }

      const { embed, components } = buildDraftStatus(draft);
      const message = await channel.send({ embeds: [embed], components });

      try {
        await message.pin();
      } catch {
        // ignore pin failures
      }

      deps.drafts.setStatusMessageId(draft.id, message.id);
    },

    async updateStatus(draft: Draft) {
      if (!draft.statusMessageId) {
        return;
      }

      const channel = await client.channels.fetch(draft.channelId);

      if (channel?.type !== ChannelType.GuildText) {
        return;
      }

      try {
        const message = await channel.messages.fetch(draft.statusMessageId);
        const { embed, components } = buildDraftStatus(draft);
        await message.edit({ embeds: [embed], components });
      } catch (error) {
        console.warn(`Failed to update draft status message for ${draft.id}`, error);
      }
    },
  } as DraftMessenger,
};

function toCommandInteraction(
  interaction: ChatInputCommandInteraction,
): CommandInteractionLike {
  return {
    commandName: interaction.commandName,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    options: {
      getSubcommand: () => interaction.options.getSubcommand(false) ?? "",
      getSubcommandGroup: () => interaction.options.getSubcommandGroup(false) ?? null,
      getString: (name, required = false) => interaction.options.getString(name, required),
      getRole: (name, required = false) => {
        const role = interaction.options.getRole(name, required);

        return role ? { id: role.id, name: role.name } : null;
      },
      getUser: (name, required = false) => {
        const user = interaction.options.getUser(name, required);

        return user ? { id: user.id, username: user.username, displayName: user.displayName } : null;
      },
      getInteger: (name, required = false) => interaction.options.getInteger(name, required),
    },
    reply: async (message) => {
      await interaction.reply(message);
    },
  };
}

function toButtonInteraction(interaction: ButtonInteraction): ButtonInteractionLike {
  return {
    customId: interaction.customId,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    showModal: async (modal) => {
      await interaction.showModal(modal);
    },
    reply: async (message) => {
      await interaction.reply(message);
    },
  };
}

function toSelectMenuInteraction(interaction: StringSelectMenuInteraction): SelectMenuInteractionLike {
  return {
    customId: interaction.customId,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    values: interaction.values,
    showModal: async (modal) => {
      await interaction.showModal(modal);
    },
    reply: async (message) => {
      await interaction.reply(message);
    },
  };
}

function toModalInteraction(interaction: ModalSubmitInteraction): ModalInteractionLike {
  return {
    customId: interaction.customId,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    fields: {
      getTextInputValue: (name) => interaction.fields.getTextInputValue(name),
    },
    reply: async (message) => {
      await interaction.reply(message);
    },
  };
}

function toAutocompleteInteraction(
  interaction: AutocompleteInteraction,
): AutocompleteInteractionLike {
  const focused = interaction.options.getFocused(true);

  return {
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    options: {
      getSubcommand: () => interaction.options.getSubcommand(false) ?? "",
      getSubcommandGroup: () => interaction.options.getSubcommandGroup(false) ?? null,
      getFocused: () => ({ name: focused.name, value: String(focused.value) }),
    },
    respond: async (choices) => {
      await interaction.respond(choices);
    },
  };
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag ?? "unknown bot"}`);

  const notifyCleanup = createNotifyCleanupService({
    db,
    ttlMinutes: Number(process.env.NOTIFY_MESSAGE_TTL_MINUTES ?? 720),
    deleteNotifyMessage: (matchId: number) => deleteNotifyMessage(client, db, matchId),
  });
  notifyCleanup.start();

  const announceSecret = process.env.BOT_ANNOUNCE_SECRET ?? "";
  const announcePort = Number(process.env.BOT_ANNOUNCE_PORT ?? 4001);
  if (announceSecret) {
    const announceServer = createAnnounceServer({
      secret: announceSecret,
      handlers: createAnnounceHandlers({ client, db, drafts: deps.drafts, messenger: deps.messenger, guildSettings: deps.guildSettings }),
    });
    announceServer.listen(announcePort);
  } else {
    console.log("[announce] BOT_ANNOUNCE_SECRET not set; announce HTTP server disabled");
  }

  const reminderChannelId = process.env.DISCORD_REMINDER_CHANNEL_ID;
  const reminderCron = process.env.REMINDER_CRON ?? "0 10 * * *";
  const reminderTimezone = process.env.REMINDER_TIMEZONE ?? "UTC";

  if (!reminderChannelId) {
    console.log("DISCORD_REMINDER_CHANNEL_ID is not set; tournament reminders are disabled");
    return;
  }

  cron.schedule(
    reminderCron,
    async () => {
      const channel = await client.channels.fetch(reminderChannelId);

      if (channel?.type !== ChannelType.GuildText) {
        return;
      }

      const reminder = formatTournamentReminder(
        selectTournamentReminderTargets(db, channel.guildId),
      );

      if (!reminder) {
        return;
      }

      await channel.send(reminder);
    },
    { timezone: reminderTimezone },
  );
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      await handleButton(toButtonInteraction(interaction), deps);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(toSelectMenuInteraction(interaction), deps);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(toModalInteraction(interaction), deps);
      return;
    }

    if (interaction.isAutocomplete()) {
      await handleAutocomplete(toAutocompleteInteraction(interaction), deps);
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    await handleCommand(toCommandInteraction(interaction), deps);
  } catch (error) {
    await reportInteractionError(interaction, error);
  }
});

await client.login(token);
