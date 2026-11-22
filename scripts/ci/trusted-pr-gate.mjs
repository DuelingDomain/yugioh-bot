import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { changedPathHash } from "./changed-layers.mjs";
import { covers, readTreeProof } from "./reuse-pr-result.mjs";

const isSha = sha => /^[0-9a-f]{40}$/.test(sha);
const repoMatches = (repo, id) => repo?.id === id;

function firstParentCommits(api, base, head) {
  const pages = api(`compare/${base}...${head}?per_page=100`);
  const commits = pages.flatMap(page => page.commits);
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  if (pages[0]?.status !== "ahead" || bySha.size !== pages[0].total_commits) {
    throw new Error("Incomplete comparison with the deployed baseline.");
  }
  const main = [];
  for (let sha = head; sha !== base;) {
    const commit = bySha.get(sha);
    const parent = commit?.parents?.[0]?.sha;
    if (!isSha(parent)) throw new Error("The deployed baseline is missing from first-parent history.");
    main.push(commit);
    bySha.delete(sha);
    sha = parent;
  }
  return main.reverse();
}

function collection(pages, key) {
  const items = pages.flatMap(page => page[key]);
  if (items.length !== pages[0]?.total_count) throw new Error(`Incomplete GitHub API list of ${key}.`);
  return items;
}

function changedPaths(files, limit) {
  if (!Array.isArray(files) || files.length >= limit ||
      files.some(file => !file.filename || (file.status === "renamed" && !file.previous_filename))) {
    throw new Error("Incomplete changed path list for the PR selection proof.");
  }
  return new Set(files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)));
}

function matchesPullRequest(api, run, pr, repoId) {
  if (!Array.isArray(run.pull_requests)) return false;
  if (run.pull_requests.length) return run.pull_requests.some(pull => pull.number === pr.number);

  // GitHub can clear run associations after merge. An exact SHA and branch
  // identify the PR only if that head did not have another PR to any base.
  const owner = pr.head.repo.owner?.login;
  if (!owner) return false;
  const head = encodeURIComponent(`${owner}:${pr.head.ref}`);
  const matches = api(`pulls?state=all&head=${head}&per_page=100`).flat()
    .filter(pull => pull.head?.sha === pr.head.sha && pull.head.ref === pr.head.ref &&
      repoMatches(pull.head.repo, repoId));
  return matches.length === 1 && matches[0].number === pr.number;
}

function verifyPr(api, downloadProof, commit, pr, repoId) {
  if (!repoMatches(pr.head?.repo, repoId)) throw new Error("Head is from a fork or its repository is unavailable.");
  const { sha, ref } = pr.head;
  if (commit.parents.length === 1 && sha === commit.sha) throw new Error("The PR head was pushed directly to main.");
  if (!isSha(sha) || !ref || commit.parents.length > 2 ||
      (commit.parents.length === 2 && commit.parents[1].sha !== sha)) {
    throw new Error("The merged PR head does not match the merge commit.");
  }

  const runs = collection(api(`actions/workflows/test.yml/runs?event=pull_request&head_sha=${sha}&per_page=100`), "workflow_runs");
  const run = runs.filter(run => run.name === "Test" && run.path === ".github/workflows/test.yml" &&
    run.event === "pull_request" && run.head_sha === sha && run.head_branch === ref &&
    repoMatches(run.head_repository, repoId) && repoMatches(run.repository, repoId))
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (!Number.isSafeInteger(run?.id) || !Number.isSafeInteger(run.run_number) ||
      !Number.isSafeInteger(run.run_attempt) || !matchesPullRequest(api, run, pr, repoId)) {
    throw new Error("No matching Test run for the final PR head.");
  }
  if (run.status !== "completed") throw new Error(`Latest Test run ${run.id} is incomplete.`);
  if (run.conclusion !== "success") {
    throw new Error(`Latest Test run ${run.id} concluded ${["failure", "cancelled", "timed_out"].includes(run.conclusion) ?
      run.conclusion : "without success"}.`);
  }
  const path = `actions/runs/${run.id}`;
  const jobs = collection(api(`${path}/attempts/${run.run_attempt}/jobs?per_page=100`), "jobs");
  const results = jobs.filter(job => job.name === "CI result");
  if (results.length !== 1 || results[0].conclusion !== "success" ||
      !(Date.parse(results[0].completed_at) < Date.parse(pr.merged_at))) {
    throw new Error(`Test run ${run.id} has no passing CI result before merge.`);
  }

  const proofs = collection(api(`${path}/artifacts?per_page=100`), "artifacts")
    .filter(artifact => artifact.name.startsWith("pr-tested-tree-") && !artifact.expired);
  if (!proofs.length) return `Test run ${run.id} passed CI result; no selection proof available.`;
  if (proofs.length !== 1 || !Number.isSafeInteger(proofs[0].id)) throw new Error("Ambiguous PR selection proof.");
  const proof = downloadProof(proofs[0].id);
  const prPaths = changedPaths(api(`pulls/${pr.number}/files?per_page=100`).flat(), 3000);
  const diffHash = changedPathHash(prPaths);
  const tree = proofs[0].name.slice("pr-tested-tree-".length);
  // The tested base may predate the integration's first parent. Verify the
  // recorded paths, then check that the merge did not add any untested paths.
  if (!prPaths.size || !covers(proof, { tree, parent: proof?.parent ?? "", diffHash, attempt: run.run_attempt })) {
    throw new Error(`Test run ${run.id} selection proof does not match the attempt and PR changed paths.`);
  }
  const [integration] = api(`compare/${commit.parents[0].sha}...${commit.sha}?per_page=1`, false);
  if (integration?.status !== "ahead") throw new Error("Incomplete comparison with the merge's first parent.");
  const mergedPaths = changedPaths(integration.files, 300);
  if ([...mergedPaths].some(file => !prPaths.has(file))) {
    throw new Error(`Main commit changes paths outside the PR selection proof from Test run ${run.id}.`);
  }
  return `Test run ${run.id} passed CI result and its selection proof covers the merged paths.`;
}

