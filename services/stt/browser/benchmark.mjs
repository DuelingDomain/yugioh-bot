import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { serve } from './serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
if (platform() !== 'linux') throw new Error('The benchmark RSS sampler requires Linux/WSL; the browser module itself is portable');
const root = resolve(here, '../../..');
const manifestBytes = await readFile(resolve(root, 'data/stt-benchmark/manifest.json'));
const manifest = JSON.parse(manifestBytes);
for (const clip of [...manifest.clips, ...manifest.probes]) {
  const bytes = await readFile(resolve(root, 'data/stt-benchmark', clip.file));
  if (clip.sha256 && createHash('sha256').update(bytes).digest('hex') !== clip.sha256) throw new Error(`Audio hash mismatch: ${clip.file}`);
}
// Default to Playwright's managed browser; use CHROME_PATH for an existing install.
const executablePath = process.env.CHROME_PATH;
const tiny = process.env.MODEL === 'whisper-tiny.en';
if (process.env.MODEL && !['parakeet', 'whisper-tiny.en'].includes(process.env.MODEL)) throw new Error('Unknown MODEL');
const output = resolve(root, process.env.OUTPUT ?? `services/stt/benchmarks/browser-${tiny ? 'whisper-tiny' : 'parakeet'}.json`);
const { server, transfers, origin } = await serve(0, true);
const report = {
  model: tiny ? 'Whisper tiny.en int8' : 'Parakeet TDT 0.6B v3 int8',
  repository: tiny ? 'onnx-community/whisper-tiny.en' : 'istupakov/parakeet-tdt-0.6b-v3-onnx',
  revision: tiny ? '2575352d61be1bf7225cf8f8b268a4678025fc58' : '8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce',
  modelDirectory: tiny ? 'browser-whisper-tiny.en' : 'browser-parakeet-v3',
  runtime: tiny ? { transformersJs: '4.3.2', onnxruntimeWeb: '1.31.0-dev.20260914-8d85527a0', playwright: '1.61.1' } : { parakeetJs: '1.4.4', onnxruntimeWeb: '1.24.1', playwright: '1.61.1' },
  measuredAt: new Date().toISOString(), host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: totalmem() / 2**30, platform: platform(), release: release(), node: process.version },
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  notes: ['Fresh browser/context for each mode; no-store loopback static server; OS file cache not flushed.', 'Cold load includes local model/runtime transfer and session setup; excludes internet download.', 'Release latency includes PCM assembly, worker messaging, features, ASR and full-catalog JS matcher; no pacing, VAD, microphone or network RTT.', 'RSS sampled every 100 ms across Chrome descendant processes; shared pages counted per process. GPU VRAM is not measured.'],
  runs: [],
};
function memory(rootPid) {
  const rows = [];
  for (const pid of readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      rows.push({ pid: +pid, ppid: +status.match(/^PPid:\s+(\d+)/m)[1], rss: +(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) });
    } catch { /* Process exited during sampling. */ }
  }
  const ids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
  }
  return rows.filter(r => ids.has(r.pid)).reduce((total, row) => total + row.rss / 1024, 0);
}
function percentile(xs, p) {
  const sorted = [...xs].sort((a, b) => a - b), at = (sorted.length - 1) * p;
  return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1);
}
try {
  for (const mode of [
    { name: 'wasm', backend: 'wasm', flags: ['--disable-webgpu'] },
    { name: 'webgpu-default', backend: 'webgpu', flags: [] },
    { name: 'webgpu-swiftshader', backend: 'webgpu', flags: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--enable-features=Vulkan', '--disable-vulkan-surface'] },
  ].filter(m => (!tiny || m.backend === 'wasm') && (!process.env.MODE || m.name === process.env.MODE))) {
    console.log(`Starting ${mode.name}`, new Date().toISOString());
    const row = { mode: mode.name, flags: mode.flags };
    report.runs.push(row);
    let browser, sampler, peak = 0;
    const transferStart = transfers.length;
    try {
      browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', ...mode.flags] });
      row.browser = browser.version();
      const cdp = await browser.newBrowserCDPSession();
      const processInfo = await cdp.send('SystemInfo.getProcessInfo');
      const pid = processInfo.processInfo.find(p => p.type === 'browser').id;
      sampler = setInterval(() => { peak = Math.max(peak, memory(pid)); }, 100);
      const context = await browser.newContext();
      const page = await context.newPage();
      row.console = [];
      page.on('console', message => { if (['warning', 'error'].includes(message.type())) row.console.push(message.text()); });
      page.on('pageerror', error => row.console.push(String(error)));
      const started = performance.now();
      await page.goto(origin);
      await page.waitForFunction(() => window.createBrowserSTT);
      row.baselineRssMiB = memory(pid);
      row.capabilities = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter();
        return { crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency, gpuApi: !!navigator.gpu, adapter: adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : null };
      });
      row.load = await page.evaluate(async ({ model, backend, hotwords }) => {
        window.stt = window.createBrowserSTT({ model, backend, threads: 4 });
        return stt.start({ hotwords });
      }, { model: tiny ? 'whisper-tiny.en' : 'parakeet', backend: mode.backend, hotwords: manifest.hotwords });
      row.coldPageToReadyMs = performance.now() - started;
      row.loadedRssMiB = memory(pid);
      row.coldTransfers = transfers.slice(transferStart).map(t => ({ ...t }));
      console.log(`${mode.name} loaded in ${row.coldPageToReadyMs.toFixed(0)} ms`);
      // Decode actual PCM16 WAV, never use Web Audio resampling or base64.
      await page.evaluate(() => {
        window.readPCM = async file => {
          const bytes = await fetch(`/corpus/${file}`).then(r => r.arrayBuffer());
          const view = new DataView(bytes);
          if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) throw new Error('Expected RIFF/WAVE');
          let offset = 12, format;
          while (offset + 8 <= view.byteLength) {
            const tag = view.getUint32(offset, false), size = view.getUint32(offset + 4, true);
            if (tag === 0x666d7420) format = [view.getUint16(offset + 8, true), view.getUint16(offset + 10, true), view.getUint32(offset + 12, true), view.getUint16(offset + 22, true)];
            if (tag === 0x64617461) {
              if (JSON.stringify(format) !== '[1,1,16000,16]') throw new Error('Expected mono 16kHz PCM16');
              return Float32Array.from({ length: size / 2 }, (_, i) => view.getInt16(offset + 8 + i * 2, true) / 32768);
            }
            offset += 8 + size + (size % 2);
          }
          throw new Error('Missing WAV data');
        };
        window.decodeFile = async (file, hotwords, first = false) => {
          const pcm = await readPCM(file);
          if (!first) await stt.start({ hotwords });
          for (let i = 0; i < pcm.length; i += 320) stt.pushAudio(pcm.subarray(i, i + 320));
          return stt.stop();
        };
      });
      row.firstInference = await page.evaluate(({ file, hotwords }) => decodeFile(file, hotwords, true), { file: manifest.clips[0].file, hotwords: manifest.hotwords });
      row.probes = {};
      for (const probe of manifest.probes) {
        const runs = [];
        for (let i = 0; i < 7; i++) runs.push(await page.evaluate(({ file, hotwords }) => decodeFile(file, hotwords), { file: probe.file, hotwords: manifest.hotwords }));
        row.probes[String(probe.duration)] = { reference: probe.reference, runs,
          releaseP50Ms: percentile(runs.map(r => r.processingMs), .5), releaseP95Ms: percentile(runs.map(r => r.processingMs), .95),
          decodeP50Ms: percentile(runs.map(r => r.decodeMs), .5), matcherP50Ms: percentile(runs.map(r => r.matchMs), .5) };
        console.log(`${mode.name} ${probe.duration}s release p50 ${row.probes[String(probe.duration)].releaseP50Ms.toFixed(0)} ms`);
      }
      row.clips = [];
      for (const clip of (mode.backend === 'wasm' || process.env.GPU_CORPUS === '1' ? manifest.clips : [])) {
        const result = await page.evaluate(({ file, hotwords }) => decodeFile(file, hotwords), { file: clip.file, hotwords: manifest.hotwords });
        row.clips.push({ ...clip, ...result });
        console.log(`${row.clips.length}/40 ${result.processingMs.toFixed(0)} ms | ${result.text}`);
      }
      // Integration checks exercise the real worker/API without adding unit tests.
      row.apiChecks = await page.evaluate(async () => {
        const checks = {};
        try { stt.pushAudio(new Float32Array(1)); } catch { checks.pushBeforeStart = true; }
        await stt.start();
        try { await stt.start(); } catch { checks.doubleStart = true; }
        try { stt.pushAudio(Float32Array.of(NaN)); } catch { checks.invalidPCM = true; }
        try { stt.pushAudio(new Float32Array(240001)); } catch { checks.durationBound = true; }
        stt.cancel();
        await stt.start(); stt.pushAudio(new Float32Array(16000));
        const silent = await stt.stop(); checks.silence = silent.text === '' && silent.cardMatches.length === 0;
        stt.dispose();
        try { await stt.start(); } catch { checks.disposed = true; }
        if (Object.keys(checks).length !== 6 || Object.values(checks).some(x => !x)) throw new Error('API check failed');
        return checks;
      });
      row.status = 'ok';
    } catch (error) {
      row.status = 'unavailable'; row.error = String(error);
      console.log(`${mode.name}: ${row.error.slice(0, 500)}`);
    } finally {
      clearInterval(sampler); row.peakRssMiB = peak;
      if (!row.coldTransfers) row.coldTransfers = transfers.slice(transferStart).map(t => ({ ...t }));
      if (browser) await browser.close();
      await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    }
  }
} finally { await new Promise(ok => server.close(ok)); }
console.log(`Saved ${output}`);
if (report.runs.some(run => run.mode === 'wasm' && run.status !== 'ok')) process.exitCode = 1;
