import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = new URL('../deployment/production-images.sh', import.meta.url).pathname;
const sha = 'a'.repeat(40);
const registry = 'ghcr.io/duelingdomain/yugioh-bot';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'production-images-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'commands');
  writeFileSync(log, '');
  const docker = join(dir, 'docker');
  writeFileSync(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1 $2" in
  'pull '*) [ "$3" != "\${TEST_FAIL_IMAGE:-}" ] ;;
  'image inspect') printf '%s\\n' "linux/\${TEST_ARCH:-arm64} \${TEST_REVISION:-${sha}}" ;;
  'image ls')
    case "$*" in
      *ghcr.io*) printf '%s\\n' '${registry}-web:${sha}' ;;
      *) printf '%s\\n' 'yugioh-bot-web:latest' 'yugioh-bot-web:prev' 'yugioh-bot-web:obsolete' ;;
    esac ;;
esac
`);
  chmodSync(docker, 0o755);
  return {
    run: (mode, commit = sha, extra = {}) => spawnSync('sh', [script, mode, commit], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_LOG: log, ...extra },
    }),
    commands: () => readFileSync(log, 'utf8'),
  };
}

test('pull validates all four ARM64 images without changing live or previous tags', t => {
  const f = fixture(t);
  const result = f.run('pull');
  assert.equal(result.status, 0, result.stderr);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.match(f.commands(), new RegExp(`pull --platform=linux/arm64 ${registry}-${service}:${sha}`));
  }
  assert.doesNotMatch(f.commands(), /tag|build|compose|prune/);
});

test('a failed pull, wrong architecture or wrong revision cannot promote any image', t => {
  for (const extra of [{ TEST_FAIL_IMAGE: `${registry}-web:${sha}` }, { TEST_ARCH: 'amd64' }, { TEST_REVISION: 'b'.repeat(40) }]) {
    const f = fixture(t);
    assert.notEqual(f.run('pull', sha, extra).status, 0);
    assert.doesNotMatch(f.commands(), /tag|build|compose/);
  }
});

test('promotion uses the exact SHA and does not overwrite the saved previous images', t => {
  const f = fixture(t);
  const result = f.run('promote');
  assert.equal(result.status, 0, result.stderr);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.match(f.commands(), new RegExp(`tag ${registry}-${service}:${sha} yugioh-bot-${service}:latest`));
  }
  assert.doesNotMatch(f.commands(), /:prev|pull|build/);
});

test('retention removes downloaded SHA tags and obsolete local tags, keeping latest and prev', t => {
  const f = fixture(t);
  const result = f.run('prune');
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.commands(), new RegExp(`image rm ${registry}-web:${sha}`));
  assert.match(f.commands(), /image rm yugioh-bot-web:obsolete/);
  assert.match(f.commands(), /image prune -f/);
  assert.doesNotMatch(f.commands(), /image rm .*:(latest|prev)|image rm .*caddy|build|container/);
});

test('invalid SHA and command fail before Docker is called', t => {
  const f = fixture(t);
  assert.notEqual(f.run('pull', 'main').status, 0);
  assert.notEqual(f.run('build').status, 0);
  assert.equal(f.commands(), '');
});
