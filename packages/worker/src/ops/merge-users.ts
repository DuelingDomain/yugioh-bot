import type Database from "better-sqlite3";
import { createUserService, ownershipReferences, playerReferences, userHistory } from "@yugidraft/shared/services";
import { OpsError, type OpsContext } from "./report.js";

type Player = { id: number; guild_id: string; user_id: number };
type Affected = { table: string; column: string; rowIds: number[] };
type Conflict = { table: string; index: string; rowIds: number[] };
type ManualReview = { table: string; rowId: number; path: string; sourcePlayerId: number };
const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function columns(db: Database.Database, table: string): string[] {
  const names = db.prepare(`pragma table_info(${quote(table)})`).all() as { name: string }[];
  if (names.length === 0) throw new OpsError(`Missing history table: ${table}`);
  return names.map(column => column.name);
}

function manualReferences(db: Database.Database, sourcePlayers: Player[]): ManualReview[] {
  const ids = new Set(sourcePlayers.map(player => player.id));
  const found: ManualReview[] = [];
  for (const table of ["drafts", "cubes", "tournament_matches"]) {
    const column = table === "tournament_matches" ? "metadata_json" : "config_json";
    const rows = db.prepare<[], { rowId: number; json: string }>(`select rowid as rowId,${quote(column)} as json from ${quote(table)}`).all();
    for (const row of rows) {
      let json: Record<string, unknown>;
      try { json = JSON.parse(row.json); } catch { throw new OpsError("Invalid JSON in manual-review data"); }
      if (!json || typeof json !== "object") continue;
      if (table === "tournament_matches") {
        const id = Number(json.winnerId);
        if (ids.has(id)) found.push({ table, rowId: row.rowId, path: "metadata_json.winnerId", sourcePlayerId: id });
      } else {
        const visit = (value: unknown, path: string) => {
          if (value !== null && typeof value === "object") {
            for (const [key, child] of Object.entries(value)) {
              // Only numeric identity keys enter reports; theme text can contain
              // private information and stays in the original JSON for review.
              const childPath = `${path}.${/^\d+$/.test(key) ? key : "[field]"}`;
              if (ids.has(Number(key))) found.push({ table, rowId: row.rowId, path: childPath, sourcePlayerId: Number(key) });
              visit(child, childPath);
            }
          } else if ((typeof value === "number" || typeof value === "string") && ids.has(Number(value))) {
            found.push({ table, rowId: row.rowId, path, sourcePlayerId: Number(value) });
          }
        };
        visit(json.themeAssignments, "config_json.themeAssignments");
      }
    }
  }
  return found;
}

// Evaluate every unique index against the proposed final values. This includes
// composite PKs and partial indexes (notably saved-deck and placement awards),
// without hard-coding a second list of constraints or dropping derived rows.
function uniqueConflicts(db: Database.Database, table: string, transformations: Map<string, string>, removedRowIds: number[] = []): Conflict[] {
  if (transformations.size === 0) return [];
  const present = columns(db, table);
  const indexes = db.prepare(`pragma index_list(${quote(table)})`).all() as { name: string; unique: number; partial: number }[];
  const projection = present.map(column => `${transformations.get(column) ?? quote(column)} as ${quote(column)}`).join(",");
  const conflicts: Conflict[] = [];
  for (const index of indexes.filter(index => index.unique === 1)) {
    const keyColumns = (db.prepare(`pragma index_xinfo(${quote(index.name)})`).all() as { name: string | null; coll: string; key: number }[]).filter(column => column.key === 1);
    if (!keyColumns.some(column => column.name && transformations.has(column.name))) continue;
    if (keyColumns.some(column => column.name === null)) throw new OpsError("Cannot preflight an expression index; owner review required");
    const indexSql = db.prepare<[string], { sql: string | null }>("select sql from sqlite_master where type='index' and name=?").get(index.name)?.sql;
    const predicate = index.partial ? indexSql?.match(/\bwhere\b([\s\S]+)$/i)?.[1] : undefined;
    if (index.partial && !predicate) throw new OpsError("Cannot preflight a partial index; owner review required");
    const group = keyColumns.map(column => `${quote(column.name!)} collate ${quote(column.coll)}`).join(",");
    const nonnull = keyColumns.map(column => `${quote(column.name!)} is not null`).join(" and ");
    const rows = db.prepare<[], { rowIds: string }>(`with proposed as (select rowid as __ops_rowid,${projection} from ${quote(table)}${removedRowIds.length ? ` where rowid not in (${removedRowIds.join(",")})` : ""})
      select group_concat(__ops_rowid) as rowIds from proposed where ${nonnull}${predicate ? ` and (${predicate})` : ""}
      group by ${group} having count(*)>1`).all();
    for (const row of rows) conflicts.push({ table, index: index.name, rowIds: row.rowIds.split(",").map(Number).sort((a, b) => a - b) });
  }
  return conflicts;
}

