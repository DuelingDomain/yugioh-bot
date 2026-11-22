import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type Database from "better-sqlite3";
import { afterEach } from "vitest";
import { openDatabase } from "../../src/db/connection.js";
import { migrate } from "../../src/db/schema.js";
import { importCardEffectArtifact } from "../../src/cards/effects/artifact.js";
import { memoryDatabaseFixture } from "./memory-database.js";

export const artifactDirectory = fileURLToPath(new URL("../../data/effects/", import.meta.url));
export const roots: string[] = [];
const databases: Database.Database[] = [];
export const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const sourceHashes = () => JSON.parse(gunzipSync(readFileSync(join(artifactDirectory, "source-hashes.json.gz"))).toString("utf8")).hashes;
export const pinnedManifest = () => JSON.parse(readFileSync(join(artifactDirectory, "manifest.json"), "utf8"));
export const pinnedTag = (id: number) => gunzipSync(readFileSync(join(artifactDirectory, "tags.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line)).find(row => row.id === id).tags;
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  roots.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});
export function database() {
  const db = openDatabase(":memory:");
  databases.push(db);
  return db;
}
const cloneImportedDatabase = memoryDatabaseFixture(db => {
  migrate(db);
  importCardEffectArtifact(db);
});
export function importedDatabase() {
  const db = cloneImportedDatabase();
  databases.push(db);
  return db;
}
export function copyArtifact() {
  const directory = mkdtempSync(join(tmpdir(), "effect-artifact-"));
  roots.push(directory);
  cpSync(artifactDirectory, directory, { recursive: true });
  return directory;
}
export function catalog(db: Database.Database, passcode: number, name: string, text: string | null = null) {
  db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,'Effect Monster','effect',?,'image','small','[]','now')`).run(passcode, name, text);
}
export async function importer() {
  return (await import("../../src/cards/effects/artifact.js")).importCardEffectArtifact;
}
