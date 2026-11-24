import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assetNames, assetUrl, downloadIndex, sha256 } from '../vision/index-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vision-index-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = 'vision-index-123-1';
  const files = Object.fromEntries(assetNames.map(name => [name, { url: assetUrl(release, name), bytes: name.length, sha256: sha256(name) }]));
  const manifest = { version: 1, release, cards: 14000, fingerprint: sha256('catalog'), files };
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  return { manifest, path, directory: join(root, 'vision-index') };
}

test('the web build stages a complete verified generation', async t => {
  const { manifest, path, directory } = await fixture(t);
  await downloadIndex(path, directory, async url => new Response(url.split('/').at(-1)));
  for (const name of assetNames) assert.equal(await readFile(join(directory, name), 'utf8'), name);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'index-manifest.json'), 'utf8')), manifest);
});

test('a same-sized corrupt asset cannot activate a generation', async t => {
  const { path, directory } = await fixture(t);
  await assert.rejects(downloadIndex(path, directory, async url => new Response('x'.repeat(url.split('/').at(-1).length))), /checksum mismatch/);
  await assert.rejects(access(join(directory, 'index-manifest.json')), { code: 'ENOENT' });
});

test('bootstrap without a pin maintains the volume fallback', async t => {
  const { path, directory } = await fixture(t);
  await writeFile(path, 'null\n');
  await downloadIndex(path, directory, async () => assert.fail('Unexpected download'));
  await access(directory);
  await assert.rejects(access(join(directory, 'index-manifest.json')), { code: 'ENOENT' });
});
