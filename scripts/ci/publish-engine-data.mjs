/** Publish the reviewed data-only artifact. Uses Node builtins and git/gh; never installs or executes candidate code. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HISTORY_FILE, historyDetails, appendHistory } from "./engine-data-history.mjs";
import { BRIDGE_FILES, validateBridgeCandidate } from "./bridge-artifacts.mjs";

export const PIN_FILE = "packages/duel-server/scripts/prepare-data.ts";
const CORE_PIN_FILES = ["packages/duel-server/domain-core/pins.json", "packages/duel-server/legacy-1v1/domain-core/pins.json"];
const PIN_FILES = [PIN_FILE, ...CORE_PIN_FILES];
const TABLE_FILE = "packages/duel-server/duelingbook-alt-passcodes.json";
const NAMES_FILE = "packages/duel-server/duelingbook-alt-passcode-names.json";
const COMPATIBILITY_FILES = [TABLE_FILE, NAMES_FILE];
const DATA_FILES = [...PIN_FILES, ...COMPATIBILITY_FILES, ...BRIDGE_FILES];
export const BOT = { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" };
const pinKeys = ["scripts", "database", "strings"];
const pinPattern = (key) => new RegExp(`(["']?\\b${key}\\b["']?\\s*:\\s*["'])([a-f0-9]{40})(["'])`, "g");

export function readPinsFromSource(source) {
  return Object.fromEntries(pinKeys.map((key) => {
    const matches = [...source.matchAll(pinPattern(key))];
    if (matches.length !== 1) throw new Error(`Expected exactly one ${key} data pin in ${PIN_FILE}`);
    return [key, matches[0][2]];
  }));
}

export function hasHumanCommits(authors) {
  return authors.split("\n").filter(Boolean).some((line) => line !== `${BOT.name}\0${BOT.email}`);
}

export function validateArtifact(artifact) {
  if (!artifact || typeof artifact.changed !== "boolean") throw new Error("Artifact changed must be boolean");
  if (!artifact.changed) return;
  if (!/^[a-f0-9]{40}$/.test(artifact.baseSha ?? "")) throw new Error("Artifact baseSha must be a full commit SHA");
  if (artifact.matchingPrHead !== undefined && !/^[a-f0-9]{40}$/.test(artifact.matchingPrHead)) {
    throw new Error("Artifact matchingPrHead must be a full commit SHA");
  }
  if (!Array.isArray(artifact.files) || !artifact.files.length ||
      new Set(artifact.files).size !== artifact.files.length || artifact.files.some((file) => !DATA_FILES.includes(file))) {
    throw new Error(`Artifact files must match the exact allowlist: ${DATA_FILES.join(", ")}`);
  }
  if (artifact.files.some(file => BRIDGE_FILES.includes(file)) && !artifact.bridge) throw new Error("Bridge changes require their validated manifest");
  if (!artifact.next || Object.keys(artifact.next).length !== pinKeys.length ||
      pinKeys.some((key) => !/^[a-f0-9]{40}$/.test(artifact.next[key] ?? ""))) {
    throw new Error("Artifact next must contain exactly three full data pin SHAs");
  }
}

/** The optional writable paths contain inert, bounded JSON only, never executable source. */
function validateCompatibility(tableBytes, nameBytes) {
  const parse = (bytes) => {
    if (Buffer.byteLength(bytes) > 1_000_000) throw new Error("Dueling Book JSON is too large");
    const value = JSON.parse(bytes);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length ||
        Object.keys(value).length > 10_000 || JSON.stringify(value, null, 2) + "\n" !== bytes) {
      throw new Error("Dueling Book JSON must be a nonempty canonical object");
    }
    return value;
  };
  const code = (value) => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
  const key = (value) => /^[1-9]\d*$/.test(value) && code(Number(value));
  const table = parse(tableBytes), names = parse(nameBytes);
  const targets = new Set(Object.values(table).map(String));
  if (Object.entries(table).some(([alt, real]) => !key(alt) || !code(real) || Number(alt) === real) ||
      Object.entries(names).some(([id, name]) => !key(id) || !targets.has(id) || typeof name !== "string" ||
        !name.trim() || name.length > 400 || /[\r\n\x00-\x1f]/.test(name)) ||
      [...targets].some(id => !Object.hasOwn(names, id))) {
    throw new Error("Dueling Book JSON must contain passcode pairs and matching card-name evidence");
  }
}

