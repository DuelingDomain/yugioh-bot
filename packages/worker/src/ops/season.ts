import { createSeasonService, createUserService } from "@yugidraft/shared/services";
import { OpsError, type OpsContext } from "./report.js";

export function runSeason(ctx: OpsContext, action: "status" | "start" | "end", opts: { name?: string; actor?: number }) {
  if (!ctx.guildId) throw new OpsError("DISCORD_GUILD_ID is required");
  const seasons = createSeasonService(ctx.db);
  const execute = () => {
    if (opts.actor !== undefined && (!Number.isSafeInteger(opts.actor) || opts.actor <= 0 || !createUserService(ctx.db).findById(opts.actor))) {
      throw new OpsError("Actor must be an existing users.id");
    }
    const active = seasons.getActive(ctx.guildId!);
    if (action === "status") return { status: active ? "active" : "inactive", seasonId: active?.id ?? null, message: active ? "A season is active" : "No active season" };
    if (action === "start" && active) throw new OpsError("A season is already active");
    if (action === "end" && !active) return { status: "noop", seasonId: null, message: "No active season; nothing to end" };
    if (!ctx.apply) return { status: "dry-run", seasonId: active?.id ?? null, message: `Would ${action} season` };
    const season = action === "start" ? seasons.start(ctx.guildId!, opts.actor, opts.name) : seasons.end(ctx.guildId!, opts.actor);
    return { status: "applied", seasonId: season!.id, message: action === "start" ? "Season started" : "Season ended" };
  };
  return ctx.apply ? ctx.db.transaction(execute).immediate() : execute();
}
