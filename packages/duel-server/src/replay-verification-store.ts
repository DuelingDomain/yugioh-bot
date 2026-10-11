import type Database from "better-sqlite3";

export type ReplayUnverifiedReason = "board_mismatch" | "command_mismatch" | "no_saved_board";
export interface ReplayVerificationKey {
  duelId: number;
  bundleVersion: string;
  sourceVersion: string;
  resourceStamp: string;
  boardStamp: string;
}
export interface ReplayVerificationRecord {
  result: "verified" | "unverified";
  reason: ReplayUnverifiedReason | null;
}

/** One row per duel/current version. Stamps also protect against source edits and relabeled resources. */
export function createReplayVerificationStore(db: Database.Database) {
  return {
    get(key: ReplayVerificationKey): ReplayVerificationRecord | null {
      return db.prepare<[number, string, string, string, string], ReplayVerificationRecord>(`
        select result, reason from duel_replay_verifications
        where duel_id=? and bundle_version=? and source_version=? and resource_stamp=? and board_stamp=?
      `).get(key.duelId, key.bundleVersion, key.sourceVersion, key.resourceStamp, key.boardStamp) ?? null;
    },
    set(key: ReplayVerificationKey, reason: ReplayUnverifiedReason | null): void {
      db.prepare(`insert into duel_replay_verifications
        (duel_id,bundle_version,source_version,resource_stamp,board_stamp,result,reason,checked_at)
        values(?,?,?,?,?,?,?,datetime('now'))
        on conflict(duel_id,bundle_version) do update set source_version=excluded.source_version,
        resource_stamp=excluded.resource_stamp, board_stamp=excluded.board_stamp,
        result=excluded.result, reason=excluded.reason, checked_at=excluded.checked_at`)
        .run(key.duelId, key.bundleVersion, key.sourceVersion, key.resourceStamp, key.boardStamp,
          reason === null ? "verified" : "unverified", reason);
    },
  };
}
