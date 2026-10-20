import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { applyEngineCardRemaps } from "../src/db/card-passcode-remaps.js";
import * as artifactStreams from "../src/cards/effects/artifact-stream.js";
import { streamArtifactLines } from "../src/cards/effects/artifact-stream.js";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { ArchetypeProfile, readProfile } from "../src/cards/effects/synergy.js";

const artifactDirectory = fileURLToPath(new URL("../data/effects/", import.meta.url));
const roots: string[] = [];
const databases: Database.Database[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sourceHashes = () => JSON.parse(gunzipSync(readFileSync(join(artifactDirectory, "source-hashes.json.gz"))).toString("utf8")).hashes;
const pinnedManifest = () => JSON.parse(readFileSync(join(artifactDirectory, "manifest.json"), "utf8"));
const pinnedTag = (id: number) => gunzipSync(readFileSync(join(artifactDirectory, "tags.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line)).find(row => row.id === id).tags;
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  roots.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});
function database() {
  const db = openDatabase(":memory:");
  databases.push(db);
  return db;
}
function copyArtifact() {
  const directory = mkdtempSync(join(tmpdir(), "effect-artifact-"));
  roots.push(directory);
  cpSync(artifactDirectory, directory, { recursive: true });
  return directory;
}
function catalog(db: Database.Database, passcode: number, name: string, text: string | null = null) {
  db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,'Effect Monster','effect',?,'image','small','[]','now')`).run(passcode, name, text);
}
async function importer() {
  return (await import("../src/cards/effects/artifact.js")).importCardEffectArtifact;
}

describe("the pinned searchygo artifact and SQLite import", () => {
  it("imports and reopens the real file-backed pin within a bounded JavaScript heap", () => {
    const directory = mkdtempSync(join(tmpdir(), "effect-artifact-heap-"));
    roots.push(directory);
    const artifactModule = new URL("../src/cards/effects/artifact.ts", import.meta.url).href;
    const connectionModule = new URL("../src/db/connection.ts", import.meta.url).href;
    const script = `
      import { importCardEffectArtifact } from ${JSON.stringify(artifactModule)};
      import { openDatabase } from ${JSON.stringify(connectionModule)};
      import { readdirSync } from 'node:fs';
      const path = ${JSON.stringify(join(directory, "cards.sqlite"))};
      let db = openDatabase(path);
      const first = importCardEffectArtifact(db);
      db.close();
      db = openDatabase(path);
      const reused = importCardEffectArtifact(db);
      const stored = db.prepare('SELECT COUNT(*) AS count FROM card_tags').get().count;
      db.close();
      const leftovers = readdirSync(${JSON.stringify(directory)}).filter(name => name.startsWith('effect-artifact-stream-'));
      console.log(JSON.stringify({ first: first.skipped, reused: reused.skipped, stored, tags: first.tags, leftovers }));
    `;
    const output = execFileSync("prlimit", ["--core=0", process.execPath, "--max-old-space-size=48", "--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TMPDIR: directory } });
    expect(JSON.parse(output)).toMatchObject({ first: false, reused: true, stored: pinnedManifest().files.tags.records, tags: pinnedManifest().files.tags.records, leftovers: [] });
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

  it("imports real summaries/profiles, hashes actual text and reports canonical catalog coverage", async () => {
    const db = database(), importArtifact = await importer();
    catalog(db, 14558127, "Ash Blossom & Joyous Spring", "Actual printed card text");
    catalog(db, 99999999, "Uncovered card");
    const report = importArtifact(db);
    expect(report.skipped).toBe(false);
    expect(report.tags).toBeGreaterThan(13_000);
    expect(report.profiles).toBeGreaterThan(400);
    expect(report.coverage).toMatchObject({ catalogCards: 2, taggedCards: 1, missingCards: 1, percent: 50, missing: [{ passcode: 99999999, name: "Uncovered card" }] });
    expect(report.coverage.artifactOnlyPasscodes.length).toBeGreaterThan(13_000);
    const row = db.prepare("SELECT summary,roles_json,tags_json,text_hash,source,schema_version FROM card_tags WHERE passcode=14558127").get() as Record<string, string | number>;
    expect(row.summary).toBe(pinnedTag(14558127).summary);
    expect(JSON.parse(String(row.roles_json))).toContain("hand_trap");
    expect(JSON.parse(String(row.tags_json)).summary).toBe(row.summary);
    expect(row.text_hash).toBe(sourceHashes()[14558127]);
    expect(row.text_hash).not.toBe(sha("Actual printed card text"));
    expect(row.source).toBe(`searchygo-artifact:${report.version}`);
    expect(row.schema_version).toBe(1);
    const popularity = JSON.parse(gunzipSync(readFileSync(join(artifactDirectory, "popularity.json.gz"))).toString("utf8"));
    expect(popularity[14558127]).toBeGreaterThan(0);
    expect(db.prepare("SELECT popularity FROM card_tags WHERE passcode=14558127").get()).toEqual({ popularity: popularity[14558127] });
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tags WHERE text_hash IS NULL").get()).toEqual({ count: Object.values(sourceHashes()).filter(hash => hash === null).length });
    expect(db.prepare("SELECT text_hash FROM card_tags WHERE passcode=101402101").get()).toEqual({ text_hash: sourceHashes()[101402101] });
    const profile = db.prepare("SELECT plan,hooks_json,cards FROM card_tag_profiles WHERE archetype='Dark World'").get() as { plan: string; hooks_json: string; cards: number };
    const pinnedProfile = gunzipSync(readFileSync(join(artifactDirectory, "profiles.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line)).find(row => row.archetype === "Dark World");
    expect(profile.plan).toBe(pinnedProfile.profile.plan);
    expect(JSON.parse(profile.hooks_json)).not.toHaveLength(0);
    expect(profile.cards).toBe(pinnedProfile.cards);
    expect(db.prepare("SELECT artifact_version FROM card_tag_artifact_imports").get()).toEqual({ artifact_version: report.version });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("imports month precision release dates, removes placeholders and follows canonical identity", async () => {
    const db = database(), importArtifact = await importer();
    catalog(db, 46986414, "Dark Magician");
    catalog(db, 46986420, "Dark Magician");
    db.prepare("INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main) VALUES(46986414,46986420,'art','small',0)").run();
    importArtifact(db, { canonicalize: (code, name) => name === "Monster Reborn" ? 83764718 : code });
    expect(db.prepare("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=97268402").get()).toEqual({ tcg_date: "2010-08", ocg_date: "2010-04" });
    const releases = JSON.parse(gunzipSync(readFileSync(join(artifactDirectory, "releases.json.gz"))).toString());
    const formerlyPlaceholder = releases.find((row: { id: number }) => row.id === 70781052);
    expect(db.prepare("SELECT tcg_date,quality FROM card_release WHERE passcode=70781052").get()).toEqual({ tcg_date: formerlyPlaceholder.tcgDate, quality: formerlyPlaceholder.quality });
    expect(db.prepare("SELECT passcode FROM card_release WHERE passcode=83764718").get()).toEqual({ passcode: 83764718 });
    expect(db.prepare("SELECT tcg_date FROM card_release WHERE passcode=46986414").get()).toEqual({ tcg_date: "2002-03" });
    expect(db.prepare("SELECT passcode FROM card_release WHERE passcode=46986420").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_release").get()).toEqual({ count: pinnedManifest().files.releases.records });
  });

  it("is idempotent and preserves later Batch tags, including when replacing an older pin", async () => {
    const db = database(), importArtifact = await importer();
    const first = importArtifact(db);
    db.prepare("UPDATE card_tags SET summary='New printed text',source='haiku-batch',text_hash=? WHERE passcode=14558127").run(sha("New printed text"));
    db.prepare("UPDATE card_tag_profiles SET plan='Updated profile',source='manual' WHERE archetype='Dark World'").run();
    expect(importArtifact(db)).toMatchObject({ version: first.version, skipped: true });
    db.prepare("UPDATE card_tag_artifact_imports SET artifact_version='older-pinned-version'").run();
    const next = importArtifact(db);
    expect(next).toMatchObject({ skipped: false, preservedTags: 1, preservedProfiles: 1 });
    expect(db.prepare("SELECT summary,source,text_hash FROM card_tags WHERE passcode=14558127").get()).toEqual({ summary: "New printed text", source: "haiku-batch", text_hash: sha("New printed text") });
    expect(db.prepare("SELECT plan,source FROM card_tag_profiles WHERE archetype='Dark World'").get()).toEqual({ plan: "Updated profile", source: "manual" });
  });

  it("backfills legacy import memberships without rewriting rows and excludes unrelated manual records", async () => {
    const db = database(), importArtifact = await importer();
    const first = importArtifact(db);
    db.exec(`UPDATE card_tag_artifact_imports SET passcodes_json=NULL,archetypes_json=NULL;
      UPDATE card_tags SET source='manual' WHERE passcode=14558127;
      UPDATE card_tag_profiles SET source='manual' WHERE archetype='Dark World';
      INSERT INTO card_tags(passcode,summary,roles_json,tags_json,popularity,source,schema_version)
        SELECT 42,summary,roles_json,tags_json,0,'manual',schema_version FROM card_tags WHERE passcode=14558127;
      INSERT INTO card_tag_profiles(archetype,plan,hooks_json,source,schema_version,cards)
        SELECT 'Unrelated manual archetype',plan,hooks_json,'manual',schema_version,cards FROM card_tag_profiles WHERE archetype='Dark World';
      CREATE TRIGGER no_repeat_tag_update BEFORE UPDATE ON card_tags BEGIN SELECT RAISE(ABORT,'Repeated tag write'); END;
      CREATE TRIGGER no_repeat_profile_update BEFORE UPDATE ON card_tag_profiles BEGIN SELECT RAISE(ABORT,'Repeated profile write'); END;`);
    for (let i = 0; i < 2; i++) {
      expect(importArtifact(db)).toMatchObject({ skipped: true, tags: first.tags, profiles: first.profiles, preservedTags: 1, preservedProfiles: 1 });
    }
    const row = db.prepare("SELECT passcodes_json,archetypes_json FROM card_tag_artifact_imports").get() as { passcodes_json: string; archetypes_json: string };
    expect(JSON.parse(row.passcodes_json)).toHaveLength(first.tags);
    expect(JSON.parse(row.archetypes_json)).toHaveLength(first.profiles);
  });

  it("recomputes cached membership from original passcodes and names when identity resolution changes", async () => {
    const db = database(), importArtifact = await importer();
    const first = importArtifact(db, { canonicalize: (code, name) => code === 14558127 && name === "Ash Blossom & Joyous Spring" ? 4000000001 : code });
    db.exec(`INSERT INTO card_tags(passcode,summary,roles_json,tags_json,popularity,source,schema_version)
      SELECT 4000000002,summary,roles_json,tags_json,0,'manual',schema_version FROM card_tags WHERE passcode=4000000001`);
    const options = { canonicalize: (code: number, name?: string) => code === 14558127 && name === "Ash Blossom & Joyous Spring" ? 4000000002 : code };
    const cached = importArtifact(db, options);
    expect(cached).toMatchObject({ skipped: true, tags: first.tags, preservedTags: 1 });
    expect(cached.coverage.artifactOnlyPasscodes).toContain(4000000002);
    expect(cached.coverage.artifactOnlyPasscodes).not.toContain(4000000001);
    db.exec("UPDATE card_tag_artifact_imports SET passcodes_json=NULL,archetypes_json=NULL");
    expect(importArtifact(db, options)).toEqual(cached);
  });

  it("folds artworks and chained remaps, chooses direct official tags and hashes callback text", async () => {
    const db = database(), importArtifact = await importer();
    catalog(db, 14558127, "Ash Blossom & Joyous Spring");
    catalog(db, 14558128, "Ash alternate art");
    catalog(db, 55144522, "Pot of Greed");
    db.prepare("INSERT INTO card_artworks(card_id,artwork_id,image_url,image_url_small,is_main,source) VALUES(14558127,14558128,'art','small',0,'api')").run();
    const report = importArtifact(db, {
      remaps: new Map([[14558127, 100000001], [100000001, 55144522]]),
      canonicalize: code => code === 23434538 ? 14558128 : code,
      textFor: code => code === 55144522 ? "Engine official text" : undefined,
    });
    expect(report.coverage).toMatchObject({ catalogCards: 1, taggedCards: 1, missingCards: 0, percent: 100 });
    expect(db.prepare("SELECT passcode FROM card_tags WHERE passcode IN (14558127,14558128,100000001,23434538)").all()).toEqual([]);
    const winner = db.prepare("SELECT summary,text_hash FROM card_tags WHERE passcode=55144522").get() as { summary: string; text_hash: string };
    expect(winner.summary).not.toContain("Hand trap");
    expect(winner.text_hash).toBe(sourceHashes()[55144522]);
    expect(winner.text_hash).not.toBe(sha("Engine official text"));
  });

  it.each(["tags.jsonl.gz", "profiles.jsonl.gz", "popularity.json.gz", "source-hashes.json.gz", "releases.json.gz", "manifest.json"])("rejects corrupt %s before writes, including an already imported pin", async file => {
    const db = database(), importArtifact = await importer();
    const first = importArtifact(db), directory = copyArtifact();
    writeFileSync(join(directory, file), "corrupt");
    expect(() => importArtifact(db, { directory })).toThrow(/integrity|hash|manifest/i);
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tags").get()).toEqual({ count: first.tags });
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

  it("preserves profiles owned by a differently cased nonartifact source", async () => {
    const db = database(), importArtifact = await importer();
    importArtifact(db);
    db.prepare("UPDATE card_tag_profiles SET source='Searchygo-artifact:manual',plan='Reviewed manual plan' WHERE archetype='Dark World'").run();
    db.prepare("DELETE FROM card_tag_artifact_imports").run();
    expect(importArtifact(db).preservedProfiles).toBe(1);
    expect(db.prepare("SELECT plan,source FROM card_tag_profiles WHERE archetype='Dark World'").get()).toEqual({ plan: "Reviewed manual plan", source: "Searchygo-artifact:manual" });
  });

  it("preserves tags owned by a differently cased nonartifact source", async () => {
    const db = database(), importArtifact = await importer();
    importArtifact(db);
    db.prepare("UPDATE card_tags SET source='Searchygo-artifact:manual',summary='Reviewed manual summary' WHERE passcode=14558127").run();
    db.prepare("DELETE FROM card_tag_artifact_imports").run();
    expect(importArtifact(db).preservedTags).toBe(1);
    expect(db.prepare("SELECT summary,source FROM card_tags WHERE passcode=14558127").get()).toEqual({ summary: "Reviewed manual summary", source: "Searchygo-artifact:manual" });
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

  it("passes the source name to explicit missing-ID bridges without rewriting source metadata", async () => {
    const db = database(), importArtifact = await importer();
    catalog(db, 83764718, "Monster Reborn");
    importArtifact(db, { canonicalize: (code, name) => name === "Monster Reborn" ? 83764718 : code });
    const row = db.prepare("SELECT summary,text_hash FROM card_tags WHERE passcode=83764718").get() as { summary: string; text_hash: string };
    expect(row.summary).toMatch(/Special Summon|revive/i);
    expect(row.text_hash).toBe(sourceHashes()[83764719]);
    expect(db.prepare("SELECT passcode FROM card_tags WHERE passcode=83764719").all()).toEqual([]);
    expect(db.prepare("SELECT ygoprodeck_id,name FROM card_catalog").all()).toEqual([{ ygoprodeck_id: 83764718, name: "Monster Reborn" }]);
  });

  it("carries real imported tags in engine migrations and retains an existing official target", async () => {
    const db = database(), importArtifact = await importer();
    importArtifact(db);
    const directory = mkdtempSync(join(tmpdir(), "effect-remap-"));
    roots.push(directory);
    const bytes = JSON.stringify({ version: 1, remaps: { 14558127: 55144522, 23434538: 99999998 } });
    writeFileSync(join(directory, "card-remaps.json"), bytes);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "independent-engine-version", integrity: { cardRemaps: sha(bytes) } }));
    const engine = new Database(join(directory, "cards.cdb"));
    engine.exec("CREATE TABLE datas(id INTEGER PRIMARY KEY,alias INTEGER DEFAULT 0,type INTEGER DEFAULT 0); INSERT INTO datas(id) VALUES(55144522),(99999998)");
    engine.close();
    const official = db.prepare("SELECT * FROM card_tags WHERE passcode=55144522").get();
    const movedRelease = db.prepare("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=23434538").get();
    const moved = db.prepare("SELECT summary FROM card_tags WHERE passcode=23434538").get();
    expect(moved).toBeDefined();
    applyEngineCardRemaps(db, directory);
    expect(db.prepare("SELECT * FROM card_tags WHERE passcode=55144522").get()).toEqual(official);
    expect(db.prepare("SELECT summary FROM card_tags WHERE passcode=99999998").get()).toEqual(moved);
    expect(db.prepare("SELECT passcode FROM card_tags WHERE passcode IN (14558127,23434538)").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM card_tag_artifact_imports").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=99999998").get()).toEqual(movedRelease);
    expect(db.prepare("SELECT passcode FROM card_release WHERE passcode IN (14558127,23434538)").all()).toEqual([]);
    expect(applyEngineCardRemaps(db, directory).skipped).toBe(true);
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
