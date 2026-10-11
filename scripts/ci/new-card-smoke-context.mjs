/** Resolve only the same-repository card-data PR; never guess the PR from a branch name alone. */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const SMOKE_BRANCH = "chore/engine-data-update";
export function isSmokePull(pull, repository) {
  return pull?.state === "open" && pull.head?.ref === SMOKE_BRANCH && pull.head.repo?.full_name === repository
    && pull.base?.repo?.full_name === repository;
}

export async function selectSmokePull(event, eventName, repository, dispatchSha, getPulls, wait = delay) {
  let pull;
  if (eventName === "pull_request") {
    if (!isSmokePull(event.pull_request, repository)) return;
    pull = event.pull_request;
  } else if (eventName === "workflow_dispatch" && [true, "true"].includes(event.inputs?.new_card_smoke)
      && event.ref === `refs/heads/${SMOKE_BRANCH}`) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const matches = (await getPulls()).filter(candidate => isSmokePull(candidate, repository) && candidate.head.sha === dispatchSha);
      if (matches.length === 1) { [pull] = matches; break; }
      if (matches.length > 1 || attempt === 6) throw new Error("Expected one open card-data PR at the dispatched commit");
      await wait(10000);
    }
  } else return;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(pull.number) || pull.number < 1
      || !/^[a-f0-9]{40}$/.test(pull.base.sha) || !/^[a-f0-9]{40}$/.test(pull.head.sha)) {
    throw new Error("Invalid card-data PR number, repository or immutable base/head SHA");
  }
  return { repository, number: pull.number, baseSha: pull.base.sha, headSha: pull.head.sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const context = await selectSmokePull(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      process.env.GITHUB_EVENT_NAME, repository, process.env.GITHUB_SHA, async () => {
        const query = new URLSearchParams({ state: "open", head: `${repository.split("/")[0]}:${SMOKE_BRANCH}`, per_page: "100" });
        return JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${repository}/pulls?${query}`], { encoding: "utf8" })).flat();
      });
    const outputs = { smoke_enabled: !!context, smoke_pr: context?.number ?? "", smoke_base: context?.baseSha ?? "", smoke_head: context?.headSha ?? "" };
    for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } catch (error) { console.error(`New-card smoke input error: ${error.message}`); process.exitCode = 2; }
}
