import { AttachmentBuilder, Events, PermissionFlagsBits, Routes, SlashCommandBuilder, type GuildMember, type PartialGuildMember } from "discord.js";
import { report } from "@yugidraft/shared/observability";
import type { CommandModule, FeatureContext } from "../../runtime/types.js";
import { renderWelcomeCard } from "./welcome-card.js";
import { NO_MENTIONS } from "./common.js";

function memberNumber(c: FeatureContext, userId: string, assign: boolean): number {
  const lookup = () => (c.db.prepare("select number from discord_welcome_members where guild_id=? and discord_user_id=?")
    .get(c.config.guildId, userId) as { number: number } | undefined)?.number;
  const next = () => (c.db.prepare("select coalesce(max(number),0)+1 as number from discord_welcome_members where guild_id=?")
    .get(c.config.guildId) as { number: number }).number;
  // Preview may display the next number but never consumes it.
  if (!assign) return lookup() ?? next();
  return c.db.transaction(() => {
    const existing = lookup();
    if (existing !== undefined) return existing;
    const number = next();
    c.db.prepare("insert into discord_welcome_members(guild_id,discord_user_id,number) values(?,?,?)")
      .run(c.config.guildId, userId, number);
    return number;
  }).immediate();
}

async function card(c: FeatureContext, member: GuildMember, assign: boolean) {
  const number = memberNumber(c, member.id, assign);
  try {
    return await renderWelcomeCard({ displayName: member.displayName, number,
      avatarUrl: member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }), signal: c.signal });
  } catch (error) {
    if (!c.signal.aborted) report(error, { tags: { operation: "bot.welcome.render" } });
    return undefined;
  }
}

export function startWelcome(c: FeatureContext) {
  if (!c.config.welcomeChannelId) return;
  const channelId = c.config.welcomeChannelId;
  const maxPending = 20, maxAge = 2 * 60_000, cooldown = 24 * 60 * 60_000;
  let pending = Promise.resolve();
  let queued = 0, destinationValidUntil = 0;
  const onJoin = (member: GuildMember) => {
    if (c.signal.aborted || member.guild.id !== c.config.guildId || member.user.bot || member.pending || queued >= maxPending) return;
    const queuedAt = Date.now();
    queued++;
    pending = pending.then(async () => {
      if (c.signal.aborted || Date.now() - queuedAt > maxAge) return;
      const previous = c.db.prepare("select last_welcomed_at from discord_welcome_members where guild_id=? and discord_user_id=?")
        .get(c.config.guildId, member.id) as { last_welcomed_at: number | null } | undefined;
      if (previous?.last_welcomed_at != null && Date.now() - previous.last_welcomed_at < cooldown) return;
      if (Date.now() >= destinationValidUntil) {
        const destination = await c.rest.get(Routes.channel(channelId), { signal: c.signal }) as { guild_id?: string; type: number };
        if (destination.guild_id !== c.config.guildId || ![0, 5].includes(destination.type)) {
          throw new Error("Welcome destination must be a text or announcement channel in the bot guild");
        }
        destinationValidUntil = Date.now() + 60_000;
      }
      if (c.signal.aborted || Date.now() - queuedAt > maxAge) return;
      const png = await card(c, member, true);
      if (c.signal.aborted) return;
      await c.rest.post(Routes.channelMessages(channelId), {
        signal: c.signal,
        body: { content: `Hey <@${member.id}>, welcome to **Dueling Domain**!`,
          allowed_mentions: { parse: [], users: [member.id], roles: [], replied_user: false } },
        ...(png ? { files: [{ data: png, name: "welcome.png", contentType: "image/png" }] } : {}),
      });
      c.db.prepare("update discord_welcome_members set last_welcomed_at=? where guild_id=? and discord_user_id=?")
        .run(Date.now(), c.config.guildId, member.id);
    }).catch(error => { if (!c.signal.aborted) report(error, { tags: { operation: "bot.welcome.join" } }); })
      .finally(() => { queued--; });
  };
  const onUpdate = (previous: GuildMember | PartialGuildMember, member: GuildMember) => {
    if (previous.pending === true && member.pending === false) onJoin(member);
  };
  c.client.on(Events.GuildMemberAdd, onJoin);
  c.client.on(Events.GuildMemberUpdate, onUpdate);
  return async () => {
    c.client.off(Events.GuildMemberAdd, onJoin);
    c.client.off(Events.GuildMemberUpdate, onUpdate);
    await pending;
  };
}

export const welcomePreview: CommandModule = {
  data: new SlashCommandBuilder().setName("welcome").setDescription("Preview the Dueling Domain welcome card")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName("preview").setDescription("Privately preview a member's welcome card")
      .addUserOption(option => option.setName("member").setDescription("Member to preview (defaults to you)"))),
  access: "admin",
  async execute(i, c) {
    const id = i.options.getUser("member")?.id ?? i.user.id;
    const guild = await c.client.guilds.fetch(c.config.guildId);
    const member = await guild.members.fetch(id);
    const png = await card(c, member, false);
    await i.reply({ content: png ? "Welcome card preview. New members' numbers are assigned when they join." : "The welcome card could not be rendered. Join greetings will still post.",
      allowedMentions: NO_MENTIONS,
      ...(png ? { files: [new AttachmentBuilder(png, { name: "welcome.png" })] } : {}) });
  },
};
