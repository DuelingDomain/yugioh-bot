import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const shaPattern = "[0-9a-f]{40}";
const automaticTitle = new RegExp(`^Deploy (${shaPattern}) \\(Test success\\)$`);
const manualTitle = new RegExp(`^Deploy (${shaPattern})$`);

// The Deploy run's head_sha is the workflow revision. The run title records
// the automatic target (or manual SHA input), and the healthy artifact records
// the resolved target when the operator dispatched a symbolic ref.
export function deployedCommit(run, jobs, artifacts = []) {
  const deploy = jobs.find(job => job.name === "Deploy to Production VM");
  if (!deploy?.steps?.some(step => step.name === "Deploy over SSH" && step.conclusion === "success")) {
    return undefined;
  }
  if (run.event === "workflow_run") return automaticTitle.exec(run.display_title)?.[1] ?? "";
  if (run.event !== "workflow_dispatch") return "";
  const recorded = new RegExp(`^production-deployed-(${shaPattern})-${run.run_attempt}$`);
  const matches = artifacts.flatMap(artifact => recorded.exec(artifact.name)?.[1] ?? []);
  return matches.length === 1 ? matches[0] : manualTitle.exec(run.display_title)?.[1] ?? "";
}

export function resolveTestedMainBase(api, head, fetchBase) {
  const { workflow_runs: runs } = api("actions/workflows/deploy.yml/runs?branch=main&per_page=20");
  // The VM step can be healthy while the serialized workflow is still
  // retaining images or reporting the release.
  const possible = runs.filter(run => ["completed", "in_progress"].includes(run.status));
  for (const run of possible.sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const path = `actions/runs/${run.id}`;
    const { jobs } = api(`${path}/attempts/${run.run_attempt}/jobs?per_page=100`);
    let base = deployedCommit(run, jobs);
    if (base === undefined) continue;
    if (!base && run.event === "workflow_dispatch") {
      base = deployedCommit(run, jobs, api(`${path}/artifacts?per_page=100`).artifacts);
    }
    // If a deployment succeeded but its ref cannot be recovered, an older
    // release may be the wrong base (for example, after a manual rollback).
    if (!base || base === head) return "";
    if (api(`compare/${base}...${head}?per_page=1`).status !== "ahead") return "";
    // Deploy only confirms targets that passed the Test push gate. Fetch the
    // validated base snapshot without downloading the entire main history.
    fetchBase(base);
    return base;
  }
  return "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let base = "";
  try {
    const api = path => JSON.parse(execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/${path}`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
    }));
    base = resolveTestedMainBase(api, process.env.GITHUB_SHA, sha =>
      execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", sha], { stdio: "inherit" }));
  } catch (error) {
    console.warn(`Could not resolve the deployed main baseline: ${error.message}`);
  }
  console.log(base ? `Deployed main baseline: ${base}` : "No usable deployed main baseline; running every test group.");
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\n`);
}