function defaultRun(command, args, options) {
  return execFileSync(command, args, { ...options, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** run(command, argv, {cwd, env}) is injectable for tests; it returns stdout or throws on failure. */
export async function publishEngineData({ cwd = process.cwd(), env = process.env, run = defaultRun, log = console.log } = {}) {
  if (!env.UPDATE_ARTIFACT_DIR) throw new Error("UPDATE_ARTIFACT_DIR is required");
  const artifactDir = resolve(cwd, env.UPDATE_ARTIFACT_DIR);
  const artifact = JSON.parse(readFileSync(join(artifactDir, "update.json"), "utf8"));
  validateArtifact(artifact);
  validateBridgeCandidate(cwd, artifactDir, artifact.bridge);
  const compatibilityChanged = artifact.files?.some(file => COMPATIBILITY_FILES.includes(file));
  const bridgeChanged = artifact.files?.some(file => BRIDGE_FILES.includes(file));
  const skip = (reason) => { log(`::warning::Engine data publication skipped: ${reason}`); return { status: "skipped", reason, pushed: false }; };
  if (!artifact.changed) return skip("unchanged");
  const base = env.BASE_BRANCH || "main";
  const branch = env.UPDATE_BRANCH || "chore/engine-data-update";
  const repo = env.GH_REPO;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GH_REPO must be owner/repository");
  const git = (...args) => run("git", args, { cwd, env });
  const gh = (...args) => run("gh", args, { cwd, env });
  git("check-ref-format", `refs/heads/${base}`);
  git("check-ref-format", `refs/heads/${branch}`);
  if (base === branch) throw new Error("Update branch must differ from the base branch");
  const baseRef = `refs/remotes/origin/${base}`;
  const updateRef = `refs/remotes/origin/${branch}`;
  git("fetch", "--no-tags", "origin", `+refs/heads/${base}:${baseRef}`);
  const baseSha = git("rev-parse", baseRef).trim();
  // ls-remote distinguishes a genuinely absent branch from a failed fetch (which must fail publication).
  const branchExists = Boolean(git("ls-remote", "--heads", "origin", `refs/heads/${branch}`).trim());
  const pr = gh("pr", "list", "--repo", repo, "--head", branch, "--base", base, "--state", "open", "--json", "url", "--jq", ".[0].url // empty").trim();
  let updateSha = "";
  let historyRepair = null;
  if (branchExists) {
    git("fetch", "--no-tags", "origin", `+refs/heads/${branch}:${updateRef}`);
    updateSha = git("rev-parse", updateRef).trim();
    const authors = git("log", "--format=%an%x00%ae", `${baseRef}..${updateRef}`);
    if (pr && hasHumanCommits(authors)) {
      const temporary = mkdtempSync(join(tmpdir(), "engine-data-comment-"));
      try {
        const body = join(temporary, "comment.md");
        const runUrl = `${env.GITHUB_SERVER_URL || "https://github.com"}/${repo}/actions/runs/${env.GITHUB_RUN_ID || ""}`;
        writeFileSync(body, `Engine data update skipped because this branch contains commits authored by someone other than the exact GitHub Actions bot identity. Preserving those changes; no push or CI dispatch was performed.\n\nRun: ${runUrl}\n`);
        gh("pr", "comment", pr, "--repo", repo, "--body-file", body);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
      return skip("human-commits");
    }
  }
  if (baseSha !== artifact.baseSha) return skip("base-advanced");
  if (updateSha && pr) {
    const current = readPinsFromSource(git("show", `${updateSha}:${PIN_FILE}`));
    if (pinKeys.every((key) => current[key] === artifact.next[key])) {
      // A failed second push can leave a new PR with pins but no history. Retry
      // only for the exact same pins, after the human-commit and base checks.
      if (existsSync(join(cwd, HISTORY_FILE)) && git("ls-tree", updateSha, "--", HISTORY_FILE).trim()) {
        const published = JSON.parse(git("show", `${updateSha}:${HISTORY_FILE}`));
        if (!Array.isArray(published)) throw new Error("Invalid card data history");
        if (!published.some(entry => entry.pullRequest.url === pr)) historyRepair = published;
      }
      if (historyRepair === null && !compatibilityChanged && !bridgeChanged) return skip("identical-pins");
    }
    if (historyRepair === null && artifact.matchingPrHead === updateSha && !compatibilityChanged && !bridgeChanged) return skip("identical-data");
  }
  const original = git("show", `${baseSha}:${PIN_FILE}`);
  const old = readPinsFromSource(original);
  const pinsChanged = pinKeys.some((key) => old[key] !== artifact.next[key]);
  if (!pinsChanged && !compatibilityChanged && !bridgeChanged) return skip("identical-pins");
  if (!pinsChanged) historyRepair = null;
  let expected = original;
  for (const key of pinKeys) expected = expected.replace(pinPattern(key), (_, prefix, _old, suffix) => `${prefix}${artifact.next[key]}${suffix}`);
  const expectedSources = new Map(expected === original ? [] : [[PIN_FILE, expected]]);
  for (const file of CORE_PIN_FILES) {
    const source = git("show", `${baseSha}:${file}`);
    const pattern = /("cardScripts"\s*:\s*\{[^{}]*"commit"\s*:\s*")([a-f0-9]{40})(")/g;
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1 || matches[0][2] !== old.scripts || JSON.parse(source).cardScripts?.commit !== old.scripts) {
      throw new Error(`Expected a synchronized cardScripts pin in ${file}`);
    }
    const updated = source.replace(pattern, (_, prefix, _old, suffix) => `${prefix}${artifact.next.scripts}${suffix}`);
    if (updated !== source) expectedSources.set(file, updated);
  }
  const expectedFiles = [...expectedSources.keys(), ...artifact.files.filter(file => COMPATIBILITY_FILES.includes(file) || BRIDGE_FILES.includes(file))].sort();
  if (JSON.stringify([...artifact.files].sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("Artifact files must include exactly the changed synchronized pins and Dueling Book JSON");
  }

  // Apply only to a disposable index, then verify exact paths, modes and pin-only content. The untrusted patch
  // never touches the working tree; only the verified expected source is written after validation succeeds.
  const temporary = mkdtempSync(join(tmpdir(), "engine-data-index-"));
  try {
    const indexEnv = { ...env, GIT_INDEX_FILE: join(temporary, "index") };
    const indexGit = (...args) => run("git", args, { cwd, env: indexEnv });
    indexGit("read-tree", baseSha);
    indexGit("apply", "--cached", "--check", join(artifactDir, "update.patch"));
    indexGit("apply", "--cached", join(artifactDir, "update.patch"));
    const changed = indexGit("diff", "--cached", "--name-status", "-z", baseSha);
    if (changed !== expectedFiles.map((file) => `M\0${file}\0`).join("")) throw new Error("Patch changes files outside the exact pin allowlist");
    if (compatibilityChanged) {
      const table = indexGit("show", `:${TABLE_FILE}`), names = indexGit("show", `:${NAMES_FILE}`);
      validateCompatibility(table, names);
      for (const file of COMPATIBILITY_FILES) if (artifact.files.includes(file)) expectedSources.set(file, file === TABLE_FILE ? table : names);
    }
    for (const file of artifact.files.filter(file => BRIDGE_FILES.includes(file))) expectedSources.set(file, readFileSync(join(artifactDir, file)));
    for (const [file, source] of expectedSources) {
      const modeBefore = git("ls-tree", baseSha, "--", file).split(" ")[0];
      const modeAfter = indexGit("ls-files", "--stage", "--", file).split(" ")[0];
      if (modeBefore !== "100644" || modeAfter !== modeBefore) throw new Error("Patch must preserve the regular pin file mode");
      const matches = Buffer.isBuffer(source)
        ? indexGit("rev-parse", `:${file}`).trim() === git("hash-object", join(artifactDir, file)).trim()
        : indexGit("show", `:${file}`) === source;
      if (!matches) throw new Error(`Patch must only replace the validated data in ${file}`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }

  if (pr && updateSha && compatibilityChanged) {
    const identical = DATA_FILES.every(file => git("ls-tree", updateSha, "--", file).trim() &&
      git("show", `${updateSha}:${file}`) === (expectedSources.get(file) ?? git("show", `${baseSha}:${file}`)));
    // History-only recovery is valid only for the same candidate, including both JSON files.
    if (!identical) historyRepair = null;
    else if (historyRepair === null) return skip("identical-data");
  }

  if (git("status", "--porcelain", "--untracked-files=no").trim()) throw new Error("Publication requires a clean tracked checkout");
  const body = join(artifactDir, existsSync(join(artifactDir, "pr-body.md")) ? "pr-body.md" : "report.md");
  readFileSync(body, "utf8"); // Require a usable report before publishing the branch.
  // Older checkouts/artifacts can still publish pins. History is generated here by trusted
  // code, never accepted as a writable path in the untrusted candidate patch.
  const history = historyRepair ?? (existsSync(join(cwd, HISTORY_FILE)) ? JSON.parse(readFileSync(join(cwd, HISTORY_FILE), "utf8")) : null);
  const details = history === null || !pinsChanged ? null : historyDetails(artifact);
  const date = new Date().toISOString();
  const title = pinsChanged ? `chore(engine): update Project Ignis card data to ${date.slice(0, 10)}`
    : bridgeChanged ? "chore(cards): rebuild archetype bridges" : "chore(engine): update Dueling Book passcode table";
  const recordHistory = (url) => {
    writeFileSync(join(cwd, HISTORY_FILE), JSON.stringify(appendHistory(history, details,
      { date, label: `Project Ignis ${date.slice(0, 10)}`, url, repository: repo }), null, 2) + "\n");
    git("add", "--", HISTORY_FILE);
  };
  git("switch", "--detach", historyRepair === null ? baseSha : updateSha);
  if (historyRepair === null) {
    for (const [file, source] of expectedSources) writeFileSync(join(cwd, file), source);
    git("add", "--", ...artifact.files);
  }
  if (details && pr) recordHistory(pr);
  const authorEnv = { ...env, GIT_AUTHOR_NAME: BOT.name, GIT_AUTHOR_EMAIL: BOT.email, GIT_COMMITTER_NAME: BOT.name, GIT_COMMITTER_EMAIL: BOT.email };
  run("git", ["-c", "commit.gpgsign=false", "commit", "-m", historyRepair === null ? title : "chore(engine): record card data update history"], { cwd, env: authorEnv });
  // An explicit empty lease protects branch creation too. A new commit after our fetch makes the push fail.
  git("push", `--force-with-lease=refs/heads/${branch}:${updateSha}`, "origin", `HEAD:refs/heads/${branch}`);
  let prUrl = pr;
  if (prUrl && historyRepair === null) gh("pr", "edit", prUrl, "--repo", repo, "--title", title, "--body-file", body);
  else if (!prUrl) prUrl = gh("pr", "create", "--repo", repo, "--base", base, "--head", branch, "--title", title, "--body-file", body).trim();
  if (!/^https:\/\/\S+\/pull\/\d+$/.test(prUrl)) throw new Error("gh did not return a pull request URL");
  if (details && !pr) {
    // A new PR number exists only after the first push. Store its exact link in a
    // second bot commit, protected by a lease on the commit we just published.
    const publishedSha = git("rev-parse", "HEAD").trim();
    recordHistory(prUrl);
    run("git", ["-c", "commit.gpgsign=false", "commit", "-m", "chore(engine): record card data update history"], { cwd, env: authorEnv });
    git("push", `--force-with-lease=refs/heads/${branch}:${publishedSha}`, "origin", `HEAD:refs/heads/${branch}`);
  }
  const labels = gh("api", "--paginate", `repos/${repo}/labels?per_page=100`, "--jq", ".[].name").trim().split("\n");
  if (labels.includes("engine-data")) gh("pr", "edit", prUrl, "--repo", repo, "--add-label", "engine-data");
  if (env.HAS_PR_TOKEN !== "true") gh("workflow", "run", "test.yml", "--repo", repo, "--ref", branch, "-f", "nightly=false", "-f", "new_card_smoke=true");
  log(`Engine data update published: ${prUrl}`);
  return { status: "published", pushed: true, prUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishEngineData().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