export function mergeUsers(ctx: OpsContext, sourceId: number, targetId: number) {
  if (![sourceId, targetId].every(id => Number.isSafeInteger(id) && id > 0) || sourceId === targetId) {
    throw new OpsError("Source and target must be distinct positive users.id values");
  }
  const execute = () => {
    const users = createUserService(ctx.db);
    const source = users.findById(sourceId), target = users.findById(targetId);
    if (!source || !target) throw new OpsError("Source and target users must exist");
    const players = ctx.db.prepare<[number], Player>("select id,guild_id,user_id from players where user_id=? order by id");
    const sourcePlayers = players.all(sourceId), targetPlayers = players.all(targetId);
    const mappings = sourcePlayers.flatMap(player => {
      const survivor = targetPlayers.find(other => other.guild_id === player.guild_id);
      return survivor ? [{ source: player.id, target: survivor.id }] : [];
    });
    const report = {
      status: ctx.apply ? "applied" : "dry-run",
      message: "Stop writers and revoke the source's Clerk sessions before applying this merge",
      source: { id: source.id, hasClerk: source.clerkUserId !== null, hasDiscord: source.discordUserId !== null },
      target: { id: target.id, hasClerk: target.clerkUserId !== null, hasDiscord: target.discordUserId !== null },
      sourceHistory: userHistory(ctx.db, sourceId), targetHistory: userHistory(ctx.db, targetId),
      affectedRows: [] as Affected[], playerMappings: mappings,
      conflicts: [] as Conflict[], manualReview: manualReferences(ctx.db, sourcePlayers),
      foreignKeyViolations: [] as unknown[],
    };
    // Invite grants are access permissions, not history. Report them separately
    // and combine overlapping grants instead of treating them as merge conflicts.
    const grantRowIds = ctx.db.prepare<[number], { id: number }>(
      "select rowid as id from draft_invite_grants where user_id=? order by rowid",
    ).all(sourceId).map(row => row.id);
    if (grantRowIds.length) report.affectedRows.push({ table: "draft_invite_grants", column: "user_id", rowIds: grantRowIds });
    const transformations = new Map<string, Map<string, string>>();
    for (const [references, ownership] of [[ownershipReferences, true], [playerReferences, false]] as const) {
      for (const [table, refs] of Object.entries(references)) {
        const present = columns(ctx.db, table);
        const changes = new Map<string, string>();
        for (const column of refs.filter(column => present.includes(column))) {
          const predicate = ownership ? `${quote(column)}=${sourceId}` : `${quote(column)} in (select id from players where user_id=${sourceId})`;
          const rowIds = ctx.db.prepare<[], { id: number }>(`select rowid as id from ${quote(table)} where ${predicate} order by rowid`).all().map(row => row.id);
          if (rowIds.length) report.affectedRows.push({ table, column, rowIds });
          if (ownership) changes.set(column, `case when ${quote(column)}=${sourceId} then ${targetId} else ${quote(column)} end`);
          else if (mappings.length) changes.set(column, `case ${quote(column)} ${mappings.map(pair => `when ${pair.source} then ${pair.target}`).join(" ")} else ${quote(column)} end`);
        }
        transformations.set(table, changes);
        report.conflicts.push(...uniqueConflicts(ctx.db, table, changes));
      }
    }
    if (sourcePlayers.length) report.affectedRows.push({ table: "players", column: "user_id", rowIds: sourcePlayers.map(player => player.id) });
    const discord = target.discordUserId ?? source.discordUserId;
    const playerChanges = new Map([["user_id", `case when user_id=${sourceId} then ${targetId} else user_id end`]]);
    if (discord) {
      // This field is text, so bind it through SQLite's own literal quoting;
      // canonical IDs normally contain only digits, but legacy data may differ.
      const literal = ctx.db.prepare<[string], { value: string }>("select quote(?) as value").get(discord)!.value;
      playerChanges.set("discord_user_id", `case when user_id in (${sourceId},${targetId}) then ${literal} else discord_user_id end`);
      report.affectedRows.push({ table: "players", column: "discord_user_id", rowIds: [...sourcePlayers, ...targetPlayers].filter(player => !mappings.some(pair => pair.source === player.id)).map(player => player.id).sort((a, b) => a - b) });
    }
    report.conflicts.push(...uniqueConflicts(ctx.db, "players", playerChanges, mappings.map(pair => pair.source)));
    const fail = (message: string): never => { report.status = "failed"; throw new OpsError(message, { ...report, message }); };
    if (source.clerkUserId && target.clerkUserId) fail("Both users have a Clerk ID; resolve in Clerk first");
    if (source.discordUserId && target.discordUserId) fail("Both users have a Discord ID; resolve in Clerk first");
    if (report.conflicts.length) fail("Merge has unique constraint conflicts; no rows were changed");
    if (!ctx.apply) return report;
    if (ctx.db.pragma("foreign_keys", { simple: true }) !== 1) fail("Foreign keys must be enabled");
    report.foreignKeyViolations = ctx.db.pragma("foreign_key_check") as unknown[];
    if (report.foreignKeyViolations.length) fail("Database has existing foreign key violations");
    try {
      // Composite draft FKs cannot be repointed parent-first or child-first.
      // Defer validation, while keeping enforcement on, until all references
      // are moved and the explicit check succeeds before COMMIT.
      ctx.db.pragma("defer_foreign_keys = on");
      for (const [table, changes] of transformations) {
        if (!changes.size) continue;
        const assignments = [...changes].map(([column, expression]) => `${quote(column)}=${expression}`).join(",");
        const predicate = [...changes.keys()].map(column => `${quote(column)} ${ownershipReferences[table] ? `=${sourceId}` : `in (${mappings.map(pair => pair.source).join(",")})`}`).join(" or ");
        ctx.db.prepare(`update ${quote(table)} set ${assignments} where ${predicate}`).run();
      }
      for (const player of sourcePlayers) {
        if (mappings.some(pair => pair.source === player.id)) ctx.db.prepare("delete from players where id=?").run(player.id);
        else ctx.db.prepare("update players set user_id=? where id=?").run(targetId, player.id);
      }
      ctx.db.prepare(`insert or ignore into draft_invite_grants(draft_id,user_id,created_at)
        select draft_id,?,created_at from draft_invite_grants where user_id=?`).run(targetId, sourceId);
      ctx.db.prepare("delete from draft_invite_grants where user_id=?").run(sourceId);
      const clerk = target.clerkUserId ?? source.clerkUserId;
      ctx.db.prepare("update users set clerk_user_id=null,discord_user_id=null where id=?").run(sourceId);
      ctx.db.prepare("update users set clerk_user_id=?,discord_user_id=?,updated_at=current_timestamp,synced_at=null where id=?").run(clerk, discord, targetId);
      if (discord) ctx.db.prepare("update players set discord_user_id=? where user_id=?").run(discord, targetId);
      ctx.db.prepare("delete from users where id=?").run(sourceId);
      report.foreignKeyViolations = ctx.db.pragma("foreign_key_check") as unknown[];
      if (report.foreignKeyViolations.length) fail("Merge would violate foreign keys; transaction rolled back");
      return report;
    } catch (error) {
      if (error instanceof OpsError) throw error;
      return fail("Merge constraint failure; transaction rolled back; review affected rows");
    }
  };
  return ctx.apply ? ctx.db.transaction(execute).immediate() : execute();
}
