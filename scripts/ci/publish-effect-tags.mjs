/** Publish only verified effect data and two literal pin replacements. Node builtins only. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const DATA = "packages/shared/data/effects", SOURCE = "packages/shared/src/cards/effects/artifact.ts";
export const EFFECT_FILES = [`${DATA}/releases.json.gz`, `${DATA}/manifest.json`, `${DATA}/profiles.jsonl.gz`, `${DATA}/tags.jsonl.gz`, `${DATA}/source-hashes.json.gz`, SOURCE];
const MODEL = "claude-haiku-5-5", BOT = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pattern = name => new RegExp(`(export const ${name} = ")[a-f0-9]{64}(";)`, "g");
const json = path => JSON.parse(readFileSync(path, "utf8"));
const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Same month and region floors as cleanReleaseMonth; publication has no package dependencies.
const releaseMonth = (value, region) => typeof value === "string" && /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= (region === "tcg" ? 2002 : 1999);
/** Literal review line shared by generation and publication validation. */
export function releaseCorrectionLine(fact, name) {
  const label = String(name).replace(/[\r\n|]/g, " ");
  return `- ${label} (${fact.id}): ${String(fact.region).toUpperCase()} ${fact.previous} → ${fact.month}; misc: ${fact.sourceMonth ?? "unknown"}; first set: ${fact.firstSetMonth ?? "unknown"}.`;
}

export function validateAdditiveReleases(before, after, corrections = []) {
  const validId = id => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff;
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error("Invalid release arrays");
  const rows = new Map();
  for (const row of after) {
    if (!row || !validId(row.id) || rows.has(row.id) || typeof row.name !== "string" || !row.name || !Array.isArray(row.aliases) || !row.aliases.every(validId) ||
        !["ok", "placeholder", "unknown"].includes(row.quality) || (row.tcgDate !== null && !releaseMonth(row.tcgDate, "tcg")) || (row.ocgDate !== null && !releaseMonth(row.ocgDate, "ocg"))) throw new Error("Invalid release record or duplicate ID");
    rows.set(row.id, row);
  }
  const oldIds = new Set(before.map(row => row.id));
  const familyIds = new Set(before.flatMap(row => [row.id, ...row.aliases]));
  for (const row of after) if (!oldIds.has(row.id)) {
    const family = [row.id, ...row.aliases];
    if (new Set(family).size !== family.length || family.some(id => familyIds.has(id))) throw new Error("New release ID or alias overlaps an existing family");
    for (const id of family) familyIds.add(id);
  }
  for (const old of before) {
    const row = rows.get(old.id);
    if (!row) throw new Error("Non-additive release deletion");
    const restored = { ...row };
    for (const [key, region] of [["tcgDate", "tcg"], ["ocgDate", "ocg"]]) {
      if (row[key] !== old[key]) {
        if (!releaseMonth(row[key], region)) throw new Error("Invalid release date change");
        if (releaseMonth(old[key], region) && !(row[key] < old[key] && corrections.some(fact => fact.id === old.id && fact.region === region && fact.previous === old[key] && fact.month === row[key] && (fact.sourceMonth === row[key] || fact.firstSetMonth === row[key])))) throw new Error("Non-additive release date change without earlier first-print evidence");
        restored[key] = old[key];
      }
    }
    if (!identical(restored, old)) throw new Error("Non-additive release record change");
  }
}

export function effectBranchHasHumanEdits(history) {
  const botIdentity = `${BOT.name}\0${BOT.email}\0${BOT.name}\0${BOT.email}`;
  return history.trim().split("\n").filter(Boolean).some(identity => identity !== botIdentity);
}

