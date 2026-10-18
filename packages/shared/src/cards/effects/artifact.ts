/** searchygo data by LorenzoWhite, commit 9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c.
 * https://github.com/LorenzoWhite/searchygo — see NOTICE for attribution and permission context. */
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { CardTags, fillDefaults } from "./tags.js";
import { ArchetypeProfile, readProfile } from "./synergy.js";
import { cleanReleaseMonth } from "./releases.js";
import type { Card } from "./card.js";

export const CARD_EFFECT_ARTIFACT_VERSION = "7ce6daa3e4f6251f353b6e41de3bd9ccbf842aa214740dba5d75e21c3a2b828f";
export const CARD_EFFECT_ARTIFACT_MANIFEST_SHA256 = "bf4a51bd586de889d842c2d3e4cf68529ac9e97aff297c87e5ba85279b8e5a75";
export const CARD_EFFECT_ARTIFACT_SCHEMA_VERSION = 1;
export const CARD_EFFECT_ARTIFACT_SOURCE_COMMIT = "9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c";
export const DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY = fileURLToPath(new URL("../../../data/effects/", import.meta.url));
const ARTIFACT_SOURCE_PREFIX = "searchygo-artifact:";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const validPasscode = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
export const CARD_EFFECT_TEXT_NORMALIZATION = "newline-trim-pendulum-first-v1";

/** Normalize actual printed text, never summaries or current catalog metadata. */
export function normalizeCardEffectSourceText(card: Pick<Card, "text" | "pendulumText">): string {
  return [card.pendulumText, card.text].filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map(value => value.replace(/\r\n?/g, "\n").trim()).join("\n");
}
export function hashCardEffectSourceText(card: Pick<Card, "text" | "pendulumText">): string | null {
  const text = normalizeCardEffectSourceText(card);
  return text ? sha(text) : null;
}

export interface CardEffectArtifactImportOptions {
  directory?: string;
  remaps?: ReadonlyMap<number, number>;
  canonicalize?: (passcode: number, name?: string) => number;
  textFor?: (passcode: number) => string | undefined;
}
export interface CardEffectArtifactCoverage {
  catalogCards: number;
  taggedCards: number;
  missingCards: number;
  percent: number;
  missing: { passcode: number; name: string }[];
  artifactOnlyPasscodes: number[];
}
export interface CardEffectArtifactImportReport {
  version: string;
  skipped: boolean;
  /** Canonical records in the pinned artifact, including preserved replacements. */
  tags: number;
  profiles: number;
  preservedTags: number;
  preservedProfiles: number;
  coverage: CardEffectArtifactCoverage;
}
interface ArtifactFile {
  path: string;
  sourcePath: string;
  records: number;
  bytes: number;
  sha256: string;
  gzipBytes: number;
  gzipSha256: string;
}
interface ArtifactManifest {
  formatVersion: number;
  schemaVersion: number;
  source: { repository: string; author: string; commit: string };
  files: { tags: ArtifactFile; profiles: ArtifactFile; popularity: ArtifactFile; sourceHashes: ArtifactFile; releases: ArtifactFile };
  artifactVersion: string;
}
interface TagRow {
  originalPasscode: number;
  passcode: number;
  summary: string;
  rolesJson: string;
  tagsJson: string;
}
interface ReleaseRow { id: number; name: string; aliases: number[]; tcgDate: string | null; ocgDate: string | null; quality: "ok" | "placeholder" | "unknown" }
interface ProfileRow { archetype: string; plan: string; hooksJson: string; cards: number }