export function resolveTrustedPrs({ api, downloadProof, base, head, repoId }) {
  if (!isSha(base) || !isSha(head) || base === head || !Number.isSafeInteger(repoId) || repoId < 1) {
    return { trusted: false, entries: ["No usable deployed baseline or repository metadata."] };
  }

  let commits;
  try {
    commits = firstParentCommits(api, base, head);
  } catch (error) {
    return { trusted: false, entries: [error.message] };
  }

  let trusted = true;
  const entries = [];
  // Every integration on main needs its own PR. The side history belongs to
  // that PR, so its individual commits do not need separate Test runs.
  for (const commit of commits) {
    let subject = `Commit ${commit.sha.slice(0, 12)}`;
    try {
      const associated = api(`commits/${commit.sha}/pulls?per_page=100`).flat();
      const matches = associated.filter(pr => pr.merged_at && pr.merge_commit_sha === commit.sha &&
        pr.base?.ref === "main" && repoMatches(pr.base.repo, repoId));
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].number)) {
        throw new Error("No merged PR uniquely accounts for this main commit.");
      }
      const pr = matches[0];
      subject = `PR #${pr.number} (${commit.sha.slice(0, 12)})`;
      entries.push(`${subject} trusted: ${verifyPr(api, downloadProof, commit, pr, repoId)}`);
    } catch (error) {
      trusted = false;
      entries.push(`${subject} untrusted: ${error.message}`);
    }
  }
  return { trusted, entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { BASELINE, DIFF_HASH, ENGINE_SELECTED, GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID,
    GITHUB_SHA, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  // Leave enough of the changes job's existing timeout for test selection.
  const deadline = Date.now() + 30_000;
  const gh = (path, paginate = false) => {
    const timeout = Math.min(deadline - Date.now(), 10_000);
    if (timeout <= 0) throw new Error("GitHub API lookup budget exhausted.");
    const args = paginate ? ["--paginate", "--slurp"] : [];
    try {
      return execFileSync("gh", ["api", ...args, `repos/${GITHUB_REPOSITORY}/${path}`], {
        stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout,
      });
    } catch {
      throw new Error(`GitHub API lookup failed for ${path.split("?")[0]}.`);
    }
  };
  const { trusted, entries } = resolveTrustedPrs({
    api: (path, paginate = true) => {
      const result = JSON.parse(gh(path, paginate));
      return paginate ? result : [result];
    },
    downloadProof: id => readTreeProof(gh(`actions/artifacts/${id}/zip`)),
    base: BASELINE, head: GITHUB_SHA, repoId: Number(GITHUB_REPOSITORY_ID),
  });
  const fast = ENGINE_SELECTED === "true" && trusted && !!DIFF_HASH;
  const decision = !DIFF_HASH ? "Run the regular gate because the deployed-baseline diff is unavailable." :
    !trusted ? "Run the regular gate because some main commits lack trusted PR evidence." :
    fast ? "Use engine smoke with the normal non-engine checks and image gate." :
    "Engine smoke is unnecessary because the area selector did not select engine tests.";
  const summary = ["### Trusted PR gate", "", decision, "", ...entries.map(entry => "- " + entry), ""].join("\n");
  console.log(summary);
  appendFileSync(GITHUB_STEP_SUMMARY, summary + "\n");
  appendFileSync(GITHUB_OUTPUT, `trusted=${trusted}\nengine=${fast}\n`);
}
