import type Database from "better-sqlite3";

const LEGACY_CHECK = "source in ('web', 'discord')";
const ADMIN_CHECK = "source in ('web', 'discord', 'admin')";

/** SQLite needs a table rebuild to extend a CHECK. Keep rows, indexes, triggers and outbox references. */
export function migrateWaitlistAdminSource(db: Database.Database): void {
  const tableSql = () => (db.prepare("select sql from sqlite_master where type='table' and name='discord_waitlist_actions'").get() as { sql: string }).sql;
  if (!tableSql().includes(LEGACY_CHECK)) return;
  if (db.inTransaction) throw new Error("Waitlist source migration requires an outer connection");
  const foreignKeys = Number(db.pragma("foreign_keys", { simple: true }));
  try {
    // Disable cascading deletes while replacing the parent table, as in the identity migration.
    db.pragma("foreign_keys = off");
    db.transaction(() => {
      // Another connection can finish the migration before this write lock is acquired.
      const sql = tableSql();
      if (!sql.includes(LEGACY_CHECK)) return;
      const objects = db.prepare("select sql from sqlite_master where tbl_name='discord_waitlist_actions' and type in ('index','trigger') and sql is not null")
        .all() as { sql: string }[];
      const foreignKeyState = () => ["discord_waitlist_actions", "discord_outbox"]
        .flatMap(table => db.pragma(`foreign_key_check(${table})`) as unknown[])
        .map(row => JSON.stringify(row)).sort();
      const beforeForeignKeys = foreignKeyState();
      db.exec(sql.replace(/^create table(?: if not exists)?\s+(?:"discord_waitlist_actions"|discord_waitlist_actions)/i, "create table discord_waitlist_actions_admin_new")
        .replace(LEGACY_CHECK, ADMIN_CHECK));
      const columns = (db.pragma("table_xinfo(discord_waitlist_actions)") as { name: string; hidden: number }[])
        .filter(column => column.hidden === 0)
        .map(column => `"${column.name.replaceAll('"', '""')}"`).join(", ");
      // Preserve rowids too, so existing FK diagnostics retain their exact identity.
      db.exec(`insert into discord_waitlist_actions_admin_new (rowid, ${columns}) select rowid, ${columns} from discord_waitlist_actions;
        drop table discord_waitlist_actions;
        alter table discord_waitlist_actions_admin_new rename to discord_waitlist_actions;`);
      for (const object of objects) db.exec(object.sql);
      if (JSON.stringify(foreignKeyState()) !== JSON.stringify(beforeForeignKeys)) {
        throw new Error("Waitlist source migration changed foreign keys");
      }
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    if (Number(db.pragma("foreign_keys", { simple: true })) !== foreignKeys) throw new Error("Failed to restore foreign_keys after waitlist source migration");
  }
}
