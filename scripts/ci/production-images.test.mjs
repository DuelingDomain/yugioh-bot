import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = new URL('../deployment/production-images.sh', import.meta.url).pathname;
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const registry = 'ghcr.io/duelingdomain/yugioh-bot';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'production-images-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const refs = join(dir, 'image-digests');
  writeFileSync(refs, ['duel', 'web', 'worker', 'ws'].map(service => `${service} ${digest}\n`).join(''));
  const log = join(dir, 'commands');
  writeFileSync(log, '');
  const df = join(dir, 'df');
  writeFileSync(df, '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nroot 10000000 1 %s 1%% /fake\\n" "${TEST_FREE_KIB:-7000000}"\n');
  chmodSync(df, 0o755);
  const docker = join(dir, 'docker');
  writeFileSync(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1 $2" in
  'pull '*) [ "$3" != "\${TEST_FAIL_IMAGE:-}" ] ;;
  'info '*) printf '%s\\n' /fake/docker ;;
  'image inspect')
    case "$*" in
      *'.Id'*)
        case "$5" in
          yugioh-bot-*:latest) printf '%s\\n' "\${TEST_LATEST_ID:-latest-id}" ;;
          yugioh-bot-*:prev) printf '%s\\n' "\${TEST_PREVIOUS_ID:-previous-id}" ;;
          *ghcr.io*) printf '%s\\n' "\${TEST_SHA_ID:-old-id}" ;;
          *) printf '%s\\n' "$5" ;;
        esac ;;
      *'.Os'*) printf '%s\\n' "linux/\${TEST_ARCH:-arm64} \${TEST_REVISION:-${sha}}" ;;
      *'org.opencontainers.image.revision'*) printf '%s\\n' "\${TEST_CURRENT_REVISION:-}" ;;
      *) [ "\${TEST_PREV_EXISTS:-true}" = true ] ;;
    esac ;;

  'image ls')
    case "$*" in
      *--digests*) printf '%s\\n' "\${TEST_DIGEST_IMAGES:-}" ;;
      *ghcr.io*) printf '%s\\n' '${registry}-web:${sha}' '${registry}-web:latest' '${registry}-web:prev' '${registry}-web:pre-ghcr' '${registry}-web:buildcache' '${registry}-web:nextcache' ;;
      *) printf '%s\\n' 'yugioh-bot-web:latest' 'yugioh-bot-web:prev' 'yugioh-bot-web:obsolete' ;;
    esac ;;
