import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Artifact IDs are immutable. Names include the producer attempt so a queued
// Deploy cannot accidentally use a newer, still-unverified rerun's images.
export function selectProductionArtifacts(artifacts, commit, verifiedAttempt) {
  const attempt = Number(verifiedAttempt);
  if (!/^[0-9a-f]{40}$/.test(commit) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error('Invalid verified production commit or Test attempt.');
  }
  const services = ['duel', 'web', 'bot', 'worker', 'ws'];
  const find = prefix => {
    const selected = artifacts.map(artifact => {
      const match = new RegExp(`^${prefix}-${commit}-([1-9][0-9]*)$`).exec(artifact.name);
      return { artifact, attempt: match ? Number(match[1]) : 0 };
    }).filter(item => item.attempt > 0 && item.attempt <= attempt && !item.artifact.expired &&
      Number.isSafeInteger(item.artifact.id) && item.artifact.id > 0)
      .sort((a, b) => b.attempt - a.attempt)[0];
    if (!selected) throw new Error(`Missing ${prefix} for verified Test attempt ${attempt}.`);
    return selected.artifact.id;
  };
  return { bundle: find('production-bundle'), images: services.map(service => find(`production-image-${service}`)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.env.TEST_RUN_ID;
  if (!/^[1-9][0-9]*$/.test(run ?? '')) throw new Error('Invalid Test run ID.');
  const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp',
    `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${run}/artifacts?per_page=100`], { encoding: 'utf8' }));
  const selected = selectProductionArtifacts(pages.flatMap(page => page.artifacts), process.env.DEPLOY_COMMIT, process.env.TEST_RUN_ATTEMPT);
  appendFileSync(process.env.GITHUB_OUTPUT, `bundle_id=${selected.bundle}\nimage_ids=${selected.images.join(',')}\n`);
  console.log(`Verified Test ${run}, attempt ${process.env.TEST_RUN_ATTEMPT}: bundle ${selected.bundle}, images ${selected.images.join(',')}`);
}
