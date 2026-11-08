import type Database from "better-sqlite3";

const identities: Record<string, string[]> = {
  remote_tables: ["created_by"],
  remote_seats: ["user_id"],
  tournament_remote_evidence: ["player_one_user_id", "player_two_user_id"],
};

/** Allow privacy deletion to detach identity without losing the seat or game evidence. */
export function migrateRemoteAnonymization(db: Database.Database): void {
  const needsRebuild = (table: string) => (db.pragma(`table_info(${table})`) as {name:string;notnull:number}[])
    .some(column => identities[table].includes(column.name) && column.notnull);
  if (!Object.keys(identities).some(needsRebuild)) return;
  if (db.inTransaction) throw new Error("Remote identity migration requires an outer connection");
  const foreignKeys = Number(db.pragma("foreign_keys", { simple:true }));
  try {
    db.pragma("foreign_keys = off");
    db.transaction(() => {
      const tables = Object.keys(identities).filter(needsRebuild);
      if (!tables.length) return;
      // Save and suspend triggers, including optional web triggers referring to these tables.
      // In particular, dropping a table must not run its room/value collection triggers.
      const triggers = db.prepare("select name,sql from sqlite_master where type='trigger'").all() as {name:string;sql:string}[];
      const affected = (db.prepare("select name from sqlite_master where type='table'").all() as {name:string}[])
        .map(row=>row.name).filter(name=>tables.includes(name) ||
          (db.pragma(`foreign_key_list("${name}")`) as {table:string}[]).some(fk=>tables.includes(fk.table)));
      const check = () => affected.flatMap(name=>db.pragma(`foreign_key_check("${name}")`) as unknown[])
        .map(row=>JSON.stringify(row)).sort();
      const before = check();
      for (const trigger of triggers) db.exec(`drop trigger "${trigger.name}"`);
      for (const table of tables) {
        const {sql} = db.prepare("select sql from sqlite_master where type='table' and name=?").get(table) as {sql:string};
        const indexes = db.prepare("select sql from sqlite_master where type='index' and tbl_name=? and sql is not null").all(table) as {sql:string}[];
        const sequence = (db.prepare("select seq from sqlite_sequence where name=?").get(table) as {seq:number} | undefined)?.seq;
        let replacement = sql.replace(new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:"${table}"|${table})`, "i"), `create table ${table}_anon_new`);
        for (const column of identities[table]) replacement = replacement.replace(
          new RegExp(`\\b${column}\\s+integer\\s+not\\s+null\\b`, "i"), `${column} integer`);
        db.exec(replacement);
        db.exec(`insert into ${table}_anon_new select * from ${table}; drop table ${table};
          alter table ${table}_anon_new rename to ${table}`);
        const columns = db.pragma(`table_info(${table})`) as {name:string;notnull:number}[];
        for (const name of identities[table]) {
          if (columns.find(column=>column.name === name)?.notnull !== 0) {
            throw new Error(`Remote identity column ${table}.${name} must be nullable`);
          }
        }
        for (const index of indexes) db.exec(index.sql);
        if (sequence !== undefined) db.prepare("update sqlite_sequence set seq=? where name=?").run(sequence, table);
      }
      for (const trigger of triggers) db.exec(trigger.sql);
      if (JSON.stringify(check()) !== JSON.stringify(before)) throw new Error("Remote identity migration changed foreign keys");
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    if (Number(db.pragma("foreign_keys", {simple:true})) !== foreignKeys) throw new Error("Failed to restore Remote foreign keys");
  }
}
