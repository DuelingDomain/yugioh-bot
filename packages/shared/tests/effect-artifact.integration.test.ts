import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import * as artifactStreams from "../src/cards/effects/artifact-stream.js";
import { streamArtifactLines } from "../src/cards/effects/artifact-stream.js";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { ArchetypeProfile, readProfile } from "../src/cards/effects/synergy.js";
import { artifactDirectory, copyArtifact, database, importedDatabase, importer, pinnedManifest, roots, sha } from "./helpers/effect-artifact.js";

// Each test imports the full pinned artifact; a loaded CI runner needs more than the 5 s default.
vi.setConfig({ testTimeout: 35_000 });

describe("the pinned searchygo artifact and SQLite import", () => {
  it("imports and reopens the real file-backed pin within a bounded JavaScript heap", () => {
    const directory = mkdtempSync(join(tmpdir(), "effect-artifact-heap-"));
    roots.push(directory);
    const artifactModule = new URL("../src/cards/effects/artifact.ts", import.meta.url).href;
    const connectionModule = new URL("../src/db/connection.ts", import.meta.url).href;
    const report = join(directory, "import-result.json");
    const script = `
      import { importCardEffectArtifact } from ${JSON.stringify(artifactModule)};
      import { openDatabase } from ${JSON.stringify(connectionModule)};
      import { readdirSync, writeFileSync } from 'node:fs';
      const path = ${JSON.stringify(join(directory, "cards.sqlite"))};
      let db = openDatabase(path);
      const first = importCardEffectArtifact(db);
      db.close();
      db = openDatabase(path);
      const reused = importCardEffectArtifact(db);
      const stored = db.prepare('SELECT COUNT(*) AS count FROM card_tags').get().count;
      db.close();
      const leftovers = readdirSync(${JSON.stringify(directory)}).filter(name => name.startsWith('effect-artifact-stream-'));
      writeFileSync(${JSON.stringify(report)}, JSON.stringify({ first: first.skipped, reused: reused.skipped, stored, tags: first.tags, leftovers }));
    `;
    execFileSync("prlimit", ["--core=0", process.execPath, "--max-old-space-size=48", "--import", "tsx", "--input-type=module", "-e", script], { timeout: 30_000, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TMPDIR: directory } });
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ first: false, reused: true, stored: pinnedManifest().files.tags.records, tags: pinnedManifest().files.tags.records, leftovers: [] });
  }, 35_000);
  it("verifies the shipped pin independently of SQLite and refuses corrupted source hashes", async () => {
    const { verifyCardEffectArtifact } = await import("../src/cards/effects/artifact.js");
    const manifest = pinnedManifest();
    expect(verifyCardEffectArtifact()).toMatchObject({ tags: manifest.files.tags.records, profiles: manifest.files.profiles.records });
    const directory = copyArtifact();
    writeFileSync(join(directory, "source-hashes.json.gz"), "corrupt");
    expect(() => verifyCardEffectArtifact(directory)).toThrow(/hash|integrity/i);
  });
  it("migrates independent tag/profile state without a catalog foreign key", () => {
    const db = database();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'card_tag%' ORDER BY name").all();
    expect(tables).toEqual([{ name: "card_tag_artifact_imports" }, { name: "card_tag_profiles" }, { name: "card_tags" }]);
    expect(db.pragma("foreign_key_list(card_tags)")).toEqual([]);
    const manifest = JSON.parse(readFileSync(join(artifactDirectory, "manifest.json"), "utf8"));
    expect(gunzipSync(readFileSync(join(artifactDirectory, "tags.jsonl.gz"))).toString("utf8").trim().split("\n")).toHaveLength(manifest.files.tags.records);
  });

  it("stores every pinned tag and profile with exactly the verified schema fields and normalized defaults", async () => {
    const db = database(), importArtifact = await importer();
    importArtifact(db);
    const stored = db.prepare("SELECT tags_json FROM card_tags WHERE passcode=?");
    const file = pinnedManifest().files.tags;
    streamArtifactLines(join(artifactDirectory, file.path), file, line => {
      const raw = JSON.parse(line), normalized = CardTags.parse(fillDefaults(raw.tags));
      expect(raw.tags).toEqual(normalized);
      const row = stored.get(raw.id) as { tags_json: string };
      expect(JSON.parse(row.tags_json)).toEqual(normalized);
    });
    const profiles = pinnedManifest().files.profiles;
    const storedProfile = db.prepare("SELECT plan,hooks_json FROM card_tag_profiles WHERE archetype=?");
    streamArtifactLines(join(artifactDirectory, profiles.path), profiles, line => {
      const raw = JSON.parse(line), normalized = ArchetypeProfile.parse(readProfile(ArchetypeProfile.parse(raw.profile), raw.archetype)!.profile);
      expect(raw.profile).toEqual(normalized);
      const row = storedProfile.get(raw.archetype) as { plan: string; hooks_json: string };
      expect({ plan: row.plan, hooks: JSON.parse(row.hooks_json) }).toEqual(normalized);
    });
  });

  it.each(["tags.jsonl.gz", "profiles.jsonl.gz", "popularity.json.gz", "source-hashes.json.gz", "releases.json.gz", "manifest.json"])("rejects corrupt %s before writes, including an already imported pin", async file => {
    const db = importedDatabase(), importArtifact = await importer();
    const directory = copyArtifact();
    const changes = db.prepare("SELECT total_changes()").pluck();
    const before = changes.get();
    writeFileSync(join(directory, file), "corrupt");
    expect(() => importArtifact(db, { directory })).toThrow(/integrity|hash|manifest/i);
    expect(changes.get()).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tags").get()).toEqual({ count: pinnedManifest().files.tags.records });
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tag_artifact_imports").get()).toEqual({ count: 1 });
  });

  it("rolls back every row when canonicalization fails after import starts", async () => {
    const db = database(), importArtifact = await importer();
    expect(() => importArtifact(db, { canonicalize: () => { throw new Error("Identity unavailable"); } })).toThrow("Identity unavailable");
    for (const table of ["card_tags", "card_tag_profiles", "card_tag_artifact_imports"]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  it("rejects cyclic identity callbacks and passcode remaps atomically", async () => {
    const db = database(), importArtifact = await importer();
    expect(() => importArtifact(db, { remaps: new Map([[14558127, 55144522], [55144522, 14558127]]) })).toThrow(/cyclic/i);
    expect(() => importArtifact(db, { canonicalize: code => code === 14558127 ? 55144522 : code === 55144522 ? 14558127 : code })).toThrow(/cyclic/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tags").get()).toEqual({ count: 0 });
  });

  it("rolls back tags, profiles and import state together on a SQLite write failure", async () => {
    const db = database(), importArtifact = await importer();
    db.exec(`CREATE TRIGGER fail_profile_import BEFORE INSERT ON card_tag_profiles
      BEGIN SELECT RAISE(ABORT,'Profile storage unavailable'); END`);
    expect(() => importArtifact(db)).toThrow("Profile storage unavailable");
    for (const table of ["card_tags", "card_tag_profiles", "card_tag_artifact_imports"]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  it("rejects a forged self-consistent manifest instead of trusting directory input", async () => {
    const db = database(), importArtifact = await importer(), directory = copyArtifact();
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    manifest.source.commit = "0".repeat(40);
    const { artifactVersion: _version, ...identity } = manifest;
    manifest.artifactVersion = sha(JSON.stringify(identity));
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    expect(() => importArtifact(db, { directory })).toThrow(/manifest.*hash|integrity/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tags").get()).toEqual({ count: 0 });
  });

  it("rolls back streamed tags when a later artifact file is corrupt", async () => {
    const db = database(), importArtifact = await importer(), directory = copyArtifact();
    writeFileSync(join(directory, "profiles.jsonl.gz"), "corrupt");
    expect(() => importArtifact(db, { directory })).toThrow(/hash|integrity/i);
    for (const table of ["card_tags", "card_tag_profiles", "card_release", "card_tag_artifact_imports"]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    expect(importArtifact(db).skipped).toBe(false);
  });

});

it("verifies all artifact files before the first write lock, on first and repeat boots", async () => {
  const db = database(), importArtifact = await importer();
  const streams = vi.spyOn(artifactStreams, 'prepareArtifactFile');
  const original = db.transaction.bind(db);
  let transactionStarted = false;
  const transaction = vi.spyOn(db, 'transaction').mockImplementation(((work: (...args: any[]) => any) => {
    transactionStarted = true;
    expect(streams.mock.calls.length).toBeGreaterThanOrEqual(5);
    return original(work);
  }) as typeof db.transaction);
  try {
    importArtifact(db);
    expect(transactionStarted).toBe(true);
    streams.mockClear(); transactionStarted = false;
    importArtifact(db);
    expect(transactionStarted).toBe(true);
  } finally { transaction.mockRestore(); streams.mockRestore(); }
});
