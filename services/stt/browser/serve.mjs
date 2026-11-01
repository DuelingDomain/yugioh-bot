import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export async function serve(port = 4021, benchmark = false) {
  const roots = { '/': resolve(here, 'dist'), '/models/': resolve(here, '../../../data/stt-models/browser-parakeet-v3') };
  roots['/models-tiny/'] = resolve(here, '../../../data/stt-models/browser-whisper-tiny.en');
  if (benchmark) roots['/corpus/'] = resolve(here, '../../../data/stt-benchmark');
  const transfers = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // Benchmark uses new contexts and disables caching. Production hosts should
    // cache versioned assets; this development server deliberately never does.
    res.setHeader('Cache-Control', 'no-store');
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const prefix = Object.keys(roots).sort((a, b) => b.length - a.length).find(p => pathname.startsWith(p));
      const root = roots[prefix];
      const path = resolve(root, pathname.slice(prefix.length) || 'index.html');
      if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const file = await stat(path);
      if (!file.isFile() || pathname.includes('/.')) { res.writeHead(404).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain', '.wav': 'audio/wav' };
      res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Length': file.size });
      const entry = { path: pathname, bytes: 0 };
      transfers.push(entry);
      const stream = createReadStream(path);
      stream.on('data', chunk => { entry.bytes += chunk.length; });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  return { server, transfers, origin: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await serve(Number(process.env.PORT ?? 4021));
  console.log(`Browser STT static assets: ${origin}`);
}
