import Database from "better-sqlite3";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createReplayVerificationStore } from "../src/replay-verification-store.js";

it("preserves existing saved boards on repeated migration and stores versioned outcomes with cascade deletion", () => {
  const db = new Database(":memory:"); db.pragma("foreign_keys=on"); migrate(db);
  try {
    // No real actor or duel data is needed for this storage test.
    db.prepare("insert into players(id,guild_id,discord_user_id,display_name) values(1,'test-guild','101','Fixture')").run();
    const publicBoard = '{"seats":[],"fixture":"saved"}';
    db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,snapshot_public_json,snapshot_seat0_json)
      values(1,'test-guild','fixture','Fixture',1,'normal','completed',?,?)`).run(publicBoard, gzipSync(publicBoard));
    // Model the local DB before this port. Keep both JSON text and compressed snapshot bytes.
    db.exec("drop table duel_replay_verifications");
    const before = db.prepare("select * from duels").all();
    migrate(db);
    expect(db.prepare("select * from duels").all()).toEqual(before);
    const once = db.serialize();
    migrate(db);
    expect(db.serialize()).toEqual(once);
    const store = createReplayVerificationStore(db);
    const key = { duelId: 1, bundleVersion: "bundle-new", sourceVersion: "source-a", resourceStamp: "runtime-a", boardStamp: "board-a" };
    expect(store.get(key)).toBeNull();
    store.set(key, null);
    expect(store.get(key)).toMatchObject({ result: "verified", reason: null });
    for (const field of ["sourceVersion", "resourceStamp", "boardStamp", "bundleVersion"] as const) {
      expect(store.get({ ...key, [field]: "changed" })).toBeNull();
    }
    store.set(key, "board_mismatch");
    expect(store.get(key)).toMatchObject({ result: "unverified", reason: "board_mismatch" });
    store.set({ ...key, bundleVersion: "bundle-next" }, "command_mismatch");
    store.set({ ...key, bundleVersion: "bundle-empty" }, "no_saved_board");
    expect(db.prepare("select * from duel_replay_verifications").all()).toHaveLength(3);
    expect(db.prepare("select bundle_version from duels where id=1").get()).toEqual({ bundle_version: null });
    db.prepare("delete from duels where id=1").run();
    expect(db.prepare("select * from duel_replay_verifications").all()).toEqual([]);
  } finally { db.close(); }
});
