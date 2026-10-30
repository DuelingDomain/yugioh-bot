/** searchygo data by LorenzoWhite, commit 9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c.
 * https://github.com/LorenzoWhite/searchygo — see NOTICE for attribution and permission context. */
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareArtifactFile, streamArtifactArray, streamArtifactFile, streamArtifactLines, type PreparedArtifactFile } from "./artifact-stream.js";
import { CardTags, fillDefaults } from "./tags.js";
import { ArchetypeProfile, readProfile } from "./synergy.js";
import { cleanReleaseMonth } from "./releases.js";
import type { Card } from "./card.js";

export const CARD_EFFECT_ARTIFACT_VERSION = "011522cdff6c3383d5816b91dd18791317a63bc51cd253349e98016f58eabd97";
export const CARD_EFFECT_ARTIFACT_MANIFEST_SHA256 = "a5d3ac4f46d80b3b5d56d0956995b1be6084065a4c9c5009683a2001ed46a0d0";
export const CARD_EFFECT_ARTIFACT_SCHEMA_VERSION = 1;
export const CARD_EFFECT_ARTIFACT_SOURCE_COMMIT = "9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c";
export const DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/effects");
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
type ReleaseRows = (consume: (row: ReleaseRow) => void) => void;

function readManifest(directory: string): ArtifactManifest {
  const manifestBytes = readFileSync(join(directory, "manifest.json"));
  if (sha(manifestBytes) !== CARD_EFFECT_ARTIFACT_MANIFEST_SHA256) throw new Error("Effect artifact manifest hash does not match the pinned integrity");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ArtifactManifest;
  const { artifactVersion, ...identity } = manifest;
  if (manifest.formatVersion !== 1 || manifest.schemaVersion !== CARD_EFFECT_ARTIFACT_SCHEMA_VERSION ||
      manifest.source.commit !== CARD_EFFECT_ARTIFACT_SOURCE_COMMIT ||
      artifactVersion !== CARD_EFFECT_ARTIFACT_VERSION || artifactVersion !== sha(JSON.stringify(identity))) {
    throw new Error("Effect artifact manifest identity is invalid");
  }
  return manifest;
}
function fileFor(manifest: ArtifactManifest, kind: keyof ArtifactManifest["files"]): ArtifactFile {
  const file = manifest.files[kind];
  const expectedPath = kind === "releases" ? "releases.json.gz" : kind === "sourceHashes" ? "source-hashes.json.gz" : kind === "popularity" ? "popularity.json.gz" : `${kind}.jsonl.gz`;
  if (file.path !== expectedPath) throw new Error(`Invalid effect artifact ${kind} path`);
  return file;
}
type PreparedFiles = Map<string, PreparedArtifactFile>;

