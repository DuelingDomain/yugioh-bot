import { PermissionFlagsBits as P, Routes } from "discord.js";
import type { CommandInteractionLike as Command, FeatureContext } from "../../runtime/types.js";
import { channelTypes } from "./definitions.js";
import { checkRole, getChannel, getChannels, needBot, privateOverwrites, protectedChannel,
  Refusal, requiredId, state, validName, type Action, type GuildChannel } from "./common.js";

function details(i: Command) {
  const body: Record<string, unknown> = {};
  const name = i.options.getString("name"); if (name !== null) body.name = validName(name);
  const topic = i.options.getString("topic"); if (topic !== null) { if (topic.length > 1024) throw new Refusal("The topic can have at most 1024 characters."); body.topic = topic; }
  const slow = i.options.getInteger("slowmode");
  if (slow !== null) {
    if (!Number.isInteger(slow) || slow < 0 || slow > 21600) throw new Refusal("Slowmode must be from 0 to 21600 seconds.");
    body.rate_limit_per_user = slow;
  }
  return body;
}
function compatible(body: Record<string, unknown>, type: number) {
  if (body.topic !== undefined && ![0, 5, 15].includes(type)) throw new Refusal("Topics are supported only for text, announcement, and forum channels.");
  if (body.nsfw !== undefined && ![0, 2, 5, 13, 15].includes(type)) throw new Refusal("This channel does not support NSFW settings.");
}
function roleIds(value: string | null) {
  if (!value) return [];
  const parts = value.trim().split(/[\s,]+/).map(token => /^<@&(\d{17,20})>$/.exec(token)?.[1] ?? token);
  if (parts.length > 20 || parts.some(id => !/^\d{17,20}$/.test(id))) throw new Refusal("Supply at most 20 valid role IDs or role mentions.");
  return [...new Set(parts)];
}

export async function channelAction(i: Command, c: FeatureContext): Promise<Action> {
  const sub = i.options.getSubcommand();
  if (sub === "create") {
    const name = validName(i.options.getString("name", true));
    const kind = i.options.getString("type", true) as keyof typeof channelTypes;
    const type = channelTypes[kind]; if (type === undefined) throw new Refusal("Choose a supported channel type.");
    const body = { ...details(i), name, type } as Record<string, unknown>;
    const categoryId = i.options.getChannel("category")?.id;
    const privateChannel = i.options.getBoolean("private") === true;
    const roles = roleIds(i.options.getString("roles"));
    if (roles.length && !privateChannel) throw new Refusal("Set private to true when you choose visible roles.");
    compatible(body, type);
    return { action: "channel.create", params: { name, type, categoryId, private: privateChannel, roles }, async run() {
      const s = await state(i, c); needBot(s, P.ManageChannels);
      if (categoryId) { await getChannel(c, categoryId, [4]); body.parent_id = categoryId; }
      if (privateChannel) {
        needBot(s, P.ManageRoles | P.ViewChannel);
        for (const role of roles) checkRole(s, role);
        body.permission_overwrites = [...await privateOverwrites(c),
          ...roles.map(id => ({ id, type: 0, allow: P.ViewChannel.toString(), deny: "0" }))];
      }
      const result = await c.rest.post(Routes.guildChannels(s.guildId), { body }) as GuildChannel;
      return `Created channel ${result.id} (${name}).`;
    } };
  }
  const id = requiredId(i.options.getChannel("channel", true));
  const target = await getChannel(c, id, Object.values(channelTypes));
  if (sub === "delete") {
    protectedChannel(c, id);
    return { action: "channel.delete", targetId: id, summary: `Delete channel ${target.name} (${id})?`, async run() {
      protectedChannel(c, id);
      const ch = await getChannel(c, id, Object.values(channelTypes)); const s = await state(i, c);
      needBot(s, P.ManageChannels, ch);
      await c.rest.delete(Routes.channel(id)); return `Deleted channel ${id}.`;
    } };
  }
  if (sub !== "edit") throw new Refusal("Choose a supported channel action.");
  const body = details(i);
  const categoryId = i.options.getChannel("category")?.id;
  const root = i.options.getBoolean("uncategorized") === true;
  if (root && categoryId) throw new Refusal("Choose a category or uncategorized, not both.");
  if (categoryId) body.parent_id = categoryId;
  if (root) body.parent_id = null;
  const nsfw = i.options.getBoolean("nsfw"); if (nsfw !== null) body.nsfw = nsfw;
  const position = i.options.getInteger("position");
  if (position !== null) {
    if (!Number.isInteger(position) || position < 0 || position > 499) throw new Refusal("Position must be from 0 to 499.");
    body.position = position;
  }
  if (!Object.keys(body).length) throw new Refusal("Choose at least one channel setting to change.");
  return { action: "channel.edit", targetId: id, params: body, async run() {
    const ch = await getChannel(c, id, Object.values(channelTypes)); const s = await state(i, c);
    needBot(s, P.ManageChannels, ch); compatible(body, ch.type);
    if (categoryId) await getChannel(c, categoryId, [4]);
    await c.rest.patch(Routes.channel(id), { body }); return `Updated channel ${id}.`;
  } };
}

