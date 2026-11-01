import type Database from "better-sqlite3";

/** Sandbox retention is independent of ordinary duel history. Child rows cascade on delete. */
export function createSandboxCleanupService(db: Database.Database) {
  const archive = db.prepare(`
    update duels set archived_at = datetime(@now)
    where sandbox = 1 and archived_at is null
      and status in ('completed', 'cancelled', 'interrupted')
      and ended_at <= datetime(@now, '-1 hour')
  `);
  const remove = db.prepare(`
    delete from duels where sandbox = 1 and created_at < datetime(@now, '-7 days')
  `);
  const sweep = db.transaction((now: string) => {
    const deleted = remove.run({ now }).changes;
    const archived = archive.run({ now }).changes;
    return { archived, deleted };
  });
  return { tick: (now = new Date().toISOString()) => sweep(now) };
}
