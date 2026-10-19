import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, TextDisplayBuilder } from "discord.js";
import { ClerkBackendError, type ClerkBackend } from "@yugidraft/shared/clerk";
import { adminAccess } from "@yugidraft/shared/discord-admin";
import { decideWaitlistEntry, getWaitlistAction, prepareWaitlistAction, WaitlistDecisionError,
  type WaitlistAction, type WaitlistDecision } from "@yugidraft/shared/services/waitlist-decisions";
import type { FeatureContext, FeatureModule, InteractionLike } from "../../runtime/types.js";
import { clerkBackend, findEntry, WaitlistInputError } from "./clerk.js";
import { decisionText, discordTime, emailHash, emailText, noMentions, safeText } from "./presentation.js";
import { installWaitlistOutbox } from "./outbox.js";

function errorText(error: unknown): string {
  if (error instanceof WaitlistInputError) return error.message;
  if (error instanceof WaitlistDecisionError && error.code === "admin_required") return "You do not have access to this action.";
  if (error instanceof ClerkBackendError && error.status === 404) return "The Clerk entry was not found. Refresh the waitlist.";
  if (error instanceof ClerkBackendError && error.status === 429) return "Clerk is busy. Try again in a minute.";
  return "The waitlist action could not be completed. The buttons are still available. Try again later.";
}

async function requireAdmin(interaction: InteractionLike, context: FeatureContext): Promise<boolean> {
  if (interaction.guildId === context.config.guildId && adminAccess(context.db, interaction.user.id).isAdmin) return true;
  await context.audit({ actorDiscordId: interaction.user.id, action: "waitlist.access", result: "denied" });
  await interaction.reply({ content: "You do not have access to this action.", allowedMentions: noMentions });
  return false;
}

async function decide(interaction: InteractionLike, context: FeatureContext, action: WaitlistAction, decision: WaitlistDecision, backend: () => ClerkBackend) {
  if (!action.clerk_entry_id) throw new WaitlistInputError("This entry is waiting for Clerk. Refresh the waitlist shortly.");
  const result = await decideWaitlistEntry(context.db, { clerkEntryId: action.clerk_entry_id, decision,
    actor: { discordUserId: interaction.user.id }, source: "discord" }, backend());
  const content = result.status === "in_progress" ? "An admin is processing this entry. Try again shortly."
    : result.status === "conflict" ? `The ${result.action.decision === "approve" ? "approve" : "reject"} decision is already reserved. Retry that decision.`
    : `${result.status === "already_decided" ? "Already decided: " : ""}${decisionText(result.action)}`;
  await interaction.reply({ content, allowedMentions: noMentions });
}

