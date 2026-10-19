import { PermissionFlagsBits as P, Routes, type APIRole } from "discord.js";
import type { CommandInteractionLike as Command, FeatureContext } from "../../runtime/types.js";
import { checkMember, checkRole, needBot, Refusal, requiredId, state, validName, type Action } from "./common.js";

function appearance(i: Command) {
  const body: Record<string, unknown> = {};
  const name = i.options.getString("name"); if (name !== null) body.name = validName(name);
  const colour = i.options.getString("colour");
  if (colour !== null) {
    if (!/^#?[\da-fA-F]{6}$/.test(colour)) throw new Refusal("Use a six digit hex colour, for example #336699.");
    body.color = Number.parseInt(colour.replace("#", ""), 16);
  }
  const hoist = i.options.getBoolean("hoist"); if (hoist !== null) body.hoist = hoist;
  const mentionable = i.options.getBoolean("mentionable"); if (mentionable !== null) body.mentionable = mentionable;
  return body;
}
export async function roleAction(i: Command, c: FeatureContext): Promise<Action> {
  const sub = i.options.getSubcommand();
  if (sub === "create") {
    const body = { ...appearance(i), name: validName(i.options.getString("name", true)), permissions: "0" };
    return { action: "role.create", params: body, async run() {
      const s = await state(i, c); needBot(s, P.ManageRoles);
      const result = await c.rest.post(Routes.guildRoles(s.guildId), { body }) as APIRole;
      return `Created role ${result.id} (${body.name}) with no server permissions.`;
    } };
  }
  const id = requiredId(i.options.getRole("role", true));
  const s = await state(i, c); needBot(s, P.ManageRoles);
  const target = checkRole(s, id, { sensitive: true });
  if (sub === "edit") {
    const body = appearance(i);
    if (!Object.keys(body).length) throw new Refusal("Choose at least one role setting to change.");
    return { action: "role.edit", targetId: id, params: body, async run() {
      const current = await state(i, c); needBot(current, P.ManageRoles); checkRole(current, id, { sensitive: true });
      await c.rest.patch(Routes.guildRole(current.guildId, id), { body }); return `Updated role ${id}.`;
    } };
  }
  if (sub === "delete") return { action: "role.delete", targetId: id, summary: `Delete role ${target.name} (${id}) from the server and all its members?`, async run() {
    const current = await state(i, c); needBot(current, P.ManageRoles); checkRole(current, id, { sensitive: true });
    await c.rest.delete(Routes.guildRole(current.guildId, id)); return { content: `Deleted role ${id}.`, components: [] };
  } };
  if (sub !== "give" && sub !== "take") throw new Refusal("Choose a supported role action.");
  const memberId = requiredId(i.options.getUser("member", true));
  return { action: `role.${sub}`, targetId: memberId, params: { roleId: id }, async run() {
    const current = await state(i, c); needBot(current, P.ManageRoles);
    checkRole(current, id, { sensitive: true });
    const member = await checkMember(current, memberId, c);
    const present = member.roles.includes(id);
    if (sub === "give" && !present) await c.rest.put(Routes.guildMemberRole(current.guildId, memberId, id));
    if (sub === "take" && present) await c.rest.delete(Routes.guildMemberRole(current.guildId, memberId, id));
    return `${sub === "give" ? "Gave" : "Took"} role ${id} ${sub === "give" ? "to" : "from"} member ${memberId}.${present === (sub === "give") ? " The member already had this role state." : ""}`;
  } };
}
