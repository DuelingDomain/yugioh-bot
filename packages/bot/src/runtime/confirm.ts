import { randomBytes } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Access, InteractionLike, FeatureContext } from "./types.js";
import { mayUse } from "./guard.js";

interface Pending { actorId: string; guildId: string; expires: number; access: Access; execute(): Promise<void> }
export class ConfirmationStore {
  private pending = new Map<string, Pending>();
  async request(interaction: InteractionLike, options: { summary: string; access: Access; execute(): Promise<void> }): Promise<void> {
    for (const [id, entry] of this.pending) if (entry.expires <= Date.now()) this.pending.delete(id);
    if (!interaction.guildId || this.pending.size >= 1000) throw new Error("Confirmation is unavailable");
    const nonce = randomBytes(16).toString("hex");
    this.pending.set(nonce, { actorId: interaction.user.id, guildId: interaction.guildId, expires: Date.now() + 60_000, access: options.access, execute: options.execute });
    await interaction.reply({ content: options.summary, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`confirm:yes:${nonce}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`confirm:no:${nonce}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    )] });
  }
  async handle(customId: string, interaction: InteractionLike, context: FeatureContext): Promise<void> {
    const [, decision, nonce] = customId.split(":");
    const entry = this.pending.get(nonce);
    if (!entry || entry.expires <= Date.now()) {
      this.pending.delete(nonce);
      await interaction.reply({ content: "This confirmation has expired.", components: [] }); return;
    }
    if (entry.actorId !== interaction.user.id || entry.guildId !== interaction.guildId) {
      await interaction.reply({ content: "Only the member who requested this action can confirm it." }); return;
    }
    // Claim before awaiting authorization to prevent concurrent button presses.
    this.pending.delete(nonce);
    if (decision !== "yes") { await interaction.reply({ content: "Cancelled.", components: [] }); return; }
    if (!await mayUse(entry.access, interaction.user.id, context)) {
      await context.audit({ actorDiscordId: interaction.user.id, action: "confirmation", result: "denied" });
      await interaction.reply({ content: "You do not have access to this action.", components: [] }); return;
    }
    const ran = await context.cooldown.run(entry.guildId, entry.actorId, entry.execute);
    await interaction.reply({ content: ran ? "Action complete." : "Wait three seconds and request the action again.", components: [] });
  }
  clear() { this.pending.clear(); }
}
