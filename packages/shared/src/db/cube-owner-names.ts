import type Database from "better-sqlite3";

const guildNameKey = /\bunique\s*\(\s*guild_id\s*,\s*name\s*\)/i;
function cubeSchema(db: Database.Database): string {
  return (db.prepare("select sql from sqlite_master where type='table' and name='cubes'").get() as { sql: string }).sql;
}

/** Replace the historical guild-wide name key without changing cube IDs or child tables. */
export function migrateCubeOwnerNames(db: Database.Database): void {
  if (!guildNameKey.test(cubeSchema(db))) return;
  if (db.inTransaction) throw new Error("Cube name migration requires an outer connection");
  const foreignKeys = Number(db.pragma("foreign_keys", { simple: true }));
  try {
    // DROP must not cascade into cube_cards or draft_player_cube. SQLite requires
    // this pragma outside the transaction; restore the caller's setting in finally.
    db.pragma("foreign_keys = off");
    db.transaction(() => {
      // Another startup may have completed the rebuild while we waited for the write lock.
      const schema = cubeSchema(db);
      if (!guildNameKey.test(schema)) return;
      const objects = db.prepare("select sql from sqlite_master where tbl_name='cubes' and type in ('index','trigger') and sql is not null").all() as Array<{ sql: string }>;
      const highWater = (db.prepare("select seq from sqlite_sequence where name='cubes'").get() as { seq: number } | undefined)?.seq ?? 0;
      const count = (db.prepare("select count(*) n from cubes").get() as { n: number }).n;
      // Avoid scanning unrelated tables (including large duel journals) under the write lock.
      const foreignKeyState = () => ["cubes", "cube_cards", "draft_player_cube"]
        .flatMap(table => db.pragma(`foreign_key_check(${table})`) as unknown[])
        .map(row => JSON.stringify(row)).sort();
      const beforeForeignKeys = foreignKeyState();
      // Reuse the stored DDL so historical columns, defaults, checks and FKs survive.
      const replacement = schema
        .replace(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"cubes"|cubes)/i, "create table cubes_owner_names_new")
        .replace(guildNameKey, "unique (guild_id, created_by_user_id, name)");
      db.exec(replacement);
      const columns = (db.pragma("table_xinfo(cubes)") as Array<{ name: string; hidden: number }>)
        .filter(column => column.hidden === 0)
        .map(column => `"${column.name.replaceAll('"', '""')}"`).join(", ");
      db.exec(`insert into cubes_owner_names_new (${columns}) select ${columns} from cubes`);
      if ((db.prepare("select count(*) n from cubes_owner_names_new").get() as { n: number }).n !== count) {
        throw new Error("Cube name migration count mismatch");
      }
      db.exec("drop table cubes; alter table cubes_owner_names_new rename to cubes;");
      for (const object of objects) db.exec(object.sql);
      // Deleted IDs must not be reused; INSERT copied only the surviving rows.
      const copiedHighWater = (db.prepare("select seq from sqlite_sequence where name='cubes'").get() as { seq: number } | undefined)?.seq ?? 0;
      db.prepare("delete from sqlite_sequence where name='cubes'").run();
      db.prepare("insert into sqlite_sequence(name,seq) values('cubes',?)").run(Math.max(highWater, copiedHighWater));
      // Preserve existing unknown-owner rows, but reject any new FK damage.
      if (JSON.stringify(foreignKeyState()) !== JSON.stringify(beforeForeignKeys)) {
        throw new Error("Cube name migration changed foreign keys");
      }
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    if (Number(db.pragma("foreign_keys", { simple: true })) !== foreignKeys) {
      throw new Error("Failed to restore foreign_keys after cube name migration");
    }
  }
}
