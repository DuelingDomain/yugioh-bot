import type { CommandModule, FeatureModule } from "../../runtime/types.js";
import { admin, fail, perform, type Action } from "./common.js";
import { confirm, confirmationButton } from "./confirmations.js";
import { channelDefinition, categoryDefinition, permissionsDefinition, roleDefinition, setupDefinition } from "./definitions.js";
import { channelAction, categoryAction } from "./channels.js";
import { permissionsAction } from "./permissions.js";
import { roleAction } from "./roles.js";
import { setupAction } from "./setup.js";

function command(data: CommandModule["data"], prepare: (i: Parameters<CommandModule["execute"]>[0], c: Parameters<CommandModule["execute"]>[1]) => Promise<Action>): CommandModule {
  return { data, access: "admin", async execute(i, c) {
    const action = `${i.commandName}.${i.options.getSubcommand() ?? "unknown"}`;
    const params = Object.fromEntries(Object.entries({
      channelId: i.options.getChannel("channel")?.id, categoryId: i.options.getChannel("category")?.id,
      roleId: i.options.getRole("role")?.id, memberId: i.options.getUser("member")?.id,
    }).filter(([, value]) => value !== undefined));
    const targetId = params.memberId ?? params.roleId ?? params.channelId ?? params.categoryId;
    try {
      await admin(i, c);
      const plan = await prepare(i, c);
      if (plan.summary) await confirm(i, c, plan);
      else await perform(c, i, plan);
    } catch (error) { await fail(c, i, { action, targetId, params }, error); }
  } };
}
export const server: FeatureModule = {
  commands: [command(channelDefinition, channelAction), command(categoryDefinition, categoryAction),
    command(permissionsDefinition, permissionsAction), command(roleDefinition, roleAction), command(setupDefinition, setupAction)],
  buttons: [confirmationButton], modals: [],
};
