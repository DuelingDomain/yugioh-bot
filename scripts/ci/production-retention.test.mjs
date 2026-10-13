import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

async function run({ old = previous, refs = references, failure = () => 0, deployedAttempt = '1', runAttempt = '1' } = {}) {
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
      { env: { GHCR_TOKEN: 'job-token', DEPLOY_IMAGE_DIGESTS: refs,
        DEPLOY_CONFIRMED_ATTEMPT: deployedAttempt, RUN_ATTEMPT: runAttempt } });
    return { writes, reads };
  } catch (error) {
    error.writes = writes;
    throw error;
  }
}

test('only the successful deploy enables retention with the job package token', () => {
  const { deploy, retain } = load().jobs;
  assert.ok(retain);
  assert.equal(retain.needs, 'deploy');
  assert.match(retain.if, /!cancelled\(\).*needs.deploy.result == 'success'/);
  assert.deepEqual(retain.permissions, { packages: 'write' });
  assert.equal(retain.env.GHCR_TOKEN, '${{ github.token }}');
  assert.equal(retain.env.DEPLOY_IMAGE_DIGESTS, '${{ needs.deploy.outputs.image-digests }}');
  assert.equal(deploy.outputs['image-digests'], '${{ steps.image-refs.outputs.digests }}');
  assert.equal(deploy.outputs['confirmed-attempt'], '${{ steps.confirmed.outputs.attempt }}');
  assert.equal(retain.env.DEPLOY_CONFIRMED_ATTEMPT, '${{ needs.deploy.outputs.confirmed-attempt }}');
  assert.equal(retain.env.RUN_ATTEMPT, '${{ github.run_attempt }}');
  const confirm = deploy.steps.find(step => step.id === 'confirmed');
  assert.match(confirm.run, /GITHUB_RUN_ATTEMPT.*GITHUB_OUTPUT/);
  assert.ok(deploy.steps.indexOf(confirm) > deploy.steps.findIndex(step => step.name === 'Deploy over SSH'));
  const record = deploy.steps.find(step => step.id === 'image-refs');
  assert.match(record.run, /image-digests.*GITHUB_OUTPUT/s);
  assert.ok(retain.steps.every(step => !step.run?.includes('ssh')));
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
