import Database from "better-sqlite3";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { PreparedCardData } from "./released-card-data.js";
import type { PrereleaseSmokeResult } from "./prerelease-script-smoke.js";

/** Finalize before hashing/copying. Never leave a remap or artwork alias pointing
 * at a removed preview; source codes then retain the established unknown behavior. */
export async function applyPrereleaseSmokeResult(database: PreparedCardData, result: PrereleaseSmokeResult): Promise<void> {
  if (result.checked !== database.prereleaseCodes.size) throw new Error("Incomplete prerelease script smoke check");
  const excluded = new Map<number, string[]>();
  for (const card of result.excluded) {
    if (!database.prereleaseCodes.has(card.code)) throw new Error(`Refusing to exclude released/absent card ${card.code}`);
    excluded.set(card.code, card.errors);
  }
  // Merge-time remaps may have repaired an artwork's alias. Family propagation
  // must use that final database, rather than stale source-file metadata.
  const final = new Database(database.path, { readonly: true, fileMustExist: true });
  try {
    const aliases = new Map((final.prepare("SELECT id,alias FROM datas").all() as { id: number; alias: number }[]).map(row => [row.id, row.alias]));
    database.prerelease = database.prerelease.map(card => ({ ...card, alias: aliases.get(card.code) ?? card.alias }));
  } finally { final.close(); }
  // An artwork whose main preview fails cannot survive without its script/main.
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of database.prerelease) if (card.alias && excluded.has(card.alias) && !excluded.has(card.code)) {
      excluded.set(card.code, [`Main artwork ${card.alias} excluded: script error`]); changed = true;
    }
  }
  const findings = database.prerelease.filter(card => excluded.has(card.code)).map(card => ({
    code: card.code, name: card.name, file: card.file, errors: excluded.get(card.code)!,
  })).sort((a, b) => a.code - b.code);
  const suppressedRemaps = Object.entries(database.remaps).filter(([, target]) => excluded.has(target)).map(([old, target]) => ({ old: Number(old), target }));
  if (excluded.size) {
    const db = new Database(database.path);
    try {
      const deleteData = db.prepare("DELETE FROM datas WHERE id=?"), deleteText = db.prepare("DELETE FROM texts WHERE id=?");
      db.transaction(() => { for (const code of excluded.keys()) { deleteText.run(code); deleteData.run(code); } })();
    } finally { db.close(); }
    for (const code of excluded.keys()) { database.prereleaseCodes.delete(code); database.scriptCodes.delete(code); }
    database.prerelease = database.prerelease.filter(card => !excluded.has(card.code));
    for (const { old } of suppressedRemaps) delete database.remaps[old];
    database.bytes = await readFile(database.path);
  }
  const artifact = JSON.parse(database.remapBytes);
  Object.assign(artifact, { remaps: database.remaps, prerelease: database.prerelease,
    scriptSmoke: { checked: result.checked, excluded: findings, suppressedRemaps },
  });
  database.remapBytes = JSON.stringify(artifact, null, 2) + "\n";
  await writeFile(join(dirname(database.path), "card-remaps.json"), database.remapBytes);
}
