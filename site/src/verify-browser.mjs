// Run against local Caddy, never production: MARKETING_URL=https://marketing.localhost CHROMIUM=/path/to/chromium node site/src/verify-browser.mjs
// Waitlist requests are mocked before navigation; this script never creates signups.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.MARKETING_URL || 'https://marketing.localhost';
assert(new URL(base).hostname.endsWith('.localhost') || ['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local Caddy host');
const output = process.env.SHOTS_DIR || '/tmp/dd-privacy-seo-shots';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
async function setup(width, js = true, motion = 'reduce') {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, ignoreHTTPSErrors: true, javaScriptEnabled: js, reducedMotion: motion });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.cspErrors = [];
    document.addEventListener('securitypolicyviolation', event => window.cspErrors.push(`${event.effectiveDirective}: ${event.blockedURI}`));
  });
  return { ctx, page };
}
async function visit(page, route, status = 200) {
  const response = await page.goto(base + route);
  assert.equal(response.status(), status, route);
  const headers = await response.allHeaders();
  assert.equal(headers['strict-transport-security'], 'max-age=31536000');
  assert(headers['content-security-policy']?.includes("script-src 'self'"), 'Caddy CSP required');
  await page.evaluate(() => document.fonts.ready);
}
async function layout(page, notices = false) {
  const measurements = await page.evaluate(checkNotices => ({
    width: window.innerWidth, scroll: document.documentElement.scrollWidth,
    csp: window.cspErrors || [],
    footerLinks: [...document.querySelectorAll('footer a[href="/privacy"], footer a[href="/terms"]')]
      .map(el => [el.getAttribute('href'), el.textContent]),
    notices: checkNotices ? [...document.querySelectorAll('.claim-consent')].map(el => ({
      height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight),
      visible: getComputedStyle(el).display !== 'none', href: el.querySelector('a').getAttribute('href'),
      right: el.getBoundingClientRect().right
    })) : []
  }), notices);
  assert(measurements.scroll <= measurements.width, JSON.stringify(measurements));
  assert.deepEqual(measurements.csp, []);
  assert.deepEqual(measurements.footerLinks, [['/privacy', 'Privacy'], ['/terms', 'Terms']]);
  for (const notice of measurements.notices) {
    assert(notice.visible && notice.height > 0 && notice.href === '/privacy');
    assert(notice.right <= measurements.width);
    if (measurements.width === 1440) assert(notice.height <= notice.line + 1, 'Consent should fit one line at 1440');
  }
}
const states = {
  sending: { status: 201, body: { status: 'joined' }, hold: true },
  joined: { status: 201, body: { status: 'joined' } },
  exists: { status: 200, body: { status: 'exists' } },
  invalid: { status: 400, body: { error: 'invalid_email' } },
  limited: { status: 429, body: {} },
  error: { status: 500, body: {} }
};
try {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    const { ctx, page } = await setup(width);
    let mock = states.error, release;
    await page.route('**/api/waitlist', async route => {
      const reply = mock;
      if (reply.hold) await new Promise(resolve => { release = resolve; });
      await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
    });
    for (const [route, shot] of [['/', 'index-idle'], ['/privacy', 'privacy'], ['/terms', 'terms'], ['/missing/deep/path', '404']]) {
      await visit(page, route, route.startsWith('/missing') ? 404 : 200);
      await layout(page, route === '/');
      await page.screenshot({ path: path.join(output, `${width}-${shot}.png`), fullPage: true });
    }
    for (const [state, reply] of Object.entries(states)) {
      mock = reply;
      await visit(page, '/');
      // Alternate submitters: both forms share every state.
      const submitter = ['exists', 'limited', 'error'].includes(state) ? 'footer' : 'hero';
      const form = page.locator(`[data-claim="${submitter}"]`);
      await form.locator('input[type=email]').fill('visual-check@example.com');
      await form.locator('button[type=submit]').click();
      await page.waitForFunction(expected => [...document.querySelectorAll('[data-claim]')].every(el => el.dataset.state === expected), state);
      await layout(page, true);
      for (const key of ['hero', 'footer']) {
        await page.locator(`[data-claim="${key}"]`).screenshot({ path: path.join(output, `${width}-${key}-${state}.png`) });
      }
      if (state === 'sending') { release(); await page.waitForFunction(() => document.querySelector('[data-claim]').dataset.state === 'joined'); }
      if (state === 'joined' || state === 'exists') {
        await page.locator(`[data-claim="${submitter}"] [data-again]`).click();
        assert.equal(await form.getAttribute('data-state'), 'idle');
        await layout(page, true);
      }
    }
    await visit(page, '/');
    await page.locator('[data-claim="hero"] button[type=submit]').click();
    assert.equal(await page.locator('[data-claim="hero"]').getAttribute('data-state'), 'invalid');
    await layout(page, true);
    for (const state of ['joined', 'exists', 'invalid', 'limited']) {
      await visit(page, `/?waitlist=${state}#join`);
      assert.equal(await page.locator('[data-claim="footer"]').getAttribute('data-state'), state);
      await layout(page, true);
    }
    await ctx.close();
    const nojs = await setup(width, false);
    // GET-only inspection: the native POST + 303 flow is a separate routing/API check.
    await nojs.page.goto(base + '/');
    await layout(nojs.page, true);
    assert.equal(await nojs.page.locator('.c-text').count(), 5);
    assert.equal(await nojs.page.locator('.step .face').count(), 3);
    assert.equal(await nojs.page.locator('.pack-hit .pack').count(), 2);
    await nojs.page.screenshot({ path: path.join(output, `${width}-index-no-js.png`), fullPage: true });
    await nojs.ctx.close();
  }
  // The normal-motion path exercises inline SVG references, JS styles and the pack rip.
  for (const width of [390, 1440]) {
    const { ctx, page } = await setup(width, true, 'no-preference');
    await page.route('**/api/waitlist', route => route.abort());
    await visit(page, '/');
    await page.locator('#heroPack').click({ force: true }); // the pack bobs by design, so it is never "stable"
    // The click scrolls to the grid; allow the visible deal to finish before navigating away.
    await page.waitForFunction(() => document.querySelector('#fgrid').classList.contains('is-dealt'), null, { timeout: 8000 });
    assert(await page.locator('#fgrid .fcard.is-dealing').count() > 0, 'Pack click should play the deal after scrolling into view');
    await page.waitForFunction(() => [...document.querySelectorAll('#fgrid .fcard')].every(card => card.getAnimations().length === 0 && !card.classList.contains('is-dealing')), null, { timeout: 5000 });
    await page.locator('#play').click();
    await page.locator('#steps').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.step.is-up').length === 3);
    await layout(page, true);
    await page.screenshot({ path: path.join(output, `${width}-index-open-motion.png`), fullPage: true });
    await ctx.close();
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`PASS pages, six widths, all seven form states, reset/redirect/no-JS/motion paths and Caddy CSP/HSTS. Screenshots: ${output}`);
} finally {
  await browser.close();
}
