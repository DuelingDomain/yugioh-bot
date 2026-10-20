import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The 1v1 floating HUD room keeps your whole hand on screen and draws ONE outline per monster zone, on the real room
// (/dev/table-preview/classic/room): at 1920x1080, 2560x1440, 1366x768 and 2000x1100 your hand cards end above the screen
// edge, also while one is hovered, and a Main or Extra Monster Zone has no second (landscape) guide. The rival's card backs are
// whole too: none starts above the top edge, and none (at rest or hovered) touches the header controls.
// Playwright is external to the repo. Set PLAYWRIGHT_MODULE to an installed index.mjs (without it, `playwright` is resolved from node_modules).
// Start the page first:  cd packages/web && DUEL_FX_LAB=1 npx next dev -p 3616 --webpack
// Run: PREVIEW_URL=http://localhost:3616 node --import tsx packages/web/e2e/hand-fit.playwright.ts
// Environment: PREVIEW_URL, HAND_FIT_OUT (default /tmp/yugioh-hand-fit), CHROMIUM_PATH.
const base = (process.env.PREVIEW_URL ?? "http://localhost:3616").replace(/\/$/, "");
const out = resolve(process.env.HAND_FIT_OUT ?? "/tmp/yugioh-hand-fit");
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const sizes: Array<[number, number]> = [[1920, 1080], [2560, 1440], [1366, 768], [2000, 1100]];
const results: Record<string, unknown> = {};
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => { errors.push(error.message); });
    // m1: your hand holds usable cards, so the lifted state shows too.
    await page.goto(`${base}/dev/table-preview/classic/room?state=m1`, { timeout: 180_000 });
    await page.locator("[data-zones]").first().waitFor({ state: "visible", timeout: 120_000 });
    await page.waitForTimeout(2000);
    const own = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-hand-card]")]
      .map((node) => node.getBoundingClientRect()).filter((box) => box.top > innerHeight / 2)
      .map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.top, bottom: box.bottom, height: box.height })));
    const resting = await own();
    assert.ok(resting.length >= 4, `${width}x${height}: your hand is on screen`);
    for (const card of resting) assert.ok(card.bottom <= height, `${width}x${height}: a resting hand card ends at ${card.bottom}, the screen at ${height}`);
    // A hovered card grows over its row and its bottom edge stays on screen too (the grown picture is the .frame).
    const target = resting[1]!;
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await page.waitForTimeout(900);
    const grown = await page.evaluate(() => Math.max(...[...document.querySelectorAll<HTMLElement>("[data-hand-card] [class*=frame]")]
      .map((node) => node.getBoundingClientRect()).filter((box) => box.top > innerHeight / 4).map((box) => box.bottom)));
    assert.ok(grown <= height, `${width}x${height}: a hovered hand card ends at ${grown}, the screen at ${height}`);
    await page.mouse.move(2, 2);
    // The rival's hand: every card back starts at or below the top edge, and no card (resting or grown by a hover) overlaps a header
    // control (Report bug, Report, Sound, the title and the turn pill). Header controls are the buttons and links at the top that are
    // not zones or hand cards.
    const rival = () => page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('[data-hand-seat][data-side="opp"] [data-hand-card]')].map((node) => node.getBoundingClientRect());
      const frames = [...document.querySelectorAll<HTMLElement>('[data-hand-seat][data-side="opp"] [data-hand-card] [data-card-frame]')].map((node) => node.getBoundingClientRect());
      const controls = [...document.querySelectorAll<HTMLElement>("button, a")]
        .filter((node) => !node.closest("[data-hand-seat], [data-zones], [data-pile]") && !node.hasAttribute("data-zones"))
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0 && box.top < 56 && box.bottom > 0 && box.right <= innerWidth);
      const hits = frames.concat(cards).filter((box) => controls.some((c) => box.left < c.right && box.right > c.left && box.top < c.bottom && box.bottom > c.top)).length;
      return { top: Math.min(...cards.map((box) => box.top)), count: cards.length, controls: controls.length, hits };
    });
    const resting_rival = await rival();
    assert.ok(resting_rival.count >= 4, `${width}x${height}: the rival hand is on screen`);
    assert.ok(resting_rival.controls >= 3, `${width}x${height}: the header controls were found`);
    assert.ok(resting_rival.top >= 0, `${width}x${height}: a rival card back starts at ${resting_rival.top}, above the top edge`);
    assert.equal(resting_rival.hits, 0, `${width}x${height}: a rival card back overlaps a header control`);
    const backs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-hand-seat][data-side="opp"] [data-hand-card]')].map((node) => { const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }));
    for (const back of [backs[0]!, backs[backs.length - 1]!]) {
      await page.mouse.move(back.x, back.y, { steps: 4 });
      await page.waitForTimeout(700);
      const grownRival = await rival();
      assert.ok(grownRival.top >= 0, `${width}x${height}: a hovered rival card back starts at ${grownRival.top}, above the top edge`);
      assert.equal(grownRival.hits, 0, `${width}x${height}: a hovered rival card back overlaps a header control`);
    }
    await page.mouse.move(2, 2);
    // One outline per monster zone: no landscape guide (::before) on the Main and Extra Monster Zones.
    const guides = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-kind="mz"] button, [data-kind="emz"] button')]
      .map((node) => getComputedStyle(node, "::before").content).filter((content) => content !== "none" && content !== "normal"));
    assert.deepEqual(guides, [], `${width}x${height}: monster zones draw a second guide`);
    await page.screenshot({ path: resolve(out, `hand-fit-${width}x${height}.png`) });
    assert.deepEqual(errors, []);
    results[`${width}x${height}`] = { rivalTop: Math.round(resting_rival.top), hand: Math.round(resting[0]!.height), bottomGap: Math.round(height - Math.max(...resting.map((card) => card.bottom))), hoveredBottom: Math.round(grown) };
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
