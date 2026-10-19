import { PermissionFlagsBits as P, Routes } from "discord.js";
import type { CommandInteractionLike as Command, FeatureContext } from "../../runtime/types.js";
import { botPermissions, checkRole, getChannels, needBot, privateOverwrites, Refusal, state, type Action, type GuildChannel, type Overwrite } from "./common.js";

export async function setupAction(i: Command, c: FeatureContext): Promise<Action> {
  if (i.options.getSubcommand() !== "channels") throw new Refusal("Choose setup channels.");
  const action: Action = { action: "setup.channels", params: {},
    summary: "Create or reuse Admin, signups, mod-log, online-now, and announcements by name? This repairs their parent and permission overwrites. Signups and online-now are admin-only. Moderator can view mod-log. Announcements are public and read-only.",
    async run() {
      const s = await state(i, c);
      needBot(s, P.ManageChannels | P.ManageRoles | P.ViewChannel | P.SendMessages | P.SendMessagesInThreads | P.EmbedLinks | P.AttachFiles | P.ReadMessageHistory);
      const threadCreation = P.CreatePublicThreads | P.CreatePrivateThreads;
      const unsupportedThreads = threadCreation & ~botPermissions(s);
      const unsafeRoles = s.roles.filter(role => !(BigInt(role.permissions) & P.Administrator)
        && (BigInt(role.permissions) & unsupportedThreads));
      if (unsafeRoles.length) throw new Refusal(`The bot cannot deny thread creation granted by roles: ${unsafeRoles.slice(0, 12).map(role => role.id).join(", ")}${unsafeRoles.length > 12 ? ` and ${unsafeRoles.length - 12} other roles` : ""}. Remove those thread creation grants before setup so announcements can be read-only.`);
      const all = await getChannels(c);
      const names: [string, number][] = [["Admin", 4], ["signups", 0], ["mod-log", 0], ["online-now", 0], ["announcements", 0]];
      // Validate the whole layout before any write; ambiguous names must not pick a random channel.
      for (const [name, type] of names) {
        const matches = all.filter(ch => ch.name.toLowerCase() === name.toLowerCase());
        if (matches.length > 1) throw new Refusal(`More than one channel is named ${name}. Rename the extra channels, then try again.`);
        if (matches.length && matches[0].type !== type && !(name === "announcements" && matches[0].type === 5))
          throw new Refusal(`The existing ${name} channel has the wrong type. Rename it, then try again.`);
        if (matches[0]) needBot(s, P.ManageChannels | P.ManageRoles, matches[0]);
      }
      const moderator = c.config.moderatorRoleId ? checkRole(s, c.config.moderatorRoleId) : s.roles.find(r => r.name === "Moderator");
      if (moderator) checkRole(s, moderator.id);
      const privateRules = await privateOverwrites(c);
      const created: string[] = [], reused: string[] = [];
      action.params = { created, reused };
      const save = async (name: string, type: number, parent: string | null, overwrites: Overwrite[]) => {
        const existing = all.find(ch => ch.name.toLowerCase() === name.toLowerCase());
        const body = { name, ...(type === 4 ? {} : { parent_id: parent }), permission_overwrites: overwrites };
        if (existing) {
          const sameRules = (value: Overwrite[]) => JSON.stringify([...value].sort((a, b) => a.id.localeCompare(b.id))
            .map(({ id, type, allow, deny }) => ({ id, type, allow, deny })));
          if (existing.name !== name || (type !== 4 && (existing.parent_id ?? null) !== parent)
            || sameRules(existing.permission_overwrites ?? []) !== sameRules(overwrites))
            await c.rest.patch(Routes.channel(existing.id), { body });
          reused.push(existing.id); return existing;
        }
        const channel = await c.rest.post(Routes.guildChannels(c.config.guildId), { body: { ...body, type } }) as GuildChannel;
        all.push(channel); created.push(channel.id); return channel;
      };
      const category = await save("Admin", 4, null, privateRules);
      const signups = await save("signups", 0, category.id, privateRules);
      const modlog = await save("mod-log", 0, category.id, [...privateRules,
        ...(moderator ? [{ id: moderator.id, type: 0, allow: P.ViewChannel.toString(), deny: "0" }] : [])]);
      action.modLogChannelId = modlog.id;
      const online = await save("online-now", 0, category.id, privateRules);
      const read = P.ViewChannel | P.ReadMessageHistory;
      // The approved bot invite has no thread creation permissions. Deny message
      // posting in both channels and threads, and thread creation when held.
      const write = P.SendMessages | P.SendMessagesInThreads
        | (botPermissions(s) & threadCreation);
      const announceRules: Overwrite[] = [{ id: s.guildId, type: 0, allow: read.toString(), deny: write.toString() },
        ...privateRules.filter(o => o.type === 1).map(o => ({ ...o, allow: (read | P.SendMessages | P.EmbedLinks | P.AttachFiles).toString(), deny: "0" }))];
      const announcements = await save("announcements", 0, null, announceRules);
      action.params = { categoryId: category.id, created, reused, moderatorRoleId: moderator?.id ?? null,
        waitlistChannelId: signups.id, modLogChannelId: modlog.id, statusChannelId: online.id, announceChannelId: announcements.id };
      return { content: `Admin category: ${category.id}\n#signups: ${signups.id}\n#mod-log: ${modlog.id}\n#online-now: ${online.id}\n#announcements: ${announcements.id}\n\nSet these environment values and restart the bot:\n\`\`\`env\nDISCORD_WAITLIST_CHANNEL_ID=${signups.id}\nDISCORD_MOD_LOG_CHANNEL_ID=${modlog.id}\nDISCORD_STATUS_CHANNEL_ID=${online.id}\nDISCORD_ANNOUNCE_CHANNEL_ID=${announcements.id}${moderator ? `\nDISCORD_MODERATOR_ROLE_ID=${moderator.id}` : ""}\n\`\`\`${moderator ? "" : "\nModerator role was not found. Create it, set DISCORD_MODERATOR_ROLE_ID, and run setup again."}`,
        components: [] };
    } };
  return action;
}
