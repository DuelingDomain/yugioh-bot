import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function covers(proof, { tree, parent, diffHash, attempt }) {
  // The selector uses both the baseline's sources and the changed path list.
  // Matching the tree alone could miss changes from an undeployed main push.
  return /^[a-f0-9]{40}$/.test(tree) && /^[a-f0-9]{40}$/.test(parent) &&
    /^[a-f0-9]{64}$/.test(diffHash) && proof?.tree === tree && proof.parent === parent &&
    proof.diffHash === diffHash && proof.attempt === String(attempt);
}

export function findReusableRun(api, downloadProof, selection) {
  const name = `pr-tested-tree-${selection.tree}`;
  const { artifacts } = api(`actions/artifacts?name=${name}&per_page=20`);
  for (const artifact of artifacts) {
    if (artifact.name !== name || artifact.expired || !artifact.workflow_run?.id) continue;
    const source = api(`actions/runs/${artifact.workflow_run.id}`);
    if (source.path !== ".github/workflows/test.yml" || source.event !== "pull_request" ||
        source.conclusion !== "success" || !source.head_repository?.id ||
        source.head_repository.id !== source.repository?.id) continue;
    const proof = downloadProof(artifact.id);
    if (covers(proof, { ...selection, attempt: source.run_attempt })) return source.id;
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = ref => execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
  const gh = path => execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/${path}`], {
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 20,
  });
  const { BASELINE, DIFF_HASH, EVENT, GITHUB_OUTPUT } = process.env;
  try {
    const tree = git("HEAD^{tree}");
    if (EVENT === "pull_request") {
      appendFileSync(GITHUB_OUTPUT, `tree=${tree}\nparent=${git("HEAD^1")}\n`);
    } else if (EVENT === "push" && BASELINE && DIFF_HASH) {
      const run = findReusableRun(path => JSON.parse(gh(path)), id => {
        const dir = mkdtempSync(join(tmpdir(), "pr-proof-"));
        try {
          const zip = join(dir, "proof.zip");
          writeFileSync(zip, gh(`actions/artifacts/${id}/zip`));
          return JSON.parse(execFileSync("unzip", ["-p", zip, "proof.json"], {
            encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024,
          }));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }, { tree, parent: BASELINE, diffHash: DIFF_HASH });
      if (run) {
        console.log(`Tree ${tree} already passed PR Test run ${run}; using its test result.`);
        appendFileSync(GITHUB_OUTPUT, "reused=true\n");
      } else {
        console.log("No matching successful PR proof; running the selected tests.");
      }
    }
  } catch (error) {
    console.warn(`Could not resolve PR test proof: ${error.message}`);
  }
}
