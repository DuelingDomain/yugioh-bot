// Run against the existing Next table preview, after building shared with Node 22.
// PREVIEW_BASE=http://localhost:3100 node docs/design/table-space-v2/followup-shots/capture.mjs
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const base = process.env.PREVIEW_BASE ?? 'http://localhost:3100';
const matrix = ['ffa4', 'ffa3'].flatMap(mode => [
  { mode, width: 1920, height: 1080, drawer: 'closed', state: 'chain-2' },
  { mode, width: 1440, height: 900, drawer: 'open', state: 'chain-2' },
  { mode, width: 1366, height: 768, drawer: 'closed', state: 'chain-2' },
  { mode, width: 1366, height: 768, drawer: 'open', state: 'chain-2' },
]);
for (const mode of ['ffa4', 'ffa3', 'tag', 'classic']) {
  for (const state of ['main', 'chain-2']) matrix.push({ mode, width: 390, height: 844, drawer: 'phone', state });
}
// Tag keeps its desktop layout; include it when checking the phone chain reservation.
matrix.push({ mode: 'tag', width: 1440, height: 900, drawer: 'desktop', state: 'chain-2' });
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const item of matrix) {
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const response = await page.goto(`${base}/dev/table-preview/${item.mode}?state=${item.state}&reduced=1`, { waitUntil: 'networkidle' });
    if (!response?.ok()) errors.push(`HTTP ${response?.status()}`);
    const table = page.locator('[data-wide="true"][data-drawer]');
    if (item.mode.startsWith('ffa') && item.drawer !== 'phone') {
      await table.waitFor();
      const open = await table.getAttribute('data-drawer') === 'open';
      if (open !== (item.drawer === 'open')) await page.locator(open ? '[aria-label="Panel drawer"] button[aria-label="Close panel"]' : '[data-rail="log"]').click();
      await page.waitForFunction(drawer => document.querySelector('[data-wide="true"][data-drawer]')?.getAttribute('data-drawer') === drawer, item.drawer);
    }
    await page.waitForTimeout(1000);
    const geometry = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const strip = document.querySelector('[data-chain-strip-wrap]');
      const box = strip && rect(strip);
      const overlap = r => box && Math.min(box.x + box.width, r.x + r.width) - Math.max(box.x, r.x) > 1 && Math.min(box.y + box.height, r.y + r.height) - Math.max(box.y, r.y) > 1;
      const hits = box ? [...document.querySelectorAll('[data-seat-field], [data-holo], [data-team-plate], [data-lp-seat], [data-tag-header], [data-hand-seat], [data-prompt-panel], [data-seat-switcher]')]
        .filter(el => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== 'hidden' && overlap(rect(el)))
        .map(el => ({ tag: el.tagName, data: { ...el.dataset }, rect: rect(el) })) : [];
      return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, strip: box, stripVisible: !!(box?.width && box?.height && strip.getClientRects().length && getComputedStyle(strip).visibility !== 'hidden'), collisions: hits };
    });
    // ClassicPreview must mount the live room's ChainFx too: the prompt and response-mode dots are not its chain panel.
    if (item.state === 'chain-2' && !geometry.stripVisible) errors.push('Chain strip is missing or hidden');
    if (geometry.horizontalOverflow) errors.push('Horizontal page overflow');
    if (geometry.collisions.length) errors.push('Chain strip overlaps protected content');
    const file = `${item.mode}-${item.state}-${item.width}x${item.height}-${item.drawer}.png`;
    await page.screenshot({ path: `${out}${file}` });
    results.push({ ...item, file, errors, geometry });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(`${out}results.json`, JSON.stringify(results, null, 2));
}
if (results.some(item => item.errors.length)) process.exitCode = 1;
console.log(`${results.length} screenshots saved. Inspect every image in ${out}`);
