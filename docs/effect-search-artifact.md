# Pinned effect artifact

The card tags, archetype profiles and popularity input are credited to
[LorenzoWhite/searchygo](https://github.com/LorenzoWhite/searchygo), commit
`9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c`. The original tag and profile JSONL
bytes are retained exactly after decompression; no upstream scripts are run.
The source headers, artifact NOTICE and root NOTICE retain attribution.

The files in `packages/shared/data/effects/` are tracked in Git. Node 22
`gzipSync(bytes, { level: 9 })` emits deterministic gzip headers without an
original filename or timestamp. Their combined compressed size is 3,541,961
bytes, below the 5 MB threshold for a checked-in artifact, so startup requires
no download.

| File | Source | Records | Raw bytes | Gzip bytes |
| --- | --- | ---: | ---: | ---: |
| `tags.jsonl.gz` | `data/tags/tags.jsonl` | 13,694 | 24,182,853 | 2,652,788 |
| `profiles.jsonl.gz` | `data/synergy/profiles.jsonl` | 530 | 1,280,587 | 221,277 |
| `popularity.json.gz` | `id` → `views` from `data/cards.json` | 14,383 | 249,030 | 106,000 |
| `source-hashes.json.gz` | Actual tagged-source text from `data/cards.json` | 13,694 | 1,066,655 | 561,896 |

Popularity contains only the sorted passcode-to-view-count mapping, not the
upstream catalog. Its source-input SHA-256 is recorded in the manifest, along
with hashes of the derived bytes. Views are the upstream snapshot's popularity
signal; they are not live analytics.

The manifest records source commit, schema version, sizes, record counts and
SHA-256 hashes of compressed and uncompressed content. `artifact.ts` pins the
exact manifest hash and artifact version in code. A custom directory must
contain that same pin, so a forged manifest cannot replace data by supplying
self-consistent hashes. Updating the pin requires regenerating the manifest,
updating the exported constants and rerunning the integration suite. The
artifact version is the SHA-256 of the manifest identity serialized as compact
JSON without the `artifactVersion` field.

Current artifact version:
`e0fa78ea97c2d1f2842022952e14d12a7cfa38e901bd4ad5d10eb29c57406480`.
Current manifest SHA-256:
`aeff6bfe90149feedbbb06c7e48a2848214dc52e34562963e548ac0ec313a6ac`.

## Import contract

```ts
importCardEffectArtifact(
  db: Database.Database,
  options?: {
    directory?: string;
    remaps?: ReadonlyMap<number, number>;
    canonicalize?: (passcode: number) => number;
    textFor?: (passcode: number) => string | undefined;
  },
): CardEffectArtifactImportReport
```

The default directory works from both `shared/src` and `shared/dist`. Runtime
images that invoke the importer must ship `packages/shared/data/effects/`
alongside `shared/dist`.

Compressed and uncompressed hashes are checked before any write, including
already-imported versions. Tags pass `fillDefaults` and the `CardTags` Zod
schema. Profiles pass the `ArchetypeProfile` Zod schema and `readProfile`;
unusable or dropped hooks reject the import. Metadata, duplicate IDs, view
counts and canonical passcodes are validated as well.

An immediate SQLite transaction covers validation against the current artwork
families, tag/profile writes and the version-state write. A malformed record,
identity callback error or SQLite write failure leaves all three tables
unchanged. Parallel startups serialize at the SQLite write lock.

Known `card_artworks` families fold alternate artwork IDs to their main card.
Explicit engine remaps and the optional canonicalization callback then resolve
identity chains; cycles and invalid passcodes fail. An original direct target
record wins a collision over folded tags. Between multiple folded records, the
lowest original passcode wins. Direct target view counts win too; without a
direct popularity entry, the largest folded view count is used.

Unknown catalog/engine IDs are retained, because the artifact and engine have
different coverage. Tag rows intentionally have no catalog foreign key.

`text_hash` comes from the verified tagged-source sidecar. It is SHA-256 of actual
printed input text, with CRLF/CR converted to LF and each text field trimmed;
Pendulum text precedes monster text with one newline. This is normalization
`newline-trim-pendulum-first-v1`, exported with `hashCardEffectSourceText` and
`normalizeCardEffectSourceText`. Of 13,694 initial tags, 13,693 have text in the
credited source snapshot. Passcode `101402101` has no source input and its hash
is `NULL`. Current engine/catalog text and summaries never supply this hash.
The `textFor` option remains accepted for API compatibility and does not alter
tagged-source hashes.

Pinned rows have `source = "searchygo-artifact:<artifactVersion>"`. A new pin
may replace earlier artifact-owned rows. Tags and profiles with any other
source, including Batch/manual rows, remain unchanged. Records absent from a
new pin are retained. Re-importing a recorded version skips writes after
validation and refreshes the coverage report. The importer does not read or
write engine bundle identity or resources.

The report contains:

```ts
{
  version: string;
  skipped: boolean;
  tags: number;            // Canonical artifact record count.
  profiles: number;        // Artifact archetype count.
  preservedTags: number;   // Matching records owned by another source.
  preservedProfiles: number;
  coverage: {
    catalogCards: number;
    taggedCards: number;
    missingCards: number;
    percent: number;       // 0–100; 0 for an empty catalog.
    missing: { passcode: number; name: string }[];
    artifactOnlyPasscodes: number[];
  };
}
```

Coverage excludes known alternate-art catalog rows, deduplicates canonical
catalog IDs and includes preserved tags in the covered count. Missing records
and artifact-only passcodes are sorted by passcode. Artifact counts represent
the pinned data even when a Batch/manual replacement is preserved; they are
not the number of writes made in this run.

`verifyCardEffectArtifact(directory?: string): { version: string; tags: number;
profiles: number }` verifies the pin, schemas, counts and source hashes without
opening SQLite. Preparation/install callers can fail before serving requests.

## SQLite storage

| Table | Key | Fields |
| --- | --- | --- |
| `card_tags` | `passcode` | `summary`, `roles_json`, `tags_json`, `popularity`, nullable `text_hash`, `source`, `tagged_at`, `schema_version` |
| `card_tag_profiles` | `archetype` | `plan`, `hooks_json`, `source`, `profiled_at`, `schema_version`, `cards` |
| `card_tag_artifact_imports` | `artifact_version` | `manifest_hash`, `schema_version`, `source_commit`, `tags`, `profiles`, `imported_at` |

Timestamps use SQLite `CURRENT_TIMESTAMP` when imported. Popularity defaults
to zero. Engine passcode migration moves every tag field, including popularity
and original timestamp; an existing official target wins a collision, then the
old passcode is deleted. Artwork-family remap exclusions remain in force.

The integration suite uses the full real artifact and SQLite for imports,
canonical identity, collisions, text hashing, popularity, idempotence,
preserved replacements, atomic rollback and corruption (including a forged
manifest). Existing shared CI discovers the suite through the regular
`npm test --workspace=packages/shared` command.