function readArtifact(directory: string) {
  const manifestBytes = readFileSync(join(directory, "manifest.json"));
  if (sha(manifestBytes) !== CARD_EFFECT_ARTIFACT_MANIFEST_SHA256) throw new Error("Effect artifact manifest hash does not match the pinned integrity");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ArtifactManifest;
  const { artifactVersion, ...identity } = manifest;
  if (manifest.formatVersion !== 1 || manifest.schemaVersion !== CARD_EFFECT_ARTIFACT_SCHEMA_VERSION ||
      manifest.source.commit !== CARD_EFFECT_ARTIFACT_SOURCE_COMMIT ||
      artifactVersion !== CARD_EFFECT_ARTIFACT_VERSION || artifactVersion !== sha(JSON.stringify(identity))) {
    throw new Error("Effect artifact manifest identity is invalid");
  }
  const content = (kind: "tags" | "profiles" | "popularity" | "sourceHashes" | "releases") => {
    const file = manifest.files[kind];
    const expectedPath = kind === "releases" ? "releases.json.gz" : kind === "sourceHashes" ? "source-hashes.json.gz" : kind === "popularity" ? "popularity.json.gz" : `${kind}.jsonl.gz`;
    if (file.path !== expectedPath) throw new Error(`Invalid effect artifact ${kind} path`);
    const compressed = readFileSync(join(directory, file.path));
    if (compressed.length !== file.gzipBytes || sha(compressed) !== file.gzipSha256) throw new Error(`Effect artifact ${file.path} compressed hash does not match integrity`);
    const bytes = gunzipSync(compressed, { maxOutputLength: file.bytes });
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error(`Effect artifact ${file.path} content hash does not match integrity`);
    return bytes.toString("utf8");
  };
  const lines = (kind: "tags" | "profiles") => {
    const result = content(kind).trim().split("\n");
    if (result.length !== manifest.files[kind].records) throw new Error(`Effect artifact ${kind} record count does not match integrity`);
    return result;
  };
  const popularity = object(JSON.parse(content("popularity")), "effect artifact popularity");
  if (Object.keys(popularity).length !== manifest.files.popularity.records) throw new Error("Effect artifact popularity record count does not match integrity");
  const source = object(JSON.parse(content("sourceHashes")), "effect artifact source hashes");
  if (source.version !== 1 || source.normalization !== CARD_EFFECT_TEXT_NORMALIZATION) throw new Error("Invalid effect artifact source hash normalization");
  const sourceHashes = object(source.hashes, "effect artifact source hash records");
  if (Object.keys(sourceHashes).length !== manifest.files.sourceHashes.records) throw new Error("Effect artifact source hash count does not match integrity");
  for (const [code, hash] of Object.entries(sourceHashes)) {
    if (!/^\d+$/.test(code) || !validPasscode(Number(code)) || (hash !== null && (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)))) {
      throw new Error(`Invalid tagged-source hash for ${code}`);
    }
  }
  const tags = lines("tags");
  const tagIds = new Set(tags.map(line => Number(JSON.parse(line).id)));
  if (tagIds.size !== Object.keys(sourceHashes).length || Object.keys(sourceHashes).some(code => !tagIds.has(Number(code)))) {
    throw new Error("Effect artifact source hashes must match the tagged passcodes exactly");
  }
  const releases = JSON.parse(content("releases")) as ReleaseRow[];
  if (!Array.isArray(releases) || releases.length !== manifest.files.releases.records) throw new Error("Invalid release artifact count");
  const releaseIds = new Set<number>();
  for (const row of releases) {
    if (!row || !validPasscode(row.id) || releaseIds.has(row.id) || typeof row.name !== "string" || !row.name ||
        !Array.isArray(row.aliases) || !row.aliases.every(validPasscode) ||
        !["ok", "placeholder", "unknown"].includes(row.quality) ||
        (row.tcgDate !== null && cleanReleaseMonth(row.tcgDate, "tcg") !== row.tcgDate) ||
        (row.ocgDate !== null && cleanReleaseMonth(row.ocgDate, "ocg") !== row.ocgDate)) throw new Error("Invalid release artifact record");
    releaseIds.add(row.id);
  }
  return { manifest, tags, releases, profiles: lines("profiles"), popularity, sourceHashes: sourceHashes as Record<string, string | null> };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${context}`);
  return value as Record<string, unknown>;
}

function canonicalizer(db: Database.Database, options: CardEffectArtifactImportOptions, releases: ReleaseRow[]) {
  const artworks = new Map((db.prepare("SELECT artwork_id,card_id FROM card_artworks WHERE artwork_id<>card_id").all() as { artwork_id: number; card_id: number }[]).map(row => [row.artwork_id, row.card_id]));
  for (const row of releases) for (const alias of row.aliases) if (!artworks.has(alias)) artworks.set(alias, row.id);
  for (const [old, target] of options.remaps ?? []) {
    if (!validPasscode(old) || !validPasscode(target)) throw new Error("Invalid effect artifact passcode remap");
  }
  const cache = new Map<number, number>();
  return (original: number, name?: string) => {
    const cached = cache.get(original);
    if (cached !== undefined) return cached;
    const seen = new Set<number>();
    let code = original;
    while (true) {
      if (!validPasscode(code)) throw new Error(`Invalid canonical effect passcode for ${original}`);
      if (seen.has(code)) throw new Error(`Cyclic effect artifact identity for ${original}`);
      seen.add(code);
      // A known artwork family is stronger evidence than a legacy engine remap.
      const mapped = artworks.get(code) ?? options.remaps?.get(code) ?? code;
      const next = options.canonicalize?.(mapped, name) ?? mapped;
      if (next === code) {
        cache.set(original, code);
        return code;
      }
      code = next;
    }
  };
}

function parseTags(lines: string[], canonicalize: (passcode: number, name?: string) => number) {
  const tags = new Map<number, TagRow>();
  const seen = new Set<number>();
  for (const [index, line] of lines.entries()) {
    const raw = object(JSON.parse(line), `tag record ${index + 1}`);
    if (!validPasscode(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.model !== "string" || !raw.model.trim()) {
      throw new Error(`Invalid effect artifact tag metadata at line ${index + 1}`);
    }
    if (seen.has(raw.id)) throw new Error(`Duplicate effect artifact passcode ${raw.id}`);
    seen.add(raw.id);
    const validated = CardTags.safeParse(fillDefaults(raw.tags));
    if (!validated.success) throw new Error(`Invalid effect artifact tags for ${raw.id}: ${validated.error.message}`);
    const tag = validated.data, passcode = canonicalize(raw.id, raw.name);
    const current = tags.get(passcode);
    // Direct official tags beat folded prerelease/artwork descriptions. Between
    // aliases, the lower source passcode makes the result independent of order.
    if (!current || raw.id === passcode || (current.originalPasscode !== passcode && raw.id < current.originalPasscode)) {
      tags.set(passcode, { originalPasscode: raw.id, passcode, summary: tag.summary, rolesJson: JSON.stringify(tag.roles), tagsJson: JSON.stringify(tag) });
    }
  }
  return tags;
}

function parseProfiles(lines: string[]) {
  const profiles = new Map<string, ProfileRow>();
  for (const [index, line] of lines.entries()) {
    const raw = object(JSON.parse(line), `profile record ${index + 1}`);
    if (typeof raw.archetype !== "string" || !raw.archetype.trim() || typeof raw.model !== "string" || !raw.model.trim() ||
        typeof raw.cards !== "number" || !Number.isSafeInteger(raw.cards) || raw.cards < 0) {
      throw new Error(`Invalid effect artifact profile metadata at line ${index + 1}`);
    }
    if (profiles.has(raw.archetype)) throw new Error(`Duplicate effect artifact archetype ${raw.archetype}`);
    const validated = ArchetypeProfile.safeParse(raw.profile);
    if (!validated.success) throw new Error(`Invalid effect artifact profile for ${raw.archetype}: ${validated.error.message}`);
    const normalized = readProfile(validated.data, raw.archetype);
    if (!normalized || normalized.dropped.length) throw new Error(`Unusable effect artifact hooks for ${raw.archetype}`);
    const profile = ArchetypeProfile.parse(normalized.profile);
    profiles.set(raw.archetype, { archetype: raw.archetype, cards: raw.cards, plan: profile.plan, hooksJson: JSON.stringify(profile.hooks) });
  }
  return profiles;
}

function parsePopularity(values: Record<string, unknown>, canonicalize: (passcode: number) => number) {
  const result = new Map<number, number>(), official = new Set<number>();
  for (const [raw, views] of Object.entries(values)) {
    const original = Number(raw);
    if (!/^\d+$/.test(raw) || !validPasscode(original) || typeof views !== "number" || !Number.isSafeInteger(views) || views < 0) {
      throw new Error(`Invalid effect artifact popularity for ${raw}`);
    }
    const code = canonicalize(original);
    if (original === code) {
      official.add(code);
      result.set(code, views);
    } else if (!official.has(code)) {
      result.set(code, Math.max(result.get(code) ?? 0, views));
    }
  }
  return result;
}

/** Independent preparation/install verification; does not open or mutate SQLite. */
export function verifyCardEffectArtifact(directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY): { version: string; tags: number; profiles: number } {
  const artifact = readArtifact(directory);
  const tags = parseTags(artifact.tags, code => code), profiles = parseProfiles(artifact.profiles);
  parsePopularity(artifact.popularity, code => code);
  return { version: artifact.manifest.artifactVersion, tags: tags.size, profiles: profiles.size };
}

function coverage(db: Database.Database, canonicalize: (passcode: number) => number, artifactTags: ReadonlyMap<number, TagRow>): CardEffectArtifactCoverage {
  const catalog = new Map<number, { passcode: number; name: string }>();
  const rows = db.prepare(`SELECT c.ygoprodeck_id,c.name FROM card_catalog c
    WHERE NOT EXISTS (SELECT 1 FROM card_artworks a WHERE a.artwork_id=c.ygoprodeck_id AND a.card_id<>a.artwork_id)
    ORDER BY c.ygoprodeck_id`).all() as { ygoprodeck_id: number; name: string }[];
  for (const row of rows) {
    const passcode = canonicalize(row.ygoprodeck_id);
    if (!catalog.has(passcode) || row.ygoprodeck_id === passcode) catalog.set(passcode, { passcode, name: row.name });
  }
  const tagged = new Set((db.prepare("SELECT passcode FROM card_tags").all() as { passcode: number }[]).map(row => row.passcode));
  const missing = [...catalog.values()].filter(row => !tagged.has(row.passcode)).sort((a, b) => a.passcode - b.passcode);
  const taggedCards = catalog.size - missing.length;
  return {
    catalogCards: catalog.size,
    taggedCards,
    missingCards: missing.length,
    percent: catalog.size ? taggedCards / catalog.size * 100 : 0,
    missing,
    artifactOnlyPasscodes: [...artifactTags.keys()].filter(passcode => !catalog.has(passcode)).sort((a, b) => a - b),
  };
}

/** Verify the pinned files, then import under one immediate SQLite transaction.
 * The directory override must contain this exact pin. No engine files or engine
 * version state are read or written. Batch/manual replacements retain ownership.
 */
export function importCardEffectArtifact(db: Database.Database, options: CardEffectArtifactImportOptions = {}): CardEffectArtifactImportReport {
  const artifact = readArtifact(options.directory ?? DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY);
  return db.transaction(() => {
    const canonicalize = canonicalizer(db, options, artifact.releases);
    const tags = parseTags(artifact.tags, canonicalize), profiles = parseProfiles(artifact.profiles);
    const popularity = parsePopularity(artifact.popularity, canonicalize);
    const existingTags = new Map((db.prepare("SELECT passcode,source FROM card_tags").all() as { passcode: number; source: string }[]).map(row => [row.passcode, row.source]));
    const existingProfiles = new Map((db.prepare("SELECT archetype,source FROM card_tag_profiles").all() as { archetype: string; source: string }[]).map(row => [row.archetype, row.source]));
    const preservedTags = [...tags.keys()].filter(code => existingTags.has(code) && !existingTags.get(code)!.startsWith(ARTIFACT_SOURCE_PREFIX)).length;
    const preservedProfiles = [...profiles.keys()].filter(name => existingProfiles.has(name) && !existingProfiles.get(name)!.startsWith(ARTIFACT_SOURCE_PREFIX)).length;
    const imported = db.prepare("SELECT manifest_hash FROM card_tag_artifact_imports WHERE artifact_version=?").get(artifact.manifest.artifactVersion) as { manifest_hash: string } | undefined;
    if (imported && imported.manifest_hash !== CARD_EFFECT_ARTIFACT_MANIFEST_SHA256) throw new Error("Stored effect artifact manifest hash is invalid");
    if (!imported) {
      const source = `${ARTIFACT_SOURCE_PREFIX}${artifact.manifest.artifactVersion}`;
      const insertTag = db.prepare(`INSERT INTO card_tags
        (passcode,summary,roles_json,tags_json,popularity,text_hash,source,tagged_at,schema_version)
        VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(passcode) DO UPDATE SET summary=excluded.summary,roles_json=excluded.roles_json,
          tags_json=excluded.tags_json,popularity=excluded.popularity,text_hash=excluded.text_hash,source=excluded.source,
          tagged_at=excluded.tagged_at,schema_version=excluded.schema_version
        WHERE card_tags.source LIKE 'searchygo-artifact:%'`);
      for (const tag of tags.values()) {
        if (existingTags.has(tag.passcode) && !existingTags.get(tag.passcode)!.startsWith(ARTIFACT_SOURCE_PREFIX)) continue;
        // Preserve the text the tags describe. Current engine/catalog text must
        // not make old tags appear freshly generated. textFor stays in the API
        // for callers compiled against the original foundation contract.
        const textHash = artifact.sourceHashes[tag.originalPasscode] ?? null;
        insertTag.run(tag.passcode, tag.summary, tag.rolesJson, tag.tagsJson, popularity.get(tag.passcode) ?? 0, textHash, source, artifact.manifest.schemaVersion);
      }
      const releases = new Map<number, ReleaseRow>();
      for (const row of artifact.releases) {
        const passcode = canonicalize(row.id, row.name), prior = releases.get(passcode);
        if (!prior || row.id === passcode || (prior.id !== passcode && row.id < prior.id)) releases.set(passcode, row);
      }
      const insertRelease = db.prepare(`INSERT INTO card_release(passcode,tcg_date,ocg_date,quality,source_version) VALUES(?,?,?,?,?)
        ON CONFLICT(passcode) DO UPDATE SET tcg_date=excluded.tcg_date,ocg_date=excluded.ocg_date,quality=excluded.quality,source_version=excluded.source_version`);
      for (const [passcode, row] of releases) insertRelease.run(passcode, row.tcgDate, row.ocgDate, row.quality, artifact.manifest.artifactVersion);
      const insertProfile = db.prepare(`INSERT INTO card_tag_profiles
        (archetype,plan,hooks_json,source,profiled_at,schema_version,cards)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP,?,?)
        ON CONFLICT(archetype) DO UPDATE SET plan=excluded.plan,hooks_json=excluded.hooks_json,
          source=excluded.source,profiled_at=excluded.profiled_at,schema_version=excluded.schema_version,cards=excluded.cards
        WHERE card_tag_profiles.source LIKE 'searchygo-artifact:%'`);
      for (const profile of profiles.values()) {
        if (existingProfiles.has(profile.archetype) && !existingProfiles.get(profile.archetype)!.startsWith(ARTIFACT_SOURCE_PREFIX)) continue;
        insertProfile.run(profile.archetype, profile.plan, profile.hooksJson, source, artifact.manifest.schemaVersion, profile.cards);
      }
      db.prepare(`INSERT INTO card_tag_artifact_imports
        (artifact_version,manifest_hash,schema_version,source_commit,tags,profiles) VALUES(?,?,?,?,?,?)`)
        .run(artifact.manifest.artifactVersion, CARD_EFFECT_ARTIFACT_MANIFEST_SHA256, artifact.manifest.schemaVersion, artifact.manifest.source.commit, tags.size, profiles.size);
    }
    return { version: artifact.manifest.artifactVersion, skipped: Boolean(imported), tags: tags.size, profiles: profiles.size,
      preservedTags, preservedProfiles, coverage: coverage(db, canonicalize, tags) };
  }).immediate();
}
