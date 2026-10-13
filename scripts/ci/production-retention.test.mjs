import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const load = () => parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const services = ['duel', 'web', 'worker', 'ws'];
const mediaType = 'application/vnd.oci.image.manifest.v1+json';
const body = release => JSON.stringify({ schemaVersion: 2, mediaType, release });
const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const current = body('current');
const previous = body('previous');
const references = services.map(service => `${service} ${digest(current)}`).join('\n');

async function run({ old = previous, refs = references, failure = () => 0, deployedAttempt = '1', runAttempt = '1', missing = [] } = {}) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'production-retention-'));
  const release = join(runnerTemp, 'deployed-release');
  mkdirSync(release);
  if (!missing.includes('image-digests')) writeFileSync(join(release, 'image-digests'), refs);
  if (!missing.includes('confirmed-attempt')) writeFileSync(join(release, 'confirmed-attempt'), `${deployedAttempt}\n`);
  const writes = [];
  const reads = [];
  const fetch = async (url, options = {}) => {
    const status = failure(url, options) || (url.endsWith('/production') && options.method !== 'PUT' && !old ? 404 : 200);
    if (url.startsWith('https://ghcr.io/token?')) {
      assert.match(url, /scope=repository:duelingdomain\/yugioh-bot-(duel|web|worker|ws):pull,push/);
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from('owner:job-token').toString('base64')}`);
      return { ok: status === 200, status, json: async () => ({ token: 'registry-token' }) };
    }
    assert.equal(options.headers.Authorization, 'Bearer registry-token');
    if (options.method === 'PUT') {
      assert.equal(reads.length, 8, 'finish every manifest read before changing tags');
      writes.push({ url, body: options.body, type: options.headers['Content-Type'] });
      return { ok: status === 200, status };
    }
    reads.push(url);
    const content = url.endsWith('/production') ? old : current;
    return { ok: status === 200, status, text: async () => content, headers: {
      get: name => name === 'content-type' ? mediaType : digest(content),
    } };
  };
  const job = load().jobs.retain;
  assert.ok(job, 'retain healthy release digests in a runner job');
  const script = job.steps.find(step => step.with?.script).with.script;
  try {
    await new AsyncFunction('context', 'core', 'fetch', 'process', script)(
      { actor: 'owner', repo: { owner: 'DuelingDomain' } }, { info() {} }, fetch,
      { env: { GHCR_TOKEN: 'job-token', RUNNER_TEMP: runnerTemp, RUN_ATTEMPT: runAttempt,
        DEPLOY_IMAGE_DIGESTS: '', DEPLOY_CONFIRMED_ATTEMPT: '' } });
    return { writes, reads };
  } catch (error) {
    error.writes = writes;
    throw error;
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}

test('only the successful deploy enables retention with the job package token', () => {
  const { deploy, retain } = load().jobs;
  assert.equal(deploy.env.DEPLOY_COMMIT, '${{ needs.prepare.outputs.commit }}');
  assert.ok(retain);
  assert.deepEqual(retain.needs, ['prepare', 'deploy']);
  assert.match(retain.if, /!cancelled\(\).*needs.deploy.result == 'success'/);
  assert.deepEqual(retain.permissions, { packages: 'write' });
  assert.equal(retain.env.GHCR_TOKEN, '${{ github.token }}');
  assert.equal(retain.env.DEPLOY_IMAGE_DIGESTS, undefined);
  assert.equal(retain.env.DEPLOY_CONFIRMED_ATTEMPT, undefined);
  assert.equal(deploy.outputs, undefined, 'healthy deployment records must not pass through secret-filtered job outputs');
  assert.equal(retain.env.RUN_ATTEMPT, '${{ github.run_attempt }}');
  const confirm = deploy.steps.find(step => step.name === 'Record healthy deployment attempt');
  assert.match(confirm.run, /GITHUB_RUN_ATTEMPT.*\$RUNNER_TEMP\/release\/confirmed-attempt/);
  assert.equal(confirm.if, "${{ env.VM_DEPLOY_ENABLED == 'true' }}");
  assert.ok(deploy.steps.indexOf(confirm) > deploy.steps.findIndex(step => step.name === 'Deploy over SSH'));
  const record = deploy.steps.find(step => step.name === 'Prepare deployment transfer');
  assert.equal(record.if, undefined, 'normal and rollback deploys use the same exact digest file');
  assert.doesNotMatch(record.run, /GITHUB_OUTPUT/);
  const upload = deploy.steps.find(step => step.name === 'Upload healthy deployment record');
  assert.ok(upload, 'upload the exact deployed digests and health confirmation together');
  assert.ok(deploy.steps.indexOf(upload) > deploy.steps.indexOf(confirm));
  assert.equal(upload.if, confirm.if);
  assert.equal(upload.uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  assert.equal(upload.with.name, 'production-deployed-${{ env.DEPLOY_COMMIT }}-${{ github.run_attempt }}');
  assert.equal(upload.with.path, '${{ runner.temp }}/release/image-digests\n${{ runner.temp }}/release/confirmed-attempt\n');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with['retention-days'], 1);
  assert.equal(Object.hasOwn(upload.with, 'overwrite'), false);
  const download = retain.steps[0];
  assert.equal(download.uses, 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  assert.equal(download.with.name, 'production-deployed-${{ needs.prepare.outputs.commit }}-${{ github.run_attempt }}');
  assert.equal(download.with.path, '${{ runner.temp }}/deployed-release');
  assert.ok(retain.steps.every(step => !step.run?.includes('ssh')));
});

test('build and deploy reject missing or invalid prepare commits before checkout or downloads', () => {
  const jobs = load().jobs;
  for (const name of ['build', 'deploy']) {
    const job = jobs[name];
    assert.equal(job.env.DEPLOY_COMMIT, '${{ needs.prepare.outputs.commit }}');
    const guard = job.steps[0];
    assert.equal(guard.name, 'Validate prepare commit output');
    assert.equal(guard.if, undefined, 'validate every build and deploy, including rollbacks');
    for (const commit of ['0123456789abcdef0123456789abcdef01234567', '0'.repeat(40),
      '', 'main', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'g'.repeat(40), `${'a'.repeat(40)}\n`]) {
      const valid = /^[0-9a-f]{40}$/.test(commit);
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', guard.run], {
        encoding: 'utf8', env: { ...process.env, DEPLOY_COMMIT: commit },
      });
      assert.equal(result.status, valid ? 0 : 1, `${name}: ${JSON.stringify(commit)}: ${result.stderr}`);
      if (!valid) assert.match(result.stderr, /prepare commit output missing or invalid \(maybe masked as a secret\); dispatch a new Deploy/);
    }
  }
});

test('all manifests are read before rotation, and tags keep the exact deployed and previous digests', async () => {
  const { writes, reads } = await run();
  assert.equal(reads.length, 8);
  assert.equal(writes.length, 8);
  for (const [i, service] of services.entries()) {
    const base = `https://ghcr.io/v2/duelingdomain/yugioh-bot-${service}/manifests/`;
    assert.deepEqual(writes.slice(i * 2, i * 2 + 2), [
      { url: `${base}production-prev`, body: previous, type: mediaType },
      { url: `${base}production`, body: current, type: mediaType },
    ]);
  }
});