esac
`);
  chmodSync(docker, 0o755);
  return {
    run: (mode, commit = sha, extra = {}, args = []) => spawnSync('sh', [script, mode, commit, ...(['pull', 'promote'].includes(mode) ? [refs] : args)], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_LOG: log, ...extra },
    }),
    commands: () => readFileSync(log, 'utf8'),
    references: content => writeFileSync(refs, content),
  };
}

test('pull validates all four ARM64 images without changing live or previous tags', t => {
  const f = fixture(t);
  const result = f.run('pull');
  assert.equal(result.status, 0, result.stderr);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.match(f.commands(), new RegExp(`pull --platform=linux/arm64 ${registry}-${service}@${digest}`));
  }
  assert.doesNotMatch(f.commands(), /tag .*yugioh-bot-.*:(latest|prev)|build|compose|prune/);
  assert.match(f.commands(), new RegExp(`tag ${registry}-web@${digest} ${registry}-web:${sha}`));
});

test('a failed pull, wrong architecture or wrong revision cannot promote any image', t => {
  for (const extra of [{ TEST_FAIL_IMAGE: `${registry}-web@${digest}` }, { TEST_ARCH: 'amd64' }, { TEST_REVISION: 'b'.repeat(40) }]) {
    const f = fixture(t);
    assert.notEqual(f.run('pull', sha, extra).status, 0);
    assert.doesNotMatch(f.commands(), /tag|build|compose/);
  }
});

test('promotion uses the exact build digest and does not overwrite the saved previous images', t => {
  const f = fixture(t);
  const result = f.run('promote');
  assert.equal(result.status, 0, result.stderr);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.match(f.commands(), new RegExp(`tag ${registry}-${service}@${digest} yugioh-bot-${service}:latest`));
  }
  assert.doesNotMatch(f.commands(), /:prev|pull|build/);
});

test('retention removes only GHCR SHA tags and keeps all local and cache tags', t => {
  const f = fixture(t);
  const result = f.run('prune');
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.commands(), new RegExp(`image rm ${registry}-web:${sha}`));
  assert.doesNotMatch(f.commands(), /image rm yugioh-bot-|image rm .*:(pre-ghcr|buildcache|nextcache)/);
  assert.doesNotMatch(f.commands(), /image rm .*:(latest|prev)|image rm .*caddy|^(build|container)\b/m);
});

test('successful retention prunes only dangling images with this project source label', t => {
  const f = fixture(t);
  assert.equal(f.run('prune').status, 0);
  const commands = f.commands().trim().split('\n');
  assert.equal(commands.at(-1), 'image prune -f --filter label=org.opencontainers.image.source=https://github.com/DuelingDomain/yugioh-bot');
  assert.equal(commands.filter(line => line.startsWith('image prune')).length, 1);
});

test('retention removes old GHCR digest references while keeping latest, prev and other repositories', t => {
  const f = fixture(t);
  const latestId = `sha256:${'1'.repeat(64)}`;
  const previousId = `sha256:${'2'.repeat(64)}`;
  const oldId = `sha256:${'3'.repeat(64)}`;
  const previousDigest = `sha256:${'c'.repeat(64)}`;
  const oldDigest = `sha256:${'d'.repeat(64)}`;
  const services = ['duel', 'web', 'worker', 'ws'];
  const images = services.flatMap(service => [
    `${registry}-${service}@${digest} ${latestId}`,
    `${registry}-${service}@${previousDigest} ${previousId}`,
    `${registry}-${service}@${oldDigest} ${oldId}`,
    `${registry}-${service}@<none> ${oldId}`,
  ]);
  images.push(`caddy@${oldDigest} ${oldId}`, `yugioh-bot-web@${oldDigest} ${oldId}`,
    `ghcr.io/another-project/web@${oldDigest} ${oldId}`);
  const result = f.run('prune', sha, {
    TEST_LATEST_ID: latestId, TEST_PREVIOUS_ID: previousId, TEST_DIGEST_IMAGES: images.join('\n'),
  });
  assert.equal(result.status, 0, result.stderr);
  const commands = f.commands().trim().split('\n');
  for (const service of services) {
    assert.ok(commands.includes(`image ls --digests --no-trunc --format {{.Repository}}@{{.Digest}} {{.ID}} ${registry}-${service}`));
    assert.ok(commands.includes(`image rm ${registry}-${service}@${oldDigest}`));
  }
  const removedDigests = commands.filter(line => line.startsWith('image rm') && line.includes('@'));
  assert.deepEqual(removedDigests, services.map(service => `image rm ${registry}-${service}@${oldDigest}`));
  assert.doesNotMatch(f.commands(), /image rm .*--force|image rm .* -f/);
});

test('invalid SHA and command fail before Docker is called', t => {
  const f = fixture(t);
  assert.notEqual(f.run('pull', 'main').status, 0);
  assert.notEqual(f.run('build').status, 0);
  assert.equal(f.commands(), '');
});


test('low or unreadable disk space refuses before the first pull', t => {
  for (const free of ['6291455', 'invalid', '']) {
    const f = fixture(t);
    const result = f.run('pull', sha, { TEST_FREE_KIB: free || 'invalid' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disk|space/i);
    assert.doesNotMatch(f.commands(), /pull|tag|prune/);
  }
  const f = fixture(t);
  assert.equal(f.run('pull', sha, { TEST_FREE_KIB: '6291456' }).status, 0);
});

test('a retry after failed health checks keeps the old VM-built previous image', t => {
  const f = fixture(t);
  const previous = 'yugioh-bot-web:prev';
  assert.equal(f.run('preserve', sha, {}, ['vm-built-id', previous]).status, 0);
  assert.equal(f.run('preserve', sha, { TEST_CURRENT_REVISION: sha }, ['failed-ghcr-id', previous]).status, 0);
  assert.match(f.commands(), /tag vm-built-id yugioh-bot-web:prev/);
  assert.doesNotMatch(f.commands(), /tag failed-ghcr-id/);
});

test('an unconfirmed GHCR release keeps the first-cutover rollback until health succeeds', t => {
  const f = fixture(t);
  const previous = 'yugioh-bot-web:prev';
  const revision = 'b'.repeat(40);
  assert.equal(f.run('preserve', sha, { TEST_CURRENT_REVISION: revision }, ['unconfirmed-id', previous]).status, 0);
  assert.doesNotMatch(f.commands(), /tag unconfirmed-id/);
  assert.equal(f.run('preserve', sha, { TEST_CURRENT_REVISION: revision, DEPLOY_CONFIRMED_IMAGE: 'confirmed-id' }, ['confirmed-id', previous]).status, 0);
  assert.match(f.commands(), /tag confirmed-id yugioh-bot-web:prev/);
});


test('all digests must be valid before any Docker call', t => {
  for (const broken of [
    `duel ${digest}\nweb ${digest}\nworker ${digest}\n`,
    `duel ${digest}\nweb ${digest}\nworker ${digest}\nws latest\n`,
    `duel ${digest}\nweb ${digest}\nworker ${digest}\nws ${digest}\nws ${digest}\n`,
  ]) {
    const f = fixture(t);
    f.references(broken);
    assert.notEqual(f.run('pull').status, 0);
    assert.equal(f.commands(), '');
  }
});


test('prune retains SHA bookkeeping tags while their image is latest or prev', t => {
  for (const imageId of ['latest-id', 'previous-id']) {
    const f = fixture(t);
    assert.equal(f.run('prune', sha, { TEST_SHA_ID: imageId }).status, 0);
    assert.doesNotMatch(f.commands(), /image rm/);
  }
});

test('a failed rebuild of a confirmed SHA cannot replace the good rollback image', t => {
  const f = fixture(t);
  const result = f.run('preserve', sha, {
    TEST_CURRENT_REVISION: 'b'.repeat(40), DEPLOY_CONFIRMED_IMAGE: 'good-build-id',
  }, ['failed-rebuild-id', 'yugioh-bot-web:prev']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(f.commands(), /tag failed-rebuild-id/);
});