export async function categoryAction(i: Command, c: FeatureContext): Promise<Action> {
  const sub = i.options.getSubcommand();
  if (sub === "create") {
    const name = validName(i.options.getString("name", true));
    return { action: "category.create", params: { name }, async run() {
      const s = await state(i, c); needBot(s, P.ManageChannels);
      const ch = await c.rest.post(Routes.guildChannels(s.guildId), { body: { name, type: 4 } }) as GuildChannel;
      return `Created category ${ch.id} (${name}).`;
    } };
  }
  const id = requiredId(i.options.getChannel("category", true));
  const ch = await getChannel(c, id, [4]);
  if (sub === "rename") {
    const name = validName(i.options.getString("name", true));
    return { action: "category.rename", targetId: id, params: { name }, async run() {
      const target = await getChannel(c, id, [4]); const s = await state(i, c); needBot(s, P.ManageChannels, target);
      await c.rest.patch(Routes.channel(id), { body: { name } }); return `Renamed category ${id} to ${name}.`;
    } };
  }
  if (sub !== "delete") throw new Refusal("Choose a supported category action.");
  protectedChannel(c, id);
  const destination = i.options.getChannel("move-to")?.id;
  const root = i.options.getBoolean("move-to-root") === true;
  if (destination === id || (destination && root)) throw new Refusal("Choose a different category or move-to-root.");
  if (destination) await getChannel(c, destination, [4]);
  const children = (await getChannels(c)).filter(child => child.parent_id === id);
  if (children.length && !destination && !root) throw new Refusal("This category is not empty. Choose move-to or move-to-root, then confirm.");
  const childIds = children.map(child => child.id).sort();
  return { action: "category.delete", targetId: id, params: { childIds, destination: destination ?? null },
    summary: `Delete category ${ch.name} (${id})?${children.length ? ` Move ${children.length} children to ${destination ?? "the server root"}, with their current permissions.` : " It is empty."}`,
    async run() {
      protectedChannel(c, id);
      const current = await getChannel(c, id, [4]); const s = await state(i, c); needBot(s, P.ManageChannels, current);
      if (destination) { const dest = await getChannel(c, destination, [4]); needBot(s, P.ManageChannels, dest); }
      const live = (await getChannels(c)).filter(child => child.parent_id === id);
      if (JSON.stringify(live.map(child => child.id).sort()) !== JSON.stringify(childIds))
        throw new Refusal("The category children changed. Run the command again.");
      for (const child of live) needBot(s, P.ManageChannels, child);
      // Modify Channel preserves overwrites when changing parent_id. Its body does
      // not support lock_permissions (that belongs to the guild positions route).
      for (const child of live) await c.rest.patch(Routes.channel(child.id), { body: { parent_id: destination ?? null } });
      if ((await getChannels(c)).some(child => child.parent_id === id)) throw new Refusal("The category is no longer empty. Run the command again.");
      await c.rest.delete(Routes.channel(id)); return `Deleted category ${id}. Moved ${live.length} children.`;
    } };
}