function releaseRows(directory: string, manifest: ArtifactManifest, prepared?: PreparedFiles): ReleaseRows {
  return consume => {
    const file = fileFor(manifest, "releases"), releaseIds = new Set<number>();
    streamArtifactArray(join(directory, file.path), file, value => {
      const row = value as ReleaseRow;
      if (!row || !validPasscode(row.id) || releaseIds.has(row.id) || typeof row.name !== "string" || !row.name ||
          !Array.isArray(row.aliases) || !row.aliases.every(validPasscode) ||
          !["ok", "placeholder", "unknown"].includes(row.quality) ||
          (row.tcgDate !== null && cleanReleaseMonth(row.tcgDate, "tcg") !== row.tcgDate) ||
          (row.ocgDate !== null && cleanReleaseMonth(row.ocgDate, "ocg") !== row.ocgDate)) throw new Error("Invalid release artifact record");
      releaseIds.add(row.id);
      consume(row);
    }, prepared?.get(file.path));
  };
}
function readArtifact(directory: string, manifest = readManifest(directory), prepared?: PreparedFiles) {
  const content = (kind: "popularity" | "sourceHashes" | "releases") => {
    const chunks: string[] = [], decoder = new TextDecoder();
    const file = fileFor(manifest, kind);
    streamArtifactFile(join(directory, file.path), file, chunk => chunks.push(decoder.decode(chunk, { stream: true })), prepared?.get(file.path));
    chunks.push(decoder.decode());
    return chunks.join("");
  };
  const lines = (kind: "tags" | "profiles") => (consume: (line: string, index: number) => void) => {
    const file = fileFor(manifest, kind);
    streamArtifactLines(join(directory, file.path), file, consume, prepared?.get(file.path));
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
  const releases = releaseRows(directory, manifest, prepared);
  return { manifest, tags: lines("tags"), releases, profiles: lines("profiles"), popularity, sourceHashes: sourceHashes as Record<string, string | null> };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${context}`);
  return value as Record<string, unknown>;
}

function canonicalizer(db: Database.Database, options: CardEffectArtifactImportOptions, releases: ReleaseRows) {
  const artworkRows = db.prepare("SELECT artwork_id,card_id FROM card_artworks").all() as { artwork_id: number; card_id: number }[];
  const artworks = new Map(artworkRows.filter(row => row.artwork_id !== row.card_id).map(row => [row.artwork_id, row.card_id]));
  const mains = new Set(artworkRows.map(row => row.card_id));
  const catalog = new Set((db.prepare("SELECT ygoprodeck_id FROM card_catalog").all() as { ygoprodeck_id: number }[]).map(row => row.ygoprodeck_id));
  releases(row => {
    const family = [row.id, ...row.aliases];
    let target = family.map(code => artworks.get(code)).find(code => code !== undefined)
      ?? family.find(code => mains.has(code)) ?? family.find(code => catalog.has(code)) ?? row.id;
    const seen = new Set<number>();
    while (artworks.has(target)) {
      if (seen.has(target)) throw new Error("Cyclic stored artwork identity");
      seen.add(target); target = artworks.get(target)!;
    }
    // Existing artwork parents and known catalog mains are stronger than the
    // upstream display artwork. Never add an edge from the selected parent.
    for (const code of family) if (code !== target && !artworks.has(code) && !options.remaps?.has(code)) artworks.set(code, target);
  });
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

type ArtifactLines = (consume: (line: string, index: number) => void) => void;
interface SourceMembership { passcode: number; name: string }
function parseTags(lines: ArtifactLines, canonicalize: (passcode: number, name?: string) => number,
  sourceHashes: Record<string, string | null>, consume?: (tag: TagRow) => void, validate = true, sources?: SourceMembership[],
  extract?: (line: string) => Record<string, unknown>) {
  const tags = new Map<number, number>();
  const seen = new Set<number>();
  lines((line, index) => {
    const raw = extract ? extract(line) : object(JSON.parse(line), `tag record ${index + 1}`);
    if ((extract && (raw.nameType !== "text" || raw.modelType !== "text" || (raw.idType !== "integer" && raw.idType !== "real"))) ||
        !validPasscode(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.model !== "string" || !raw.model.trim()) {
      throw new Error(`Invalid effect artifact tag metadata at line ${index + 1}`);
    }
    if (seen.has(raw.id)) throw new Error(`Duplicate effect artifact passcode ${raw.id}`);
    seen.add(raw.id);
    sources?.push({ passcode: raw.id, name: raw.name });
    if (!Object.hasOwn(sourceHashes, raw.id)) throw new Error("Effect artifact source hashes must match the tagged passcodes exactly");
    let tag: CardTags | undefined;
    if (validate) {
      // Publication must ship complete normalized rows. Filling sparse input
      // here preserves useful schema diagnostics before the equality check.
      let validated = CardTags.safeParse(raw.tags);
      if (!validated.success) validated = CardTags.safeParse(fillDefaults(raw.tags));
      if (!validated.success) throw new Error(`Invalid effect artifact tags for ${raw.id}: ${validated.error.message}`);
      tag = validated.data;
      if (!isDeepStrictEqual(raw.tags, tag)) throw new Error(`Effect artifact tags for ${raw.id} must contain normalized schema fields and defaults`);
    } else tag = raw.tags as CardTags;
    const passcode = canonicalize(raw.id, raw.name);
    const current = tags.get(passcode);
    // Direct official tags beat folded prerelease/artwork descriptions. Between
    // aliases, the lower source passcode makes the result independent of order.
    if (current === undefined || raw.id === passcode || (current !== passcode && raw.id < current)) {
      tags.set(passcode, raw.id);
      if (consume) consume(extract
        ? { originalPasscode: raw.id, passcode, summary: raw.tagSummary as string, rolesJson: raw.tagRolesJson as string, tagsJson: raw.tagJson as string }
        : { originalPasscode: raw.id, passcode, summary: tag!.summary, rolesJson: JSON.stringify(tag!.roles), tagsJson: JSON.stringify(tag) });
    }
  });
  if (seen.size !== Object.keys(sourceHashes).length) throw new Error("Effect artifact source hashes must match the tagged passcodes exactly");
  return tags;
}

function parseProfiles(lines: ArtifactLines, consume?: (profile: ProfileRow) => void, validate = true) {
  const profiles = new Set<string>();
  lines((line, index) => {
    const raw = object(JSON.parse(line), `profile record ${index + 1}`);
    if (typeof raw.archetype !== "string" || !raw.archetype.trim() || typeof raw.model !== "string" || !raw.model.trim() ||
        typeof raw.cards !== "number" || !Number.isSafeInteger(raw.cards) || raw.cards < 0) {
      throw new Error(`Invalid effect artifact profile metadata at line ${index + 1}`);
    }
    if (profiles.has(raw.archetype)) throw new Error(`Duplicate effect artifact archetype ${raw.archetype}`);
    profiles.add(raw.archetype);
    if (!validate) {
      const profile = raw.profile as ArchetypeProfile;
      consume?.({ archetype: raw.archetype, cards: raw.cards, plan: profile.plan, hooksJson: JSON.stringify(profile.hooks) });
      return;
    }
    const validated = ArchetypeProfile.safeParse(raw.profile);
    if (!validated.success) throw new Error(`Invalid effect artifact profile for ${raw.archetype}: ${validated.error.message}`);
    const normalized = readProfile(validated.data, raw.archetype);
    if (!normalized || normalized.dropped.length) throw new Error(`Unusable effect artifact hooks for ${raw.archetype}`);
    const profile = ArchetypeProfile.parse(normalized.profile);
    if (!isDeepStrictEqual(raw.profile, profile)) throw new Error(`Effect artifact profile for ${raw.archetype} must contain normalized schema fields`);
    consume?.({ archetype: raw.archetype, cards: raw.cards, plan: profile.plan, hooksJson: JSON.stringify(profile.hooks) });
  });
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
  artifact.releases(() => {});
  const tags = parseTags(artifact.tags, code => code, artifact.sourceHashes), profiles = parseProfiles(artifact.profiles);
  parsePopularity(artifact.popularity, code => code);
  return { version: artifact.manifest.artifactVersion, tags: tags.size, profiles: profiles.size };
}

function coverage(db: Database.Database, canonicalize: (passcode: number) => number, artifactTags: ReadonlyMap<number, number>): CardEffectArtifactCoverage {
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

function importReport(db: Database.Database, manifest: ArtifactManifest, canonicalize: (passcode: number) => number,
  tags: ReadonlyMap<number, number>, profiles: ReadonlySet<string>, skipped: boolean): CardEffectArtifactImportReport {
  const existingTag = db.prepare("SELECT source FROM card_tags WHERE passcode=?");
  let preservedTags = 0;
  for (const passcode of tags.keys()) {
    const row = existingTag.get(passcode) as { source: string } | undefined;
    if (row && !row.source.startsWith(ARTIFACT_SOURCE_PREFIX)) preservedTags++;
  }
  const existingProfile = db.prepare("SELECT source FROM card_tag_profiles WHERE archetype=?");
  let preservedProfiles = 0;
  for (const archetype of profiles) {
    const row = existingProfile.get(archetype) as { source: string } | undefined;
    if (row && !row.source.startsWith(ARTIFACT_SOURCE_PREFIX)) preservedProfiles++;
  }
  return { version: manifest.artifactVersion, skipped, tags: tags.size, profiles: profiles.size,
    preservedTags, preservedProfiles, coverage: coverage(db, canonicalize, tags) };
}

interface StoredImport { manifest_hash: string; passcodes_json: string | null; archetypes_json: string | null; tags: number; profiles: number }

/** Verify the pinned files, then import under one immediate SQLite transaction.
 * The directory override must contain this exact pin. No engine files or engine
 * version state are read or written. Batch/manual replacements retain ownership.
 */
export function importCardEffectArtifact(db: Database.Database, options: CardEffectArtifactImportOptions = {}): CardEffectArtifactImportReport {
  const directory = options.directory ?? DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY;
  const manifest = readManifest(directory);
  const prepared: PreparedFiles = new Map();
  try {
    // Hash and decompress every pinned file before taking SQLite's writer lock.
    // Keep verified bytes on private disk, rather than retaining the full catalog.
    for (const kind of ["tags", "profiles", "popularity", "sourceHashes", "releases"] as const) {
      const file = fileFor(manifest, kind);
      const spool = prepareArtifactFile(join(directory, file.path), file);
      prepared.set(file.path, spool);
      if (kind === "tags" || kind === "profiles") streamArtifactLines(join(directory, file.path), file, () => {}, spool);
    }
    const report = db.transaction(() => {
      const imported = db.prepare("SELECT manifest_hash,passcodes_json,archetypes_json,tags,profiles FROM card_tag_artifact_imports WHERE artifact_version=?").get(manifest.artifactVersion) as StoredImport | undefined;
      if (imported && imported.manifest_hash !== CARD_EFFECT_ARTIFACT_MANIFEST_SHA256) throw new Error("Stored effect artifact manifest hash is invalid");
      const memberships: unknown = imported?.passcodes_json ? JSON.parse(imported.passcodes_json) : null;
      if (imported?.archetypes_json && Array.isArray(memberships) && memberships.every(row => row && typeof row === "object")) {
        // Exact compressed and decompressed pins still get checked on every boot.
        // Persisted memberships avoid parsing/cloning 13,000 already-validated tags.
        const canonicalize = canonicalizer(db, options, releaseRows(directory, manifest, prepared));
        const archetypes: unknown = JSON.parse(imported.archetypes_json);
        if (memberships.length !== manifest.files.tags.records || !memberships.every(row => validPasscode(row.passcode) && typeof row.name === "string" && row.name.trim()) || new Set(memberships.map(row => row.passcode)).size !== memberships.length ||
            !Array.isArray(archetypes) || archetypes.length !== imported.profiles || !archetypes.every(name => typeof name === "string" && name.trim()) || new Set(archetypes).size !== archetypes.length) {
          throw new Error("Stored effect artifact membership is invalid");
        }
        const tags = new Map<number, number>();
        for (const row of memberships as SourceMembership[]) {
          const passcode = canonicalize(row.passcode, row.name), prior = tags.get(passcode);
          if (prior === undefined || row.passcode === passcode || (prior !== passcode && row.passcode < prior)) tags.set(passcode, row.passcode);
        }
        return importReport(db, manifest, canonicalize, tags, new Set<string>(archetypes), true);
      }
      const artifact = readArtifact(directory, manifest, prepared);
      const canonicalize = canonicalizer(db, options, artifact.releases);
      const source = `${ARTIFACT_SOURCE_PREFIX}${artifact.manifest.artifactVersion}`;
      const insertTag = db.prepare(`INSERT INTO card_tags
        (passcode,summary,roles_json,tags_json,popularity,text_hash,source,tagged_at,schema_version)
        VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(passcode) DO UPDATE SET summary=excluded.summary,roles_json=excluded.roles_json,
          tags_json=excluded.tags_json,popularity=excluded.popularity,text_hash=excluded.text_hash,source=excluded.source,
          tagged_at=excluded.tagged_at,schema_version=excluded.schema_version
        WHERE card_tags.source GLOB 'searchygo-artifact:*'`);
      const sources: SourceMembership[] = [];
      // Exact pinned bytes are already schema-normalized by the independent
      // installation/publication verifier. Retain per-record identity checks,
      // without compiling and cloning that schema again in every server process.
      const extractTag = db.prepare(`SELECT json_type(@row,'$.id') AS idType,json_type(@row,'$.name') AS nameType,json_type(@row,'$.model') AS modelType,
        json_extract(@row,'$.id') AS id,json_extract(@row,'$.name') AS name,
        json_extract(@row,'$.model') AS model,json_extract(@row,'$.tags.summary') AS tagSummary,
        json_extract(@row,'$.tags.roles') AS tagRolesJson,json_extract(@row,'$.tags') AS tagJson`);
      const tags = parseTags(artifact.tags, canonicalize, artifact.sourceHashes, imported ? undefined : tag => {
        // Keep the pinned text hash, never the current engine/catalog text.
        insertTag.run(tag.passcode, tag.summary, tag.rolesJson, tag.tagsJson, 0,
          artifact.sourceHashes[tag.originalPasscode] ?? null, source, artifact.manifest.schemaVersion);
      }, false, sources, line => extractTag.get({ row: line }) as Record<string, unknown>);
      // Named tags establish missing-ID bridges before name-free popularity rows
      // use the canonicalizer cache. Never overwrite another source's popularity.
      const popularity = parsePopularity(artifact.popularity, canonicalize);
      if (!imported) {
        const updatePopularity = db.prepare("UPDATE card_tags SET popularity=? WHERE passcode=? AND source=?");
        for (const [passcode, views] of popularity) updatePopularity.run(views, passcode, source);
      }
      const insertProfile = db.prepare(`INSERT INTO card_tag_profiles
        (archetype,plan,hooks_json,source,profiled_at,schema_version,cards)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP,?,?)
        ON CONFLICT(archetype) DO UPDATE SET plan=excluded.plan,hooks_json=excluded.hooks_json,
          source=excluded.source,profiled_at=excluded.profiled_at,schema_version=excluded.schema_version,cards=excluded.cards
        WHERE card_tag_profiles.source GLOB 'searchygo-artifact:*'`);
      const profiles = parseProfiles(artifact.profiles, imported ? undefined : profile => {
        insertProfile.run(profile.archetype, profile.plan, profile.hooksJson, source, artifact.manifest.schemaVersion, profile.cards);
      }, false);
      if (!imported) {
        const releases = new Map<number, number>();
        const insertRelease = db.prepare(`INSERT INTO card_release(passcode,tcg_date,ocg_date,quality,source_version) VALUES(?,?,?,?,?)
          ON CONFLICT(passcode) DO UPDATE SET tcg_date=excluded.tcg_date,ocg_date=excluded.ocg_date,quality=excluded.quality,source_version=excluded.source_version`);
        artifact.releases(row => {
          const passcode = canonicalize(row.id, row.name), prior = releases.get(passcode);
          if (prior === undefined || row.id === passcode || (prior !== passcode && row.id < prior)) {
            releases.set(passcode, row.id);
            insertRelease.run(passcode, row.tcgDate, row.ocgDate, row.quality, artifact.manifest.artifactVersion);
          }
        });
        db.prepare(`INSERT INTO card_tag_artifact_imports
          (artifact_version,manifest_hash,schema_version,source_commit,tags,profiles) VALUES(?,?,?,?,?,?)`)
          .run(artifact.manifest.artifactVersion, CARD_EFFECT_ARTIFACT_MANIFEST_SHA256, artifact.manifest.schemaVersion, artifact.manifest.source.commit, tags.size, profiles.size);
      }
      db.prepare("UPDATE card_tag_artifact_imports SET passcodes_json=?,archetypes_json=? WHERE artifact_version=?")
        .run(JSON.stringify(sources), JSON.stringify([...profiles]), manifest.artifactVersion);
      return importReport(db, manifest, canonicalize, tags, profiles, Boolean(imported));
    }).immediate();
    db.pragma("shrink_memory");
    return report;
  } finally { for (const spool of prepared.values()) spool.close(); }
}
