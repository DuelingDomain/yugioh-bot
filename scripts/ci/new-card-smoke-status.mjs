/** Explicit commit statuses also gate PRs when job checks came from workflow_dispatch. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function smokeCommitStatus(phase, reportResult, runUrl) {
  if (!["pending", "final"].includes(phase)) throw new Error("Invalid smoke status phase");
  const state = phase === "pending" ? "pending" : reportResult === "success" ? "success" : "failure";
  return { state, context: "New card engine smoke report", target_url: runUrl,
    description: state === "pending" ? "Real-engine smoke is running for new and changed cards"
      : state === "success" ? "Smoke passed; review WARN/incomplete coverage in the report"
        : "Smoke FAIL or input/infrastructure error; read the report" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const repository = process.env.GITHUB_REPOSITORY, head = process.env.SMOKE_HEAD;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("Invalid smoke status repository/head SHA");
    const url = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const status = smokeCommitStatus(process.argv[2], process.env.SMOKE_REPORT_RESULT, url);
    execFileSync("gh", ["api", "--method", "POST", `repos/${repository}/statuses/${head}`, "--input", "-"],
      { input: JSON.stringify(status), stdio: ["pipe", "ignore", "pipe"] });
    console.log(`New-card smoke commit status: ${status.state}`);
    if (status.state === "failure") process.exitCode = 1;
  } catch (error) { console.error(`::error::Cannot publish new-card smoke merge gate: ${error.message}`); process.exitCode = 2; }
}
