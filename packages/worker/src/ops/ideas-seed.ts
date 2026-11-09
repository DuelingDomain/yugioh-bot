import { IDEAS_SEEDS } from "./ideas-seed-data.js";
import { OpsError, type OpsContext } from "./report.js";

export function seedIdeas(ctx: OpsContext, ownerIds: ReadonlySet<number>) {
  const guildId = ctx.guildId;
  if (!guildId?.trim()) throw new OpsError("DISCORD_GUILD_ID is required");
  const authorUserId = ownerIds.values().next().value;
  if (authorUserId === undefined) throw new OpsError("OWNER_USER_IDS must contain an application user ID");

  const execute = () => {
    if (!ctx.db.prepare("select id from users where id = ?").get(authorUserId)) {
      throw new OpsError("The first OWNER_USER_IDS entry must be an existing users.id");
    }
    const existingKeys = new Set(ctx.db.prepare<[string], { seed_key: string }>(
      "select seed_key from ideas where guild_id = ? and seed_key is not null",
    ).all(guildId).map(row => row.seed_key));
    const pending = IDEAS_SEEDS.filter(seed => !existingKeys.has(seed.seedKey));
    const report = {
      status: pending.length === 0 ? "noop" : ctx.apply ? "applied" : "dry-run",
      guildId, authorUserId, planned: pending.length, inserted: 0, existing: IDEAS_SEEDS.length - pending.length,
      counts: {
        open: pending.filter(seed => seed.state === "open").length,
        inProgress: pending.filter(seed => seed.state === "in_progress").length,
        done: pending.filter(seed => seed.state === "done").length,
      },
    };
    if (!ctx.apply || pending.length === 0) return report;
    const insert = ctx.db.prepare(`insert into ideas (
      guild_id,seed_key,title,pitch,area,author_user_id,team,state,shipped_before_board,shipped_week,
      created_at,approved_at,started_at,done_at,decided_by_user_id
    ) values (
      @guildId,@seedKey,@title,@pitch,@area,@authorUserId,1,@state,@shippedBeforeBoard,@shippedWeek,
      @timestamp,@timestamp,@startedAt,@doneAt,@decidedByUserId
    )`);
    const now = ctx.db.prepare<[], { now: string }>("select current_timestamp now").get()!.now;
    for (const seed of pending) {
      const timestamp = seed.shippedWeek ? `${seed.shippedWeek} 00:00:00` : now;
      report.inserted += insert.run({
        ...seed, guildId, authorUserId: seed.state === "done" ? null : authorUserId,
        shippedBeforeBoard: seed.shippedWeek ? 1 : 0, timestamp,
        startedAt: seed.state === "in_progress" ? timestamp : null,
        doneAt: seed.state === "done" ? timestamp : null, decidedByUserId: authorUserId,
      }).changes;
    }
    return report;
  };
  return ctx.apply ? ctx.db.transaction(execute).immediate() : execute();
}
