import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrateRemoteAnonymization } from "../../src/db/remote-anonymization.js";

it("makes all Remote identity columns nullable after rebuilding", () => {
  const db=new Database(":memory:");
  try {
    db.exec(`create table remote_tables(id integer primary key autoincrement,created_by integer not null);
      create table remote_seats(id integer primary key autoincrement,user_id integer not null);
      create table tournament_remote_evidence(id integer primary key autoincrement,player_one_user_id integer not null,player_two_user_id integer not null);`);
    migrateRemoteAnonymization(db);
    for(const [table,columns] of Object.entries({remote_tables:["created_by"],remote_seats:["user_id"],tournament_remote_evidence:["player_one_user_id","player_two_user_id"]})) {
      for(const name of columns) expect(db.pragma(`table_info(${table})`)).toContainEqual(expect.objectContaining({name,notnull:0}));
    }
    migrateRemoteAnonymization(db);
  } finally {db.close();}
});

it("rolls back a rebuild when an identity column remains NOT NULL", () => {
  const db=new Database(":memory:");
  try {
    db.pragma("foreign_keys=on");
    db.exec(`create table remote_tables(id integer primary key autoincrement,"created_by" integer not null);
      insert into remote_tables(created_by) values(1);
      create trigger preserved before delete on remote_tables begin select raise(abort,'preserved'); end;`);
    expect(()=>migrateRemoteAnonymization(db)).toThrow(/identity.*nullable/i);
    expect(db.prepare("select * from remote_tables").all()).toEqual([{id:1,created_by:1}]);
    expect(db.pragma("table_info(remote_tables)")).toContainEqual(expect.objectContaining({name:"created_by",notnull:1}));
    expect(db.prepare("select name from sqlite_master where name='remote_tables_anon_new'").get()).toBeUndefined();
    expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
    expect(()=>db.prepare("delete from remote_tables").run()).toThrow("preserved");
  } finally {db.close();}
});
