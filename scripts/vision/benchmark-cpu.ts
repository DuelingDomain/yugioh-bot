/** CPU-mode cost of the field watcher on a synthetic camera: stages, CPU share per thread group (from /proc), latency. Local only.
 * VISION_DATA_DIR=<assets> CPU_OUT=<dir> CPU_LABEL=before [CPU_SCENES=control,idle,steady,active] [CPU_THREADS=2] npx tsx scripts/vision/benchmark-cpu.ts
 * Use `taskset -c 0-3 ...` for a smaller computer: hardwareConcurrency follows the affinity. */
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..'), data = resolve(process.env.VISION_DATA_DIR ?? join(root, 'data/vision')), out = resolve(process.env.CPU_OUT ?? join(data, 'benchmark/cpu'));
const label = process.env.CPU_LABEL ?? 'results', scenes = (process.env.CPU_SCENES ?? 'control,idle,steady,active').split(','), measureSeconds = Number(process.env.CPU_SECONDS ?? 30);
const threads = process.env.CPU_THREADS ? Number(process.env.CPU_THREADS) : undefined;
const extra = process.env.CPU_CONFIG ? JSON.parse(process.env.CPU_CONFIG) : {};
await mkdir(out, { recursive: true });
// CPU_BUNDLE: run page.js and worker.js from an earlier build, so before and after runs can alternate.
const bundle = resolve(process.env.CPU_BUNDLE ?? out);
if (!process.env.CPU_BUNDLE) await build({ entryPoints: [join(root, 'scripts/vision/benchmark-cpu-page.ts')], outfile: join(out, 'page.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', globalName: undefined, logLevel: 'error' });
if (!process.env.CPU_BUNDLE) await build({ entryPoints: [join(root, 'packages/vision/src/worker.ts')], outfile: join(out, 'worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'error' });
// Cards from the indexed benchmark photos: cut at the bounding box of what differs from the photo's plain background.
const photos = JSON.parse(await readFile(join(data, 'benchmark/photos.json'), 'utf8')) as { file: string; cardId: string; condition: string }[];
const clean = photos.filter(p => p.condition === 'clean').slice(0, 5), cards: { id: string; url: string }[] = [];
for (const [i, photo] of clean.entries()) {
  const { data: raw, info } = await sharp(join(data, 'benchmark', photo.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [raw[0], raw[1], raw[2]]; let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) { const p = (y * info.width + x) * 3; if (Math.abs(raw[p] - bg[0]) + Math.abs(raw[p + 1] - bg[1]) + Math.abs(raw[p + 2] - bg[2]) > 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  await sharp(join(data, 'benchmark', photo.file)).extract({ left: Math.max(0, x0 - 3), top: Math.max(0, y0 - 3), width: x1 - x0 + 7, height: y1 - y0 + 7 }).png().toFile(join(out, `card-${i}.png`));
  cards.push({ id: photo.cardId, url: `/out/card-${i}.png` });
}
const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.onnx': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  const path = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>CPU benchmark</title><body style="margin:0;background:#111">'); return; }
  try {
    const candidates = path === '/dev/vision-lab/assets/worker.js' ? [join(bundle, 'worker.js')] : path === '/out/page.js' ? [join(bundle, 'page.js')] : path.startsWith('/out/') ? [resolve(out, path.slice(5))] : [resolve(out, 'extra', path.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//, '')), resolve(data, path.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//, ''))];
    for (const file of candidates) { if (!(file.startsWith(data + '/') || file.startsWith(out + '/') || file.startsWith(bundle + '/'))) continue; const info = await stat(file).catch(() => undefined); if (!info?.isFile()) continue; res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); return; }
    res.statusCode = 404; res.end('missing');
  } catch { res.statusCode = 404; res.end('missing'); }
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

type Groups = Record<string, number>;
function cpuTree(tag: string): Groups {
  const stats = new Map<number, { ppid: number; cmd: string }>();
  for (const name of readdirSync('/proc')) { if (!/^\d+$/.test(name)) continue; try { const s = readFileSync(`/proc/${name}/stat`, 'latin1'), ppid = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]), cmd = readFileSync(`/proc/${name}/cmdline`, 'latin1'); stats.set(Number(name), { ppid, cmd }); } catch { /* gone */ } }
  const rootPid = [...stats].find(([, v]) => v.cmd.includes(`--bench-tag=${tag}`) && !v.cmd.includes('--type='))?.[0]; const out: Groups = {}; if (!rootPid) return out;
  const pids = new Set([rootPid]); for (let changed = true; changed;) { changed = false; for (const [pid, v] of stats) if (!pids.has(pid) && pids.has(v.ppid)) { pids.add(pid); changed = true; } }
  for (const pid of pids) {
    const kind = /--type=([a-z-]+)/.exec(stats.get(pid)!.cmd)?.[1] ?? 'browser';
    let tasks: string[] = []; try { tasks = readdirSync(`/proc/${pid}/task`); } catch { continue; }
    for (const tid of tasks) { try { const s = readFileSync(`/proc/${pid}/task/${tid}/stat`, 'latin1'), comm = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')), rest = s.slice(s.lastIndexOf(')') + 2).split(' '), ticks = Number(rest[11]) + Number(rest[12]); const group = kind !== 'renderer' ? (kind === 'gpu-process' ? 'gpu' : kind === 'browser' ? 'browser' : 'other') : tid === String(pid) ? 'main' : comm.startsWith('DedicatedWorker') ? 'workers' : 'rendererOther'; out[group] = (out[group] ?? 0) + ticks * 10; } catch { /* gone */ } }
  }
  return out;
}
const results: Record<string, unknown> = {};
for (const scene of scenes) {
  const tag = randomUUID().slice(0, 8);
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--disable-gpu', '--no-sandbox', `--bench-tag=${tag}`, '--autoplay-policy=no-user-gesture-required', ...(process.env.CPU_CHROME_ARGS?.split(' ') ?? [])] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin + '/');
    await page.addScriptTag({ type: 'module', content: `import * as bench from '/out/page.js'; window.bench = bench; window.benchReady = true;` });
    await page.waitForFunction('window.benchReady === true');
    const info = await page.evaluate(config => (window as any).bench.setup(config), { cards, scene, threads, ...extra });
    const measure = async (run: () => Promise<any>) => { const before = cpuTree(tag), at = Date.now(), stats = await run(), wall = (Date.now() - at) / 1000, after = cpuTree(tag); const cpu: Record<string, number> = {}; let total = 0; for (const key of Object.keys(after)) { const delta = (after[key] - (before[key] ?? 0)) / 1000 / wall; cpu[key] = Number(delta.toFixed(3)); total += delta; } return { wall, coresTotal: Number(total.toFixed(3)), cpu, ...stats }; };
    let result: any;
    if (scene === 'pass') {
      await page.waitForTimeout(1500);
      const pass = await measure(() => page.evaluate(n => (window as any).bench.passBench(n), Number(process.env.CPU_PASSES ?? 15)));
      const read = process.env.CPU_READS === '0' ? undefined : await measure(() => page.evaluate(n => (window as any).bench.readBench(n), Number(process.env.CPU_READS ?? 8)));
      const per = (m: any) => m && ({ wallP50: Number(m.wallP50.toFixed(0)), workerCpuMsPerRun: Number(((m.cpu.workers ?? 0) * m.wall * 1000 / m.n).toFixed(0)), timing: Object.fromEntries(Object.entries(m.timing).map(([k, v]) => [k, Number((v as number).toFixed(1))])), found: m.found, outlines: m.outlines, conf: m.conf, top: m.top });
      result = { pass: per(pass), read: per(read), cpu: pass.cpu, coresTotal: pass.coresTotal };
      console.log(JSON.stringify({ label, threads, extra, hc: info.hardwareConcurrency, pass: result.pass, read: result.read }));
    } else if (scene === 'grab') {
      await page.waitForTimeout(1500); result = { grab: await page.evaluate(n => (window as any).bench.grabBench(n), 30) }; console.log(JSON.stringify(result.grab));
    } else if (scene === 'active') {
      await page.waitForTimeout(8000);
      result = await measure(() => page.evaluate(spacing => (window as any).bench.active(spacing), 6000));
    } else {
      if (scene === 'steady') { await page.waitForFunction('window.bench.settled ? window.bench.settled() : window.bench.placedCount() >= 5', undefined, { timeout: 90000 }); await page.waitForTimeout(6000); } else if (scene === 'idle') await page.waitForTimeout(8000); else await page.waitForTimeout(3000);
      result = await measure(async () => { await page.evaluate(() => (window as any).bench.begin()); await page.waitForTimeout(measureSeconds * 1000); return page.evaluate(() => (window as any).bench.end()); });
    }
    results[scene] = { info, backend: await page.evaluate(() => (window as any).bench.backend()), errors: errors.slice(0, 5), ...result };
    console.log(scene, JSON.stringify({ cores: result.coresTotal, cpu: result.cpu, info, passes: result.passes, reads: result.reads, dutyP50: result.dutyP50, dutyP95: result.dutyP95, errors: errors.slice(0, 3) }));
  } finally { await browser.close(); }
}
server.close();
await writeFile(join(out, `${label}.json`), JSON.stringify(results, null, 1));
console.log('written', join(out, `${label}.json`));
void readdir;
