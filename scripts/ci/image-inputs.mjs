import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// A runtime image is identified by its build inputs, not by the commit that built it.
// The hash lists every tracked file that can change the image, so a PR image can serve the
// merged commit and an unchanged service never rebuilds. When in doubt a file counts as an
// input: a wrong hit would ship stale code, a wrong miss only costs a build.
// Raise this number to invalidate every stored image (for example after a build wiring change).
export const HASH_VERSION = 1;

// Workspace packages that end up inside each runtime image (see the Dockerfile stages).
// Every package keeps its package.json and lockfile in the hash: `npm ci` reads all of them.
const SERVICE_PACKAGES = {
  web: ['shared', 'vision', 'web'],
  bot: ['shared', 'bot'],
  ws: ['shared', 'ws'],
  worker: ['shared', 'worker'],
  duel: ['shared', 'duel-server'],
};
export const SERVICES = Object.keys(SERVICE_PACKAGES);

// Mirrors .dockerignore exactly where it drops tracked files: only root *.md files and
// packages/<name>/test(s)/ are outside the context. Deeper paths such as
// packages/web/app/api/duels/test/ (a production route) or packages/vision/src/licenses/*.md
// (copied into the web image by scripts/voice/assemble.mts) are real inputs.
const DOCKERIGNORED = [/^[^/]+\.md$/, /^packages\/[^/]+\/tests?\//];
const KEEP = [
  '.github/actions/build-production-image/',
  '.github/actions/reuse-production-image/',
  'scripts/ci/image-inputs.mjs',
  'packages/shared/data/effects/NOTICE.md',
  // Build inputs that live in workflows: the matrix target and env, and the voice-asset build
  // (it runs on the emscripten digest pinned in pins.json and its output is copied into the web image).
  '.github/workflows/test.yml',
  '.github/workflows/prepare-voice-assets.yml',
  'packages/duel-server/domain-core/pins.json',
];
// Tracked files that sit inside the Docker context but that no build step reads (checked by hand:
// no Dockerfile stage, package script or build tool opens them). Deploy-only tooling lives here too.
const IGNORED = [
  /^docs\//, /^site\//, /^services\//, /^tools\//, /^\.agents\//, /^\.github\//, /^\.claude\//,
  /^scripts\/(ci|deployment|backup)\//, /^packages\/e2e\//,
];

export function included(path, service) {
  if (!SERVICE_PACKAGES[service]) throw new Error(`Unknown service: ${service}`);
  if (service === 'duel' && path.startsWith('.github/actions/prepare-production-bundle/')) return true;
  if (KEEP.some(keep => path === keep || (keep.endsWith('/') && path.startsWith(keep)))) return true;
  const manifest = /^packages\/[^/]+\/package(-lock)?\.json$/.test(path);
  if (manifest) return true;
  if (DOCKERIGNORED.some(pattern => pattern.test(path))) return false;
  if (IGNORED.some(pattern => pattern.test(path))) return false;
  const owner = /^packages\/([^/]+)\//.exec(path);
  if (owner) return SERVICE_PACKAGES[service].includes(owner[1]);
  return true;
}

export function isoWeek(date = new Date()) {
  // Rotate weekly so floating base images (node:22-bookworm-slim) are picked up.
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const first = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return `${day.getUTCFullYear()}-W${String(Math.ceil(((day - first) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

/** entries: [{ path, mode, oid }] from git ls-tree. salt: extra strings that change the image. */
export function imageInputsHash(entries, service, salt = []) {
  const hash = createHash('sha256');
  hash.update(`v${HASH_VERSION}\0${service}\0`);
  for (const value of salt) hash.update(`salt:${value}\0`);
  const files = entries.filter(entry => included(entry.path, service)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!files.some(entry => entry.path === 'Dockerfile')) throw new Error('The tree has no Dockerfile; refusing to hash.');
  for (const entry of files) hash.update(`${entry.mode} ${entry.oid} ${entry.path}\0`);
  return hash.digest('hex');
}

export function listTree(ref) {
  const output = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', ref], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, , oid] = line.slice(0, tab).split(' ');
    return { mode, oid, path: line.slice(tab + 1) };
  });
}

function duelBundleFingerprint(tarball) {
  if (!tarball) throw new Error('The duel image requires a prepared bundle (IMAGE_BUNDLE).');
  const directory = mkdtempSync(join(tmpdir(), 'duel-image-bundle-'));
  const fingerprint = createHash('sha256');
  function visit(parent = '') {
    const entries = readdirSync(join(directory, parent), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(parent, entry.name);
      const absolute = join(directory, path);
      if (entry.isDirectory()) {
        fingerprint.update(`dir\0${path}\0`);
        visit(path);
      } else if (entry.isSymbolicLink()) {
        fingerprint.update(`link\0${path}\0${readlinkSync(absolute)}\0`);
      } else if (entry.isFile()) {
        let contents = readFileSync(absolute);
        if (path === 'ocgcore.multi.SOURCE' || path === 'ocgcore.multi-domain.SOURCE') {
          // Packaging writes these two fields from the checkout SHA. Keep build provenance,
          // capabilities and every other field in the hash.
          const source = contents.toString('utf8');
          const commit = /^deployedBy=([0-9a-f]{40})$/m.exec(source)?.[1];
          if (commit && source.startsWith(`tag=deploy-${commit.slice(0, 12)}\n`)) {
            contents = source.replace(`tag=deploy-${commit.slice(0, 12)}\n`, 'tag=deploy\n')
              .replace(`\ndeployedBy=${commit}\n`, '\ndeployedBy=\n');
          }
        }
        const digest = createHash('sha256').update(contents).digest('hex');
        fingerprint.update(`file\0${path}\0${digest}\0`);
      } else {
        throw new Error(`Unsupported duel bundle entry: ${path}`);
      }
    }
  }
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', directory], { stdio: ['ignore', 'ignore', 'pipe'] });
    visit();
    return fingerprint.digest('hex');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = process.env.IMAGE_SERVICE;
  const ref = process.env.IMAGE_REF || 'HEAD';
  // Build settings that are baked into the image. Values are hashed, never printed.
  const names = (process.env.IMAGE_SALT_ENV || '').split(',').map(name => name.trim()).filter(Boolean);
  const salt = [isoWeek(), ...names.map(name => `${name}=${process.env[name] ?? ''}`)];
  if (process.env.IMAGE_SALT_EXTRA) salt.push(process.env.IMAGE_SALT_EXTRA);
  if (service === 'duel') salt.push(`bundle:${duelBundleFingerprint(process.env.IMAGE_BUNDLE)}`);
  const hash = imageInputsHash(listTree(ref), service, salt);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `hash=${hash}\n`);
  console.log(`${service} image inputs ${hash}`);
}
