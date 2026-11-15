/** Local v2 replay. All generated scripts, caches and results stay in fix-tilt/. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const productRepo = resolve(import.meta.dirname, '../../..');
const evalRepo = '/Users/imranqureshi/repos/yugioh-bot-vision-eval';
const outputRoot = join(evalRepo, 'data/vision-eval/simulation/fix-tilt');
const originals = join(evalRepo, 'scripts/vision/youtube-eval');
const { values } = parseArgs({ options: {
  variant: { type: 'string' }, clips: { type: 'string' }, seconds: { type: 'string' },
  check: { type: 'boolean', default: false },
} });
if (!['before', 'after'].includes(values.variant)) throw new Error('--variant before|after is required');
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use Node 22');
const before = values.variant === 'before';
const out = join(outputRoot, values.variant);
const scripts = join(out, 'scripts');
const head = '3cdc33aca813163bb6ff2768e7db516eb4b1d234';
const names = new Map([
  ['sim-v2-run.mjs', 'sim-fixtilt-run.mjs'],
  ['sim-v2-build.mjs', 'sim-fixtilt-build.mjs'],
  ['sim-v2-score.mjs', 'sim-fixtilt-score.mjs'],
  ['sim-v2-clock.mjs', 'sim-fixtilt-clock.mjs'],
  ['sim-core.ts', 'sim-fixtilt-core.ts'],
  ['sim-model.mjs', 'sim-fixtilt-model.mjs'],
  ['sim-score.mjs', 'sim-fixtilt-score-base.mjs'],
]);
const replaceOnce = (source, from, to) => {
  if (source.split(from).length !== 2) throw new Error('Replay patch drift: ' + from);
  return source.replace(from, to);
};
const hashes = [], copies = [];
for (const [name, copy] of names) {
  const original = await readFile(join(originals, name), 'utf8');
  let source = original;
  if (name === 'sim-v2-run.mjs') {
    source = replaceOnce(source, "join(root,'v2')+'/'", "join(root,'fix-tilt')+'/'");
    source = replaceOnce(source, '--out must be inside data/vision-eval/simulation/v2/', '--out must be inside data/vision-eval/simulation/fix-tilt/');
    if (!source.includes('fps=30,scale=${clip.width}:${clip.height}')) throw new Error('Runner lacks the corrected frame-size filter');
  }
  if (name === 'sim-v2-build.mjs') {
    source = replaceOnce(source, "resolve(import.meta.dirname,'../../..')", JSON.stringify(evalRepo));
    source = replaceOnce(source, "'/Users/imranqureshi/repos/yugioh-bot-vision-phantom/packages'", JSON.stringify(join(productRepo, 'packages')));
    source = replaceOnce(source, "productCommit:'ac0474744'", 'productCommit:' + JSON.stringify(head));
    // Pin the whole before TypeScript dependency graph, including any shared
    // geometry that a concurrent worker changes in this checkout.
    source = "import {execFileSync} from 'node:child_process';\n" + source;
    source += `\nasync function readSource(path) {
      if (${before} && path.startsWith(${JSON.stringify(join(productRepo, 'packages') + '/')}))
        return execFileSync('git',['show',${JSON.stringify(head + ':')}+path.slice(${productRepo.length + 1})],{cwd:${JSON.stringify(productRepo)},encoding:'utf8'});
      return readFile(path,'utf8');
    }\n`;
    source = replaceOnce(source, String.raw`filter:/\/(field-watcher|field-zones|scene-refiner)\.ts$/`, String.raw`filter:/\/packages\/.*\.ts$/`);
    source = replaceOnce(source, "readFile(args.path,'utf8')", 'readSource(args.path)');
    source = replaceOnce(source, 'readFile(join(product,file))', 'readSource(join(product,file))');
    source = replaceOnce(source, "join(root,'v2/inference-cache')", "join(dir,'inference-cache')");
    if (!before) source = replaceOnce(source, 'const receipt={profile,', "sourceFiles.push('vision/src/field-perspective.ts');\n const receipt={profile,");
  }
  // Rename all dependencies before writing; shared scripts remain read-only.
  for (const [oldName, newName] of names) source = source.replaceAll(oldName, newName);
  if (copy.endsWith('.mjs')) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: source });
  copies.push({ copy, source });
  hashes.push({ source: name, original: createHash('sha256').update(original).digest('hex'), copy,
    evaluated: createHash('sha256').update(source).digest('hex') });
}
if (values.check) {
  console.log(JSON.stringify({ variant: values.variant, head, validatedCopies: copies.length, writes: 0 }));
  process.exit(0);
}
// Refuse to overwrite a prior measurement, including a partial one.
await mkdir(outputRoot, { recursive: true });
await mkdir(out);
await mkdir(scripts);
for (const { copy, source } of copies) await writeFile(join(scripts, copy), source);
await writeFile(join(out, 'harness.json'), JSON.stringify({ variant: values.variant, head, productRepo,
  source: 'v2; fixed 170/320 ms; original 64-label scorer; no summons extension', hashes }, null, 2) + '\n');
const args = [join(scripts, 'sim-fixtilt-run.mjs'), 'baseline', '--inputs',
  join(evalRepo, 'data/vision-eval/simulation/v2/shared-inputs.json'), '--out', out, '--threads', '1'];
for (const name of ['clips', 'seconds']) if (values[name]) args.push('--' + name, values[name]);
// One replay, with one-thread model lanes. Running before and after concurrently
// uses the task's maximum of two replay processes.
const child = spawn(process.execPath, args, { cwd: evalRepo, stdio: 'inherit', env: {
  ...process.env, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', VECLIB_MAXIMUM_THREADS: '1',
} });
process.exitCode = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', code => done(code ?? 1));
});
