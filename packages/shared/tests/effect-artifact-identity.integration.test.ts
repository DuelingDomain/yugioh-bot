import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { applyEngineCardRemaps } from "../src/db/card-passcode-remaps.js";
import { artifactDirectory, catalog, database, importedDatabase, importer, pinnedManifest, pinnedTag, roots, sha, sourceHashes } from "./helpers/effect-artifact.js";

vi.setConfig({ testTimeout: 35_000 });

describe("the pinned searchygo artifact and SQLite import", () => {
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

  it("preserves profiles owned by a differently cased nonartifact source", async () => {
    const db = importedDatabase(), importArtifact = await importer();
    db.prepare("UPDATE card_tag_profiles SET source='Searchygo-artifact:manual',plan='Reviewed manual plan' WHERE archetype='Dark World'").run();
    db.prepare("DELETE FROM card_tag_artifact_imports").run();
    expect(importArtifact(db).preservedProfiles).toBe(1);
    expect(db.prepare("SELECT plan,source FROM card_tag_profiles WHERE archetype='Dark World'").get()).toEqual({ plan: "Reviewed manual plan", source: "Searchygo-artifact:manual" });
  });

  it("preserves tags owned by a differently cased nonartifact source", async () => {
    const db = importedDatabase(), importArtifact = await importer();
    db.prepare("UPDATE card_tags SET source='Searchygo-artifact:manual',summary='Reviewed manual summary' WHERE passcode=14558127").run();
    db.prepare("DELETE FROM card_tag_artifact_imports").run();
    expect(importArtifact(db).preservedTags).toBe(1);
    expect(db.prepare("SELECT summary,source FROM card_tags WHERE passcode=14558127").get()).toEqual({ summary: "Reviewed manual summary", source: "Searchygo-artifact:manual" });
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
    const db = importedDatabase();
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