async function listPage(interaction: InteractionLike, context: FeatureContext, requestedPage: number, backend: () => ClerkBackend) {
  const clerk = backend();
  let pageNumber = Math.max(1, Math.min(100_000, Math.trunc(requestedPage)));
  let page = await clerk.listWaitlistEntries({ status: "pending", orderBy: "+created_at", limit: 10, offset: (pageNumber - 1) * 10 });
  const pages = Math.max(1, Math.ceil(page.totalCount / 10));
  if (pageNumber > pages) {
    pageNumber = pages;
    page = await clerk.listWaitlistEntries({ status: "pending", orderBy: "+created_at", limit: 10, offset: (pageNumber - 1) * 10 });
  }
  const entries = page.data.filter(entry => entry.status === "pending").slice(0, 10);
  const lines = entries.map((entry, index) => `${(pageNumber - 1) * 10 + index + 1}. ${emailText(entry.email_address, 180)} · ${safeText(entry.id, 80)}${entry.created_at ? ` · ${discordTime(entry.created_at)}` : ""}`);
  const text = new TextDisplayBuilder().setContent(`**Pending waitlist: ${page.totalCount} · Page ${pageNumber}/${pages}**\n${lines.join("\n") || "No pending entries."}`);
  const rows = entries.map((entry, index) => {
    const action = prepareWaitlistAction(context.db, { clerkEntryId: entry.id, email: entry.email_address });
    const position = (pageNumber - 1) * 10 + index + 1;
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`wl:approve:${action.id}`).setLabel(`Approve #${position}`).setStyle(ButtonStyle.Success).setDisabled(action.completed_at !== null),
      new ButtonBuilder().setCustomId(`wl:reject:${action.id}`).setLabel(`Reject #${position}`).setStyle(ButtonStyle.Danger).setDisabled(action.completed_at !== null));
  });
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`wlp:previous:${Math.max(1, pageNumber - 1)}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(pageNumber <= 1),
    new ButtonBuilder().setCustomId(`wlp:refresh:${pageNumber}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`wlp:next:${pageNumber + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(pageNumber >= pages));
  // Components V2 supports ten per-entry action rows within its 40 component cap.
  await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [text, ...rows, navigation], allowedMentions: noMentions });
}

/** Backend injection changes only the network edge; handlers always use shared SQLite services. */
export function createWaitlistFeature(options: { backend?: ClerkBackend } = {}): FeatureModule {
  const backend = () => options.backend ?? clerkBackend();
  return {
    commands: [{ access: "admin", data: new SlashCommandBuilder().setName("waitlist").setDescription("List the pending waitlist or decide an entry")
      .addStringOption(option => option.setName("action").setDescription("List (default), approve or reject")
        .addChoices({ name: "list", value: "list" }, { name: "approve", value: "approve" }, { name: "reject", value: "reject" }))
      .addStringOption(option => option.setName("entry").setDescription("Exact email address or Clerk entry ID").setMaxLength(320))
      .addIntegerOption(option => option.setName("page").setDescription("Pending list page, 10 entries per page").setMinValue(1).setMaxValue(100_000)),
      async execute(interaction, context) {
        if (!await requireAdmin(interaction, context)) return;
        try {
          const action = interaction.options.getString("action") ?? "list";
          if (action === "list") { await listPage(interaction, context, interaction.options.getInteger("page") ?? 1, backend); return; }
          if (action !== "approve" && action !== "reject") throw new WaitlistInputError("Choose list, approve or reject.");
          const reference = interaction.options.getString("entry")?.trim();
          if (!reference) throw new WaitlistInputError("Supply an exact email address or Clerk entry ID.");
          let row = context.db.prepare<[string, string, string], WaitlistAction>("select * from discord_waitlist_actions where id=? or clerk_entry_id=? or subject_hash=?")
            .get(reference, reference, emailHash(reference));
          if (!row) {
            const entry = await findEntry(backend(), reference);
            if (!entry) throw new WaitlistInputError("No exact entry was found. Use its full email address or Clerk entry ID.");
            row = prepareWaitlistAction(context.db, { email: entry.email_address, clerkEntryId: entry.id });
          }
          await decide(interaction, context, row, action, backend);
        } catch (error) { await interaction.reply({ content: errorText(error), allowedMentions: noMentions }); }
      } }],
    buttons: [{ prefix: "wl:", access: "admin",
      async execute(interaction, context) {
        if (!await requireAdmin(interaction, context)) return;
        try {
          const match = /^wl:(approve|reject):([A-Za-z0-9_-]{1,80})$/.exec(interaction.customId);
          const action = match ? getWaitlistAction(context.db, match[2]) : null;
          if (!match || !action) throw new WaitlistInputError("This waitlist entry is no longer available. Refresh the list.");
          await decide(interaction, context, action, match[1] as WaitlistDecision, backend);
        } catch (error) { await interaction.reply({ content: errorText(error), allowedMentions: noMentions }); }
      } }, { prefix: "wlp:", access: "admin",
      async execute(interaction, context) {
        if (!await requireAdmin(interaction, context)) return;
        try {
          const match = /^wlp:(?:previous|refresh|next):([1-9]\d{0,5})$/.exec(interaction.customId);
          if (!match) throw new WaitlistInputError("This page is not available. Run /waitlist again.");
          await listPage(interaction, context, Number(match[1]), backend);
        } catch (error) { await interaction.reply({ content: errorText(error), allowedMentions: noMentions }); }
      } }],
    modals: [], start: context => installWaitlistOutbox(context, backend),
  };
}
export const waitlist = createWaitlistFeature();
