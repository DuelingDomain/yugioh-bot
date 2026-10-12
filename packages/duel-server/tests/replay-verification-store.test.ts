import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createReplayVerificationStore } from "../src/replay-verification-store.js";

it("migrates twice and stores versioned outcomes with invalidation stamps and cascade deletion", () => {
  const db = new Database(":memory:"); db.pragma("foreign_keys=on"); migrate(db); migrate(db);
  try {
    // No real actor or duel data is needed for this storage test.
    db.prepare("insert into users(id,username,display_name) values(1,'fixture','Fixture')").run();
    db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,'test-guild',1,'Fixture')").run();
    db.prepare("insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) values(1,'test-guild','fixture','Fixture',1,'normal','completed')").run();
    const store = createReplayVerificationStore(db);
    const key = { duelId: 1, bundleVersion: "bundle-new", sourceVersion: "source-a", resourceStamp: "runtime-a", boardStamp: "board-a" };
    expect(store.get(key)).toBeNull();
    store.set(key, null, "pinned");
    expect(store.get(key)).toMatchObject({ result: "verified", reason: null, coreFamily: "pinned" });
    for (const field of ["sourceVersion", "resourceStamp", "boardStamp", "bundleVersion"] as const) {
      expect(store.get({ ...key, [field]: "changed" })).toBeNull();
    }
    store.set(key, "board_mismatch");
    expect(store.get(key)).toMatchObject({ result: "unverified", reason: "board_mismatch", coreFamily: null });
    store.set({ ...key, bundleVersion: "bundle-next" }, "command_mismatch");
    store.set({ ...key, bundleVersion: "bundle-empty" }, "no_saved_board");
    expect(db.prepare("select * from duel_replay_verifications").all()).toHaveLength(3);
    expect(db.prepare("select bundle_version from duels where id=1").get()).toEqual({ bundle_version: null });
    db.prepare("delete from duels where id=1").run();
    expect(db.prepare("select * from duel_replay_verifications").all()).toEqual([]);
  } finally { db.close(); }
});

it("adds the family column to an existing verification table without losing outcomes", () => {
  const db = new Database(":memory:"); migrate(db);
  try {
    db.prepare("insert into users(id,username,display_name) values(1,'fixture','Fixture')").run();
    db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,'test-guild',1,'Fixture')").run();
    db.prepare("insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status) values(1,'test-guild','fixture','Fixture',1,'normal','completed')").run();
    const key = { duelId: 1, bundleVersion: "bundle", sourceVersion: "source", resourceStamp: "resources", boardStamp: "board" };
    createReplayVerificationStore(db).set(key, null);
    db.exec("alter table duel_replay_verifications drop column core_family");
    migrate(db); migrate(db);
    expect(createReplayVerificationStore(db).get(key)).toEqual({ result: "verified", reason: null, coreFamily: null });
  } finally { db.close(); }
});
