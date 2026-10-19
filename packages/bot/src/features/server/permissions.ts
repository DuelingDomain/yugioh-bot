import { AttachmentBuilder, PermissionFlagsBits as P, PermissionsBitField, Routes } from "discord.js";
import type { CommandInteractionLike as Command, FeatureContext } from "../../runtime/types.js";
import { commonPermissions } from "./definitions.js";
import { botPermissions, checkMember, checkRole, getChannel, needBot, Refusal, requiredId, state, type Action } from "./common.js";

function listBits(value: string) {
  const bits = BigInt(value);
  const names = new PermissionsBitField(bits).toArray();
  const unknown = bits & ~PermissionsBitField.All;
  return `${names.join(", ") || "none"}${unknown ? `; other bits ${unknown}` : ""} (${value})`;
}
export async function permissionsAction(i: Command, c: FeatureContext): Promise<Action> {
  const id = requiredId(i.options.getChannel("channel", true));
  const channel = await getChannel(c, id);
  const sub = i.options.getSubcommand();
  if (sub === "view") return { action: "permissions.view", targetId: id, async run() {
    const s = await state(i, c); const ch = await getChannel(c, id); needBot(s, P.ViewChannel, ch);
    const lines = (ch.permission_overwrites ?? []).map(o => `${o.type === 0 ? "Role" : "Member"} ${o.id}\n  Allow: ${listBits(o.allow)}\n  Deny: ${listBits(o.deny)}`);
    const text = `Permission overwrites for ${ch.name} (${id})\n${lines.join("\n") || "No explicit overwrites."}\nUnlisted permissions are neutral. These are overwrites, not effective member permissions.`;
    if (text.length <= 1900) return text;
    return { content: `All overwrites for channel ${id} are in the attached file.`,
      files: [new AttachmentBuilder(Buffer.from(text), { name: "permission-overwrites.txt" })] };
  } };
  if (sub !== "set") throw new Refusal("Choose a supported permission action.");
  const role = i.options.getRole("role"); const member = i.options.getUser("member");
  if (!!role === !!member) throw new Refusal("Choose exactly one role or member.");
  const target = requiredId(role ?? member);
  const permission = i.options.getString("permission", true) as keyof typeof commonPermissions;
  const bit = commonPermissions[permission];
  const mode = i.options.getString("state", true);
  if (!bit || !["allow", "deny", "neutral"].includes(mode ?? "")) throw new Refusal("Choose a listed permission and allow, deny, or neutral.");
  return { action: "permissions.set", targetId: id, params: { target, type: role ? "role" : "member", permission, state: mode },
    summary: `Set ${permission} to ${mode} for ${role ? "role" : "member"} ${target} in ${channel.name} (${id})? Other permissions stay as they are.`,
    async run() {
      const s = await state(i, c); const ch = await getChannel(c, id); needBot(s, P.ManageRoles, ch);
      if (role) checkRole(s, target, { everyone: true }); else await checkMember(s, target, c);
      // Discord permits only overwrites the bot itself holds, unless it has an explicit Manage Roles overwrite.
      const elevated = ch.permission_overwrites?.some(o => (o.type === 1 && o.id === s.botId || o.type === 0 && s.bot.roles.includes(o.id))
        && (BigInt(o.allow) & P.ManageRoles) !== 0n);
      if (mode !== "neutral" && !elevated && !(botPermissions(s, ch) & bit)) throw new Refusal("The bot cannot set a permission it does not hold here.");
      const type = role ? 0 : 1;
      const previous = ch.permission_overwrites?.find(o => o.id === target && o.type === type);
      let allow = BigInt(previous?.allow ?? "0") & ~bit, deny = BigInt(previous?.deny ?? "0") & ~bit;
      if (mode === "allow") allow |= bit;
      if (mode === "deny") deny |= bit;
      if (allow === 0n && deny === 0n) {
        if (previous) await c.rest.delete(Routes.channelPermission(id, target));
      } else await c.rest.put(Routes.channelPermission(id, target), { body: { type, allow: allow.toString(), deny: deny.toString() } });
      return { content: `Set ${permission} to ${mode} for ${target} in ${id}.`, components: [] };
    } };
}