export function validateEffectCandidate(root, outputDirectory) {
  const candidate = json(join(outputDirectory, "update.json"));
  if (candidate.version !== 1 || typeof candidate.changed !== "boolean" || !/^[a-f0-9]{40}$/.test(candidate.baseSha) || !/^[a-f0-9]{64}$/.test(candidate.baseVersion)) throw new Error("Invalid effect candidate metadata");
  if (!candidate.changed) {
    if (!Array.isArray(candidate.files) || candidate.files.length) throw new Error("Unchanged effect candidate must have no files");
    return candidate;
  }
  if (!identical([...candidate.files].sort(), [...EFFECT_FILES].sort()) || new Set(candidate.files).size !== EFFECT_FILES.length) throw new Error("Effect candidate changes paths outside allowlist");
  for (const file of EFFECT_FILES) if (!lstatSync(join(outputDirectory, file)).isFile() || lstatSync(join(outputDirectory, file)).isSymbolicLink()) throw new Error("Effect candidate requires regular files");
  const before = json(join(root, DATA, "manifest.json")), manifestBytes = readFileSync(join(outputDirectory, DATA, "manifest.json")), after = JSON.parse(manifestBytes);
  const originalSource = readFileSync(join(root, SOURCE), "utf8");
  const pinned = name => {
    const matches = [...originalSource.matchAll(new RegExp(`export const ${name} = "([a-f0-9]{64})";`, "g"))];
    if (matches.length !== 1) throw new Error("Missing unique original source pin");
    return matches[0][1];
  };
  if (before.artifactVersion !== pinned("CARD_EFFECT_ARTIFACT_VERSION") || sha(readFileSync(join(root, DATA, "manifest.json"))) !== pinned("CARD_EFFECT_ARTIFACT_MANIFEST_SHA256")) throw new Error("Original effect artifact differs from trusted source pins");
  const { artifactVersion, ...identity } = after;
  if (candidate.baseVersion !== before.artifactVersion || candidate.manifestSha256 !== sha(manifestBytes) || candidate.artifactVersion !== artifactVersion || sha(JSON.stringify(identity)) !== artifactVersion || after.formatVersion !== before.formatVersion || after.schemaVersion !== before.schemaVersion || !identical(after.source, before.source)) throw new Error("Effect manifest provenance or integrity is invalid");
  if (!["anthropic-message-batches", "release-month-fill"].includes(after.generation?.kind) || !Array.isArray(after.generation.models) || after.generation.baseArtifactVersion !== before.artifactVersion || after.generation.normalization !== "newline-trim-pendulum-first-v1" || !Number.isInteger(after.generation.acceptedCards) || after.generation.acceptedCards < 0 || !Number.isInteger(after.generation.acceptedProfiles) || after.generation.acceptedProfiles < 0) throw new Error("Effect generation provenance is invalid");
  const decode = (directory, manifest, key) => {
    const names = { tags: "tags.jsonl.gz", profiles: "profiles.jsonl.gz", popularity: "popularity.json.gz", sourceHashes: "source-hashes.json.gz", releases: "releases.json.gz" };
    const file = manifest.files[key];
    if (file.path !== names[key] || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 30_000_000) throw new Error("Invalid effect artifact descriptor");
    const compressed = readFileSync(join(directory, DATA, file.path));
    if (compressed.length !== file.gzipBytes || sha(compressed) !== file.gzipSha256) throw new Error("Effect artifact compressed integrity failed");
    const bytes = gunzipSync(compressed, { maxOutputLength: file.bytes });
    if (bytes.length !== file.bytes || sha(bytes) !== file.sha256) throw new Error("Effect artifact content integrity failed");
    return bytes.toString("utf8");
  };
  if (!identical(after.files.popularity, before.files.popularity) || !readFileSync(join(outputDirectory, DATA, "popularity.json.gz")).equals(readFileSync(join(root, DATA, "popularity.json.gz")))) throw new Error("Effect publication changed unrelated popularity data");
  decode(outputDirectory, after, "popularity");
  const releasesBefore = JSON.parse(decode(root, before, "releases")), releasesAfter = JSON.parse(decode(outputDirectory, after, "releases"));
  const corrections = json(join(outputDirectory, "report.json")).releaseCorrections ?? [];
  if (!Array.isArray(corrections)) throw new Error("Invalid release corrections report");
  if (corrections.length) {
    const lines = new Set(readFileSync(join(outputDirectory, "report.md"), "utf8").split(/\r?\n/));
    const byId = new Map(releasesAfter.map(row => [row.id, row]));
    for (const fact of corrections) if (!byId.has(fact.id) || !lines.has(releaseCorrectionLine(fact, byId.get(fact.id).name))) throw new Error("Release correction missing from review report.md");
  }
  validateAdditiveReleases(releasesBefore, releasesAfter, corrections);
  if (after.files.releases.records !== releasesAfter.length) throw new Error("Invalid release record count");
  const releasesChanged = !identical(releasesBefore, releasesAfter);
  if (!releasesChanged && !identical(after.files.releases, before.files.releases)) throw new Error("Release descriptor changed without additive records");
  if (releasesChanged && (after.files.releases.sourcePath !== "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes" || !/^[a-f0-9]{64}$/.test(after.files.releases.sourceSha256))) throw new Error("Invalid release source provenance");
  const acceptedCount = after.generation.acceptedCards + after.generation.acceptedProfiles;
  if ((!acceptedCount && (!releasesChanged || after.generation.kind !== "release-month-fill")) || (acceptedCount && after.generation.kind !== "anthropic-message-batches")) throw new Error("Effect generation has no accepted update");
  const tagsBefore = new Map(decode(root, before, "tags").trim().split("\n").map(line => { const row = JSON.parse(line); return [row.id, row]; }));
  const tagRows = decode(outputDirectory, after, "tags").trim().split("\n").map(JSON.parse), tagsAfter = new Map(tagRows.map(row => [row.id, row]));
  if (tagsAfter.size !== tagRows.length || tagRows.length !== after.files.tags.records) throw new Error("Effect tag IDs/count are invalid");
  const sourceBefore = JSON.parse(decode(root, before, "sourceHashes")), sourceAfter = JSON.parse(decode(outputDirectory, after, "sourceHashes"));
  if (sourceAfter.version !== 1 || sourceAfter.normalization !== sourceBefore.normalization || Object.keys(sourceAfter.hashes).length !== tagsAfter.size || after.files.sourceHashes.records !== tagsAfter.size) throw new Error("Tagged input hash count/normalization is invalid");
  const report = json(join(outputDirectory, "report.json"));
  if ((acceptedCount ? report.mode !== "live" : !["live", "dry-run", "release-only"].includes(report.mode)) || !Array.isArray(report.accepted)) throw new Error("Missing validated Batch report");
  const accepted = new Map(report.accepted.filter(tag => sourceBefore.hashes[tag.id] !== tag.inputHash).map(tag => [tag.id, tag]));
  if (accepted.size !== after.generation.acceptedCards || after.generation.acceptedResultsSha256 !== sha(JSON.stringify([...accepted.values()].sort((a, b) => a.id - b.id)))) throw new Error("Validated result provenance is invalid");
  for (const [id, old] of tagsBefore) if (!tagsAfter.has(id) || (!accepted.has(id) && !identical(tagsAfter.get(id), old))) throw new Error("Effect publication discarded or altered unrelated tags");
  for (const id of accepted.keys()) if (!tagsAfter.has(id)) throw new Error("Missing accepted published tag");
  for (const [id, row] of tagsAfter) {
    const hash = sourceAfter.hashes[id];
    if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff || (hash !== null && !/^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid published tagged-input identity");
    if (accepted.has(id)) {
      const tag = accepted.get(id);
      if (![MODEL, "claude-haiku-4-5-20251001"].includes(tag.model) || hash !== tag.inputHash || !identical(row, { id, name: tag.name, model: tag.model, tags: tag.tags })) throw new Error("Effect publication does not match validated results");
    } else if (!tagsBefore.has(id) || sourceBefore.hashes[id] !== hash) throw new Error("Unexpected published card or source hash");
  }
  const profilesBefore = new Map(decode(root, before, "profiles").trim().split("\n").map(line => { const row = JSON.parse(line); return [row.archetype, row]; }));
  const profileRows = decode(outputDirectory, after, "profiles").trim().split("\n").map(JSON.parse), profilesAfter = new Map(profileRows.map(row => [row.archetype, row]));
  if (profilesAfter.size !== profileRows.length || profileRows.length !== after.files.profiles.records || !Array.isArray(report.acceptedProfiles)) throw new Error("Effect profile count/report is invalid");
  const acceptedProfiles = new Map(report.acceptedProfiles.filter(row => profilesBefore.get(row.archetype)?.inputHash !== row.inputHash).map(row => [row.archetype, row]));
  if (acceptedProfiles.size !== after.generation.acceptedProfiles || after.generation.acceptedProfilesSha256 !== sha(JSON.stringify([...acceptedProfiles.values()].sort((a,b) => a.archetype.localeCompare(b.archetype))))) throw new Error("Validated profile provenance is invalid");
  const models = [...new Set([...accepted.values(), ...acceptedProfiles.values()].map(row => row.model))].sort();
  if (!identical(after.generation.models, models)) throw new Error("Effect generation model provenance is invalid");
  for (const [name, old] of profilesBefore) if (!profilesAfter.has(name) || (!acceptedProfiles.has(name) && !identical(profilesAfter.get(name), old))) throw new Error("Effect publication altered unrelated profiles");
  for (const archetype of acceptedProfiles.keys()) if (!profilesAfter.has(archetype)) throw new Error("Missing accepted published profile");
  for (const [archetype, row] of profilesAfter) {
    if (acceptedProfiles.has(archetype)) {
      const accepted = acceptedProfiles.get(archetype);
      if (accepted.model !== MODEL || !/^[a-f0-9]{64}$/.test(accepted.inputHash) || !Number.isInteger(accepted.cards) || accepted.cards < 3 || !identical(row, { archetype, cards: accepted.cards, model: MODEL, inputHash: accepted.inputHash, profile: accepted.profile })) throw new Error("Profile publication does not match validated results");
    } else if (!profilesBefore.has(archetype)) throw new Error("Unexpected published archetype");
  }
  let expectedSource = originalSource;
  for (const [name, value] of [["CARD_EFFECT_ARTIFACT_VERSION", artifactVersion], ["CARD_EFFECT_ARTIFACT_MANIFEST_SHA256", candidate.manifestSha256]]) {
    const regex = pattern(name); if ([...expectedSource.matchAll(regex)].length !== 1) throw new Error("Missing unique source pin");
    expectedSource = expectedSource.replace(regex, (_whole, prefix, suffix) => `${prefix}${value}${suffix}`);
  }
  if (readFileSync(join(outputDirectory, SOURCE), "utf8") !== expectedSource) throw new Error("Effect publication changed code outside the two pin constants");
  return candidate;
}

export async function publishEffectTags({ root = process.cwd(), outputDirectory = process.env.EFFECT_ARTIFACT_DIR, env = process.env } = {}) {
  if (!outputDirectory) throw new Error("EFFECT_ARTIFACT_DIR is required");
  outputDirectory = resolve(root, outputDirectory);
  const candidate = validateEffectCandidate(root, outputDirectory);
  const skip = reason => { console.log(`Effect artifact publication skipped: ${reason}`); return { status: "skipped", reason, pushed: false }; };
  if (!candidate.changed) return skip("unchanged");
  const repository = env.GITHUB_REPOSITORY, base = env.EFFECT_BASE_BRANCH || "main", branch = "chore/effect-tags";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid GitHub repository");
  const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  const git = (...args) => run("git", args), gh = (...args) => run("gh", args);
  git("check-ref-format", `refs/heads/${base}`);
  git("fetch", "--no-tags", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`);
  if (git("rev-parse", `refs/remotes/origin/${base}`).trim() !== candidate.baseSha) return skip("base-advanced");
  const exists = Boolean(git("ls-remote", "--heads", "origin", `refs/heads/${branch}`).trim());
  let prior = "";
  const pr = gh("pr", "list", "--repo", repository, "--head", branch, "--base", base, "--state", "open", "--json", "url", "--jq", ".[0].url // empty").trim();
  const body = join(outputDirectory, "report.md"), title = "chore(cards): update validated effect tags";
  const completePublication = () => {
    readFileSync(body, "utf8");
    if (pr) gh("pr", "edit", pr, "--repo", repository, "--title", title, "--body-file", body);
    else gh("pr", "create", "--repo", repository, "--base", base, "--head", branch, "--title", title, "--body-file", body);
    // GITHUB_TOKEN-created PRs do not trigger push checks. Explicit dispatch is
    // replayable even when a previous PR creation or dispatch response failed.
    gh("workflow", "run", "test.yml", "--repo", repository, "--ref", branch, "-f", "nightly=false");
  };
  if (exists) {
    git("fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    prior = git("rev-parse", `refs/remotes/origin/${branch}`).trim();
    const history = git("log", "--format=%an%x00%ae%x00%cn%x00%ce", `${candidate.baseSha}..${prior}`);
    if (effectBranchHasHumanEdits(history)) return skip("human-commits");
    if (JSON.parse(git("show", `${prior}:${DATA}/manifest.json`)).artifactVersion === candidate.artifactVersion) {
      completePublication();
      return { status: "published", pushed: false };
    }
  }
  if (git("status", "--porcelain", "--untracked-files=no").trim()) throw new Error("Publication requires a clean tracked checkout");
  readFileSync(body, "utf8");
  git("switch", "--detach", candidate.baseSha);
  for (const file of EFFECT_FILES) copyFileSync(join(outputDirectory, file), join(root, file));
  git("add", "--", ...EFFECT_FILES);
  const attribution = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01GLTNwBcU5bVhsdGwaZoeik";
  run("git", ["-c", "commit.gpgsign=false", "commit", "-m", title, "-m", attribution], { env: { ...env, GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email } });
  git("push", `--force-with-lease=refs/heads/${branch}:${prior}`, "origin", `HEAD:refs/heads/${branch}`);
  completePublication();
  return { status: "published", pushed: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--validate-only")) {
    try { console.log(JSON.stringify(validateEffectCandidate(process.cwd(), resolve(process.env.EFFECT_ARTIFACT_DIR ?? "")))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  } else publishEffectTags().catch(error => { console.error(error.message); process.exitCode = 1; });
}
