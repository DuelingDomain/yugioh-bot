import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const [failure, expectedCalls, expectedStatus] of [
  ['', 1, 0],
  ['Type error: property is missing', 1, 7],
  ['Failed to fetch `Oxanium` from Google Fonts.', 2, 0],
  ['Failed to download font from https://fonts.gstatic.com/font.woff2', 2, 0],
]) {
  test(`web build retry: ${failure || 'success'}`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-web-build-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'npm'), `#!/bin/bash\necho call >> "$CALLS"\nif [ ! -e "$ONCE" ] && [ -n "$FAILURE" ]; then touch "$ONCE"; echo "$FAILURE" >&2; exit 7; fi\n`);
    chmodSync(join(dir, 'npm'), 0o755);
    const result = spawnSync('bash', ['scripts/ci/build-web.sh'], { encoding: 'utf8', env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: join(dir, 'calls'), ONCE: join(dir, 'once'), FAILURE: failure,
    } });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').length, expectedCalls);
  });
}
