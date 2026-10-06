// Regenerates the PNG icons and og.png from the SVG/HTML sources in this folder.
// Needs Playwright with a Chromium: NODE_PATH=<dir with node_modules> CHROMIUM=<path to chromium> node build-icons.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import url from 'url';
import http from 'node:http';
const require = createRequire(import.meta.url);
const here = path.dirname(url.fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
// The mark can be rendered without Chromium; --marks-only is useful in restricted sandboxes.
const sharp = require('sharp');
for (const size of [192, 512]) {
  await sharp(path.join(here, 'mark.svg')).resize(size, size).png().toFile(path.join(pub, `logo-${size}.png`));
}
if (!process.argv.includes('--marks-only')) {
const { chromium } = require('playwright');
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// Serve the sources and local fonts with a shared HTTP origin for browser font loading.
const siteRoot = path.resolve(here, '..');
const mime = { '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.resolve(siteRoot, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(siteRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
try {

async function svgToPng(svg, size, out) {
  const ctx = await b.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await ctx.close();
}
await svgToPng(fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8'), 32, path.join(pub, 'favicon-32.png'));
await svgToPng(fs.readFileSync(path.join(here, 'favicon-16.svg'), 'utf8'), 16, path.join(pub, 'favicon-16.png'));

// favicon.ico holding both PNGs
const p16 = fs.readFileSync(path.join(pub, 'favicon-16.png')), p32 = fs.readFileSync(path.join(pub, 'favicon-32.png'));
const hdr = Buffer.alloc(6); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(2, 4);
const ent = (w, data, off) => { const e = Buffer.alloc(16); e[0] = w; e[1] = w; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(off, 12); return e; };
fs.writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([hdr, ent(16, p16, 38), ent(32, p32, 38 + p16.length), p16, p32]));

async function shot(file, w, h, sel, out) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${server.address().port}/src/${file}`);
  await p.evaluate(() => document.fonts && document.fonts.ready);
  await p.waitForTimeout(300);
  await (await p.$(sel)).screenshot({ path: out });
  await ctx.close();
}
await shot('apple-icon.html', 180, 180, '#a', path.join(pub, 'apple-touch-icon.png'));
await shot('og.html', 1200, 630, '#og', path.join(pub, 'og.png'));
} finally {
  await b.close();
  await new Promise(resolve => server.close(resolve));
}
}
