// Makes a consistent copy of a SQLite file with the SQLite backup API (better-sqlite3).
//
//   node sqlite-backup.cjs <source.sqlite> <dest.sqlite>
//
// The source is opened read-only and is never written. The copy is made to <dest>.partial, checked with
// quick_check, cleaned for staging, and then renamed to <dest>. Cleaning means: duels that were "active"
// in production become "interrupted" in the copy, so the staging duel server does not resume a game
// that is really running on production.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  console.error(`sqlite-backup: ${message}`);
  process.exit(1);
}

const [src, dest] = process.argv.slice(2);
if (!src || !dest) fail("usage: sqlite-backup.cjs <source.sqlite> <dest.sqlite>");
if (path.resolve(src) === path.resolve(dest)) fail("source and destination are the same file");
if (!fs.existsSync(src)) fail(`source not found: ${src}`);

let Database;
try {
  Database = require("better-sqlite3");
} catch (error) {
  fail(`cannot load better-sqlite3 (${error.message}). Set NODE_PATH to a node_modules directory that has it.`);
}

const partial = `${dest}.partial`;
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${partial}${suffix}`, { force: true });

async function main() {
  const source = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partial);
  } finally {
    source.close();
  }

  const copy = new Database(partial);
  try {
    const check = copy.pragma("quick_check", { simple: true });
    if (check !== "ok") fail(`quick_check of the copy failed: ${check}`);
    const hasDuels = copy.prepare("select 1 from sqlite_master where type = 'table' and name = 'duels'").get();
    let interrupted = 0;
    if (hasDuels) {
      interrupted = copy.prepare("update duels set status = 'interrupted' where status = 'active'").run().changes;
    }
    // Fold the journal into the main file, so the copy is one file.
    copy.pragma("wal_checkpoint(TRUNCATE)");
    console.log(`sqlite-backup: copy is consistent, ${interrupted} active duel(s) set to interrupted in the copy`);
  } finally {
    copy.close();
  }

  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${partial}${suffix}`, { force: true });
  fs.renameSync(partial, dest);
  console.log(`sqlite-backup: wrote ${dest}`);
}

main().catch((error) => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${partial}${suffix}`, { force: true });
  fail(error && error.message ? error.message : String(error));
});
