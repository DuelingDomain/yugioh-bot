import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A cancelled main run may contain engine changes absent from event.before..sha.
// Only a fully successful main push ancestor can bound a safe incremental diff.
export function testedMainBase(runs, head, isAncestor) {
  return runs.find(run => /^[0-9a-f]{40}$/.test(run.head_sha) && run.head_sha !== head &&
    run.event === 'push' && run.head_branch === 'main' && run.conclusion === 'success' && isAncestor(run.head_sha))?.head_sha ?? '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let base = '';
  try {
    const data = JSON.parse(execFileSync('gh', ['api', '--method', 'GET',
      `repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/test.yml/runs`,
      '-f', 'branch=main', '-f', 'event=push', '-f', 'status=success', '-f', 'per_page=100'], { encoding: 'utf8' }));
    base = testedMainBase(data.workflow_runs, process.env.GITHUB_SHA, sha =>
      spawnSync('git', ['merge-base', '--is-ancestor', sha, process.env.GITHUB_SHA]).status === 0);
  } catch (error) {
    console.warn(`Cannot resolve a tested main ancestor; all engine suites will run. ${error.message}`);
  }
  console.log(base ? `Tested main ancestor: ${base}` : 'No tested main ancestor; all engine suites will run.');
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\n`);
}
