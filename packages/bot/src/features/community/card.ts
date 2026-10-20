import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { PROJECT_IGNIS_IMAGE_URL } from "@yugidraft/shared/services";
import type { CommandModule } from "../../runtime/types.js";
import { cardReader, type CardRecord } from "./card-data.js";
import { PURPLE, GOLD, NO_MENTIONS, clip } from "./common.js";

type Banlist = { id: string; limits: Record<number, number> };
async function loadBanlist(): Promise<Banlist | null> {
  try {
    const root = dirname(createRequire(import.meta.url).resolve("@yugidraft/duel-server/package.json"));
    // Only this pure module and its compiled data are loaded. The bot Docker image omits this optional package.
    for (const file of ["dist/banlists/index.js", "src/banlists/index.ts"]) {
      try {
        const module = await import(pathToFileURL(join(root, file)).href);
        const id = Object.entries(module).filter(([key, value]) => /^BANLIST_TCG_.*_ID$/.test(key) && typeof value === "string")
          .map(([, value]) => value as string).sort().at(-1);
        if (id && typeof module.banlistLimitsFor === "function") return { id, limits: module.banlistLimitsFor(id) };
      } catch { /* Try source under TS-aware tools, then report unavailability. */ }
    }
  } catch { /* The lean bot image has no duel-server package. */ }
  return null;
}

function cardEmbed(card: CardRecord, banlist: Banlist | null, canonicalId: number) {
  const link = /link/i.test(card.type), monster = /monster/i.test(card.type);
  const stat = (value: number | null) => value === null || value < 0 ? "?" : String(value);
  const typeLine = [card.race, card.type, card.attribute].filter(Boolean).join(" / ");
  const stats = monster ? `ATK/${stat(card.atk)} • ${link ? `LINK-${stat(card.level)}` : `DEF/${stat(card.def)}`}` : "";
  const embed = new EmbedBuilder().setTitle(clip(card.name, 256)).setColor(card.prerelease ? GOLD : PURPLE)
    .setDescription(clip([card.prerelease ? "**Pre-release**" : "", typeLine, stats, "", card.text || "Card text not available."].filter((line, i) => line || i === 3).join("\n"), 4096))
    .setImage(`${card.prerelease || card.engineOnly ? PROJECT_IGNIS_IMAGE_URL : "https://images.ygoprodeck.com/images/cards"}/${card.id}.jpg`)
    .setFooter({ text: banlist ? `Dueling Domain • ${card.id} • ${banlist.id}` : `Dueling Domain • ${card.id} • TCG status unavailable (ban list module not installed).` });
  if (banlist) embed.addFields({ name: "TCG ban status", value: card.prerelease ? "Pre-release (not yet released)"
    : ({ 0: "Forbidden", 1: "Limited", 2: "Semi-limited" } as Record<number, string>)[banlist.limits[canonicalId]] ?? "Unlimited", inline: true });
  return embed;
}

export function cardHandler() {
  const reader = cardReader();
  const requests = new Map<string, number[]>(), completions = new Map<string, number[]>();
  let banlist: Promise<Banlist | null> | undefined;
  const take = (store: Map<string, number[]>, user: string, maximum: number): boolean => {
    const now = Date.now();
    for (const [id, times] of store) if (!times.some(time => time > now - 30_000)) store.delete(id);
    const recent = (store.get(user) ?? []).filter(time => time > now - 30_000);
    if (recent.length >= maximum || (!store.has(user) && store.size >= 10_000)) return false;
    recent.push(now); store.set(user, recent); return true;
  };
  const command: CommandModule = {
    data: new SlashCommandBuilder().setName("card").setDescription("Find a card, including pre-release cards")
      .addStringOption(option => option.setName("name").setDescription("Card name or passcode").setRequired(true).setAutocomplete(true).setMaxLength(100)),
    access: "public", acknowledgement: "manual",
    async autocomplete(interaction, context) {
      if (interaction.guildId !== context.config.guildId || interaction.options.getFocused().name !== "name" || !take(completions, interaction.user.id, 30)) {
        await interaction.respond([]); return;
      }
      try {
        const cards = reader.search(context.db, interaction.options.getFocused().value).slice(0,25);
        await interaction.respond(cards.map(card => ({ name: `${clip(card.name, card.prerelease ? 86 : 100)}${card.prerelease ? " — Pre-release" : ""}`, value: String(card.id) })));
      } catch { await interaction.respond([]); }
    },
    async execute(interaction, context) {
      if (interaction.guildId !== context.config.guildId) { await interaction.reply({ content: "Use this command in the configured server.", flags: MessageFlags.Ephemeral }); return; }
      if (!take(requests, interaction.user.id, 5)) { await interaction.reply({ content: "Use /card at most 5 times per 30 seconds. Wait and try again.", flags: MessageFlags.Ephemeral }); return; }
      try {
        const query = interaction.options.getString("name", true)!.trim();
        const candidates = query ? reader.search(context.db, query) : [];
        const card = candidates.find(card => String(card.id) === query || card.name.toLowerCase() === query.toLowerCase());
        if (!card) { await interaction.reply({ content: "Card not found. Select a card from the name list.", flags: MessageFlags.Ephemeral }); return; }
        await interaction.reply({ embeds: [cardEmbed(card, await (banlist ??= loadBanlist()), reader.canonicalId(context.db, card))], flags: [], allowedMentions: NO_MENTIONS });
      } catch { await interaction.reply({ content: "Card data could not be read. Try again later.", flags: MessageFlags.Ephemeral }); }
    },
  };
  return { command, stop: () => { reader.clear(); requests.clear(); completions.clear(); banlist = undefined; } };
}
