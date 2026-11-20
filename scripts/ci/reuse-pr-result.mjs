import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Test jobs by area. A main push whose tree was already fully tested by a passing PR run
// with at least the same areas selected skips those jobs; production images are still built.
export const areas = ['web', 'bot', 'ws', 'worker', 'shared', 'duel_unit', 'e2e', 'ci_scripts', 'effects', 'engine', 'engine_app', 'core', 'golden'];

// Areas a run must have passed. A data-only web change skips the web build, so it is a weaker web check.
export const required = flags => new Set([
  ...areas.filter(area => flags[area] === 'true'),
  ...(flags.web === 'true' && flags.data_only !== 'true' ? ['web_build'] : []),
]);

// The PR proof covers the push when it passed every area the push needs. An unreadable proof never covers it.
export const covers = (proof, flags) => {
  if (!proof || typeof proof.flags !== 'object' || proof.flags === null) return false;
  const passed = required(proof.flags);
  return [...required(flags)].every(area => passed.has(area));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.env.GITHUB_OUTPUT;
  const repo = process.env.GITHUB_REPOSITORY;
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  appendFileSync(out, `tree=${tree}\n`);
  // Fail open: every problem below means the normal path-selected tests run.
  if (process.env.EVENT === 'push') try {
    const flags = JSON.parse(process.env.DIFF);
    if (required(flags).size === 0) process.exit(0);
    const name = `pr-tested-tree-${tree}`;
    const found = JSON.parse(execFileSync('gh', ['api', '--method', 'GET', `repos/${repo}/actions/artifacts`,
      '-f', `name=${name}`, '-f', 'per_page=20'], { encoding: 'utf8' })).artifacts
      .filter(a => a.name === name && !a.expired && a.workflow_run && a.workflow_run.head_repository_id === a.workflow_run.repository_id);
    for (const artifact of found) {
      const dir = mkdtempSync(join(tmpdir(), 'pr-proof-'));
      const zip = join(dir, 'proof.zip');
      writeFileSync(zip, execFileSync('gh', ['api', `repos/${repo}/actions/artifacts/${artifact.id}/zip`], { maxBuffer: 1 << 20 }));
      const proof = JSON.parse(execFileSync('unzip', ['-p', zip, 'proof.json'], { encoding: 'utf8' }));
      if (proof.tree === tree && proof.result === 'success' && covers(proof, flags)) {
        console.log(`Tree ${tree} already passed PR Test run ${proof.run}; skipping repeated test jobs on main.`);
        appendFileSync(out, areas.map(area => `${area}=false\n`).join('') + `reused=true\nreused_run=${proof.run}\n`);
        process.exit(0);
      }
    }
    console.log(`No covering PR proof for tree ${tree}; running the selected tests.`);
  } catch (error) {
    console.warn(`Cannot check PR proof; running the selected tests. ${error.message}`);
  }
}
