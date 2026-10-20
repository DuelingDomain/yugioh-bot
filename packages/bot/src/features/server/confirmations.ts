import { randomBytes } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ComponentModule, ButtonInteractionLike, FeatureContext, InteractionLike } from "../../runtime/types.js";
import { admin, audit, fail, perform, Refusal, say, type Action } from "./common.js";

interface Pending { actor: string; guild: string; expires: number; action: Action }
// Each running bot has its own store. A stopped bot cannot retain executable actions.
const stores = new WeakMap<FeatureContext, Map<string, Pending>>();
function store(c: FeatureContext) {
  let value = stores.get(c);
  if (!value) { value = new Map(); stores.set(c, value); }
  return value;
}
export async function confirm(i: InteractionLike, c: FeatureContext, action: Action) {
  const pending = store(c);
  for (const [key, entry] of pending) if (entry.expires <= Date.now()) pending.delete(key);
  if (pending.size >= 1000) throw new Refusal("Too many confirmations are open. Try again in one minute.");
  const nonce = randomBytes(16).toString("hex");
  pending.set(nonce, { actor: i.user.id, guild: c.config.guildId, expires: Date.now() + 60_000, action });
  try {
    await say(i, { content: `${action.summary}\nConfirm within 60 seconds.`, components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`server:yes:${nonce}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`server:no:${nonce}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)),
    ] });
  } catch (error) { pending.delete(nonce); throw error; }
}
export const confirmationButton: ComponentModule<ButtonInteractionLike> = {
  prefix: "server:", access: "admin", acknowledgement: "manual",
  async execute(i, c) {
    let action: Action = { action: "server.confirm", run: async () => "" };
    try {
      await admin(i, c);
      const match = /^server:(yes|no):([a-f0-9]{32})$/.exec(i.customId);
      const pending = store(c);
      const entry = match ? pending.get(match[2]) : undefined;
      if (!entry) throw new Refusal("This confirmation has expired. Run the command again.");
      if (entry.actor !== i.user.id || entry.guild !== i.guildId)
        throw new Refusal("Only the admin who requested this action can confirm or cancel it.");
      action = entry.action;
      // Consume before I/O, so concurrent presses cannot repeat an action.
      pending.delete(match![2]);
      await i.deferUpdate();
      const source = i;
      i = { ...source, async reply({ flags, ephemeral, ...message }) {
        await source.editReply({ ...message, components: [] });
      } };
      if (entry.expires <= Date.now()) throw new Refusal("This confirmation has expired. Run the command again.");
      if (match![1] === "no") {
        await audit(c, i, { ...action, params: { ...action.params, cancelled: true } }, "denied", "Cancelled by the actor.");
        await say(i, { content: "Cancelled.", components: [] }); return;
      }
      if (!await c.cooldown.run(entry.guild, entry.actor, () => perform(c, i, action))) {
        throw new Refusal("Wait three seconds, then request the action again.");
      }
    } catch (error) { await fail(c, i, action, error); }
  },
};