test('the first deploy adds production tags without inventing a previous image', async () => {
  const { writes } = await run({ old: null });
  assert.equal(writes.length, 4);
  assert.ok(writes.every(write => write.url.endsWith('/production')));
});

test('a repeated healthy deploy does not replace production-prev with itself', async () => {
  const { writes } = await run({ old: current });
  assert.equal(writes.length, 4);
  assert.ok(writes.every(write => write.url.endsWith('/production')));
});

test('invalid digest input and a failed retained-manifest read stop before any tag changes', async () => {
  for (const refs of ['', references.replace('worker ', 'other '), references.replace(/sha256:[a-f0-9]{64}/, 'latest'),
    references.toUpperCase(), references.replace('duel ', 'duel extra '), references.split('\n').slice(1).join('\n'),
    `${references}\n${references.split('\n')[0]}`]) {
    await assert.rejects(run({ refs }), error => error.writes.length === 0);
  }
  for (const status of [401, 500]) {
    await assert.rejects(run({ failure: url => url.includes('yugioh-bot-ws/manifests/production') ? status : 0 }),
      error => /manifest/.test(error.message) && error.writes.length === 0);
  }
  await assert.rejects(run({ failure: url => url.includes(`yugioh-bot-ws/manifests/${digest(current)}`) ? 404 : 0 }),
    error => /manifest/.test(error.message) && error.writes.length === 0);
});

test('a failed production-prev write cannot move the production tag', async () => {
  await assert.rejects(run({ failure: (url, options) => options.method === 'PUT' && url.endsWith('/production-prev') ? 500 : 0 }),
    error => error.writes.length === 1 && error.writes[0].url.endsWith('/production-prev'));
});

test('an old failed retention retry cannot overwrite a newer production release', async () => {
  const releaseB = body('release B');
  // B is now healthy. Rerunning only A's failed retention must leave B's tags alone.
  await assert.rejects(run({ old: releaseB, deployedAttempt: '1', runAttempt: '2' }),
    error => /health checks.*current.*attempt.*Dispatch/s.test(error.message) && error.writes.length === 0);
  // C must then preserve B, rather than A, as the rollback image.
  const { writes } = await run({ old: releaseB });
  assert.ok(writes.filter(write => write.url.endsWith('/production-prev')).every(write => write.body === releaseB));
});

test('a deploy that passes health checks in a retried attempt can retain its images', async () => {
  assert.equal((await run({ deployedAttempt: '2', runAttempt: '2' })).writes.length, 8);
});

test('artifact values survive short-secret collisions that empty the former job outputs', async () => {
  assert.ok(references.includes('77'));
  assert.equal((await run({ deployedAttempt: '77', runAttempt: '77' })).writes.length, 8);
});

test('missing deployment files or invalid attempt markers fail before any tags change', async () => {
  for (const missing of [['image-digests'], ['confirmed-attempt']]) {
    await assert.rejects(run({ missing }), error => /deployment record.*no tags were changed/i.test(error.message) && error.writes.length === 0);
  }
  for (const deployedAttempt of ['', '0', '01', 'invalid']) {
    await assert.rejects(run({ deployedAttempt }), error => /health checks.*current.*attempt/s.test(error.message) && error.writes.length === 0);
  }
  for (const runAttempt of ['', '0', '01', 'invalid']) {
    await assert.rejects(run({ deployedAttempt: runAttempt, runAttempt }),
      error => /health checks.*current.*attempt/s.test(error.message) && error.writes.length === 0);
  }
});
