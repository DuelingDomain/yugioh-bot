import type Database from "better-sqlite3";
import { lstat, opendir, stat, statfs } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { createLoop } from "./loop.js";

/** Contract with the admin System section (packages/web, lib/admin-console/types.ts `DiskBreakdown`). */
export interface DiskUsageSnapshot {
  measuredAt: number;
  /** Everything under the data directory. */
  dataBytes: number;
  database: { bytes: number; walBytes: number };
  images: { bytes: number; capBytes: number };
  /** Null when the directory does not exist. */
  engine: { bytes: number } | null;
  backups: { bytes: number } | null;
  other: { bytes: number };
}

const HOUR_MS = 3_600_000;
const KEEP_MS = 7 * 24 * HOUR_MS;

async function walk(root: string, onFile: (path: string, size: number) => void): Promise<void> {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    try {
      for await (const entry of await opendir(directory)) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) { try { onFile(path, (await lstat(path)).size); } catch {} }
      }
    } catch {}
  }
}

const inside = (directory: string, path: string) => {
  const rel = relative(directory, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const exists = (path: string) => stat(path).then(() => true, () => false);

export async function measureDiskUsage(input: { dataDir: string; databasePath: string; imageCacheDir: string; imageCacheMaxBytes: number; engineDir: string; backupsDir: string }, now = Date.now()): Promise<DiskUsageSnapshot> {
  const databaseName = basename(input.databasePath);
  const sizes = { database: 0, wal: 0, images: 0, engine: 0, backups: 0, other: 0 };
  const buckets = [
    { key: "images", dir: input.imageCacheDir }, { key: "engine", dir: input.engineDir }, { key: "backups", dir: input.backupsDir },
  ] as const;
  const present = { engine: await exists(input.engineDir), backups: await exists(input.backupsDir) };
  let dataBytes = 0;
  await walk(input.dataDir, (path, size) => {
    dataBytes += size;
    const bucket = buckets.find((b) => inside(b.dir, path));
    if (bucket) sizes[bucket.key] += size;
    else if (dirname(path) === input.dataDir && path.startsWith(join(input.dataDir, databaseName))) {
      if (path.endsWith("-wal")) sizes.wal += size; else sizes.database += size;
    } else sizes.other += size;
  });
  // A bucket that lives outside the data directory still counts toward its own line.
  for (const bucket of buckets) {
    if (bucket.dir === input.dataDir || inside(input.dataDir, bucket.dir)) continue;
    await walk(bucket.dir, (_path, size) => { sizes[bucket.key] += size; });
  }
  return {
    measuredAt: now, dataBytes,
    database: { bytes: sizes.database, walBytes: sizes.wal },
    images: { bytes: sizes.images, capBytes: input.imageCacheMaxBytes },
    engine: present.engine ? { bytes: sizes.engine } : null,
    backups: present.backups ? { bytes: sizes.backups } : null,
    other: { bytes: sizes.other },
  };
}

/** Every 10 minutes: store the directory breakdown. Every hour: one used-space point, kept 7 days. */
export function createDiskUsage(input: Parameters<typeof measureDiskUsage>[0] & { db: Database.Database }) {
  const saveSnapshot = input.db.prepare("insert into disk_usage_snapshot(id, at, json) values (1, ?, ?) on conflict(id) do update set at = excluded.at, json = excluded.json");
  const newest = input.db.prepare("select max(at) at from disk_usage_history");
  const addPoint = input.db.prepare("insert or replace into disk_usage_history(at, used_bytes) values (?, ?)");
  const prune = input.db.prepare("delete from disk_usage_history where at < ?");
  return createLoop(async () => {
    const snapshot = await measureDiskUsage(input);
    saveSnapshot.run(snapshot.measuredAt, JSON.stringify(snapshot));
    const last = (newest.get() as { at: number | null }).at;
    if (last === null || snapshot.measuredAt - last >= HOUR_MS) {
      const disk = await statfs(input.dataDir);
      addPoint.run(snapshot.measuredAt, (disk.blocks - disk.bfree) * disk.bsize);
    }
    prune.run(snapshot.measuredAt - KEEP_MS);
  }, 10 * 60_000);
}
