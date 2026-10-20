import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The 1v1 floating HUD room keeps your whole hand on screen and draws ONE outline per monster zone, on the real room
// (/dev/table-preview/classic/room): at 1920x1080, 2560x1440, 1366x768 and 2000x1100 your hand cards end above the screen
// edge, also while one is hovered, and a Main or Extra Monster Zone has no second (landscape) guide. The rival's card backs are
// whole too: none starts above the top edge, and none (at rest or hovered) touches the header controls.
// A hovered hand card lies over EVERYTHING on the board and takes the pointer: with your own Spell/Trap card right above the hand
// holding an active chain link (gold ring, link badge, callout) and a discard prompt open, every point of the grown card (also the
// part over that field card and over the badge) hits the hand card, and a click there answers with the hand card's choice.
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

// The fixture has no card images: label the art with placeholders so a card that lies over another one is visible in the shots.
const artSvg = (code: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260"><rect width="180" height="260" fill="#${Number(code) % 2 ? "3b4a7a" : "6a3b5a"}"/><rect x="12" y="12" width="156" height="236" fill="none" stroke="white" stroke-opacity="0.6"/><text x="90" y="135" fill="white" text-anchor="middle" font-size="22">${code}</text></svg>`;

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

    // A hovered hand card lies over a field card with an active chain link, and takes the pointer there.
    {
      const shell = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      const duel = await shell.newPage();
      const duelErrors: string[] = [];
      duel.on("pageerror", (error: Error) => { duelErrors.push(error.message); });
      await duel.addInitScript("window.__name = (fn) => fn");
      await duel.route("**/api/cards/*/image*", async (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
        await route.fulfill({ contentType: "image/svg+xml", body: artSvg(/\/cards\/(\d+)\//.exec(route.request().url())?.[1] ?? "0") });
      });
      await duel.goto(`${base}/dev/table-preview/classic/room?state=m1`, { timeout: 180_000 });
      await duel.locator("[data-zones]").first().waitFor({ state: "visible", timeout: 120_000 });
      await duel.waitForTimeout(2000);
      // Your face-down Solemn Judgment (Spell/Trap zone 2) activates as Chain Link 1, and you must discard a card from your hand.
      await duel.evaluate(() => (window as unknown as { __previewEditRoom(fn: (room: any) => void): void }).__previewEditRoom((room) => {
        const mine = room.engine.seats[0];
        const source = mine.spells[1];
        room.engine.chain = [{ index: 1, seat: 0, code: source.code, name: source.name, zone: { controller: 0, location: 0x8, sequence: 1 } }];
        room.engine.prompt = {
          id: "discard-1", seat: 0, kind: "cards", title: "Select 1 card to discard", min: 1, max: 1,
          options: mine.hand.map((card: any, index: number) => ({ id: `card:${index}`, label: card.name, card, controller: 0, location: 0x2, sequence: index })),
        };
      }));
      await duel.waitForFunction(() => document.querySelector("[data-chain-link]") != null, undefined, { timeout: 15_000 });
      await duel.waitForTimeout(1800);
      const zoneBox = () => duel.evaluate(() => { const box = document.querySelector('[data-zones~="0:8:1"]')!.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }; });
      const hand = await duel.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-hand-seat][data-side="you"] [data-hand-card]')]
        .map((node) => { const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }));
      const zone = await zoneBox();
      // The hand card whose grown picture reaches the most of that field card.
      let best = { index: -1, area: 0 };
      for (let index = 0; index < hand.length; index += 1) {
        await duel.mouse.move(hand[index]!.x, hand[index]!.y, { steps: 4 });
        await duel.waitForTimeout(800);
        const area = await duel.evaluate(({ zone: z }: { zone: { left: number; top: number; right: number; bottom: number } }) => {
          const hovered = document.querySelector<HTMLElement>('[data-hand-seat][data-side="you"] [data-hand-card]:hover [data-card-frame]');
          if (!hovered) return 0;
          const f = hovered.getBoundingClientRect();
          return Math.max(0, Math.min(f.right, z.right) - Math.max(f.left, z.left)) * Math.max(0, Math.min(f.bottom, z.bottom) - Math.max(f.top, z.top));
        }, { zone });
        if (area > best.area) best = { index, area };
      }
      assert.ok(best.index >= 0, `${width}x${height}: a hovered hand card reaches the field card`);
      await duel.mouse.move(2, 2);
      await duel.waitForTimeout(900);
      await duel.mouse.move(hand[best.index]!.x, hand[best.index]!.y, { steps: 4 });
      await duel.waitForTimeout(900);
      const probe = await duel.evaluate(({ zone: z }: { zone: { left: number; top: number; right: number; bottom: number } }) => {
        const card = document.querySelector<HTMLElement>('[data-hand-seat][data-side="you"] [data-hand-card]:hover');
        const f = card!.querySelector<HTMLElement>("[data-card-frame]")!.getBoundingClientRect();
        const onHand = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-hand-card]") === card;
        const grid: Array<{ x: number; y: number; hand: boolean; hit: string }> = [];
        for (const fx of [0.04, 0.2, 0.5, 0.8, 0.96]) for (const fy of [0.03, 0.12, 0.25, 0.4, 0.6, 0.8, 0.97]) {
          const x = f.left + (f.right - f.left) * fx, y = f.top + (f.bottom - f.top) * fy;
          grid.push({ x, y, hand: onHand(x, y), hit: String(document.elementFromPoint(x, y)?.className ?? "").slice(0, 40) });
        }
        // The part of the grown card over the field card, over the chain badge and over the callout (when they meet the card).
        const meet = (r: DOMRect, name: string) => {
          const l = Math.max(r.left, f.left), t = Math.max(r.top, f.top), rr = Math.min(r.right, f.right), b = Math.min(r.bottom, f.bottom);
          return rr - l > 3 && b - t > 3 ? { name, x: (l + rr) / 2, y: (t + b) / 2, hand: onHand((l + rr) / 2, (t + b) / 2) } : null;
        };
        const shared = [
          meet(new DOMRect(z.left, z.top, z.right - z.left, z.bottom - z.top), "field card"),
          ...[...document.querySelectorAll<HTMLElement>("[data-chain-link] > *, [data-chain-link]")].map((node) => meet(node.getBoundingClientRect(), `chain ${node.className.toString().slice(0, 24)}`)),
        ].filter((entry) => entry != null);
        const cut = [...document.querySelectorAll<HTMLElement>('[data-chain-fx]')].map((node) => getComputedStyle(node).clipPath);
        return { frame: { left: f.left, top: f.top, right: f.right, bottom: f.bottom }, grid, shared, cut };
      }, { zone });
      assert.ok(probe.shared.some((entry) => entry.name === "field card"), `${width}x${height}: the grown hand card lies over the field card`);
      assert.ok(probe.shared.some((entry) => entry.name.startsWith("chain")), `${width}x${height}: the grown hand card meets the chain badge or callout`);
      for (const point of probe.grid) assert.ok(point.hand, `${width}x${height}: at ${Math.round(point.x)},${Math.round(point.y)} the page hits ${point.hit}, not the hovered hand card`);
      for (const entry of probe.shared) assert.ok(entry.hand, `${width}x${height}: over the ${entry.name} the page does not hit the hovered hand card`);
      assert.ok(probe.cut.some((value) => value !== "none"), `${width}x${height}: the chain layers are cut out where the hand card is`);
      await duel.screenshot({ path: resolve(out, `hand-over-field-${width}x${height}.png`) });
      // A click on the part of the card that lies over the field card answers with the hand card's choice.
      const over = probe.shared.find((entry) => entry.name === "field card")!;
      await duel.mouse.click(over.x, over.y);
      await duel.waitForTimeout(600);
      const sent = await duel.evaluate(() => ({ writes: (window as unknown as { __previewWrites?: string[] }).__previewWrites ?? [], bodies: (window as unknown as { __previewBodies?: string[] }).__previewBodies ?? [] }));
      assert.equal(sent.writes.length, 1, `${width}x${height}: one answer was sent, got ${JSON.stringify(sent.writes)}`);
      assert.match(sent.bodies[0] ?? "", new RegExp(`card:${best.index}`), `${width}x${height}: the answer carries the hovered hand card: ${sent.bodies[0]}`);
      // The pointer on the field card itself (not under the hand card): that card is the hit, and the hand card is back at rest.
      await duel.mouse.move(2, 2);
      await duel.waitForTimeout(1000);
      const clear = await duel.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-chain-fx]')].map((node) => getComputedStyle(node).clipPath));
      assert.deepEqual([...new Set(clear)], ["none"], `${width}x${height}: the chain layers are whole again at rest`);
      const fieldHit = await duel.evaluate(({ zone: z }: { zone: { left: number; top: number; right: number; bottom: number } }) => {
        const el = document.elementFromPoint((z.left + z.right) / 2, z.top + 6);
        return el?.closest('[data-zones~="0:8:1"]') != null;
      }, { zone });
      assert.ok(fieldHit, `${width}x${height}: at rest the field card is the hit`);
      assert.deepEqual(duelErrors, []);
      results[`${width}x${height}:chain-over-hand`] = { handIndex: best.index, overlapPx: Math.round(best.area), points: probe.grid.length, shared: probe.shared.map((entry) => entry.name) };
      await shell.close();
    }
  }

  // The same rule in the table shells (3-way, 4-way grid) and the phone room: every point of a hovered hand card hits that card.
  for (const [name, path, [width, height]] of [["ffa3", "/dev/table-preview/ffa3?state=chain-2", [1920, 1080]], ["ffa4", "/dev/table-preview/ffa4?state=chain-2", [1920, 1080]], ["phone", "/dev/table-preview/classic/room?state=m1", [390, 844]]] as Array<[string, string, [number, number]]>) {
    const shell = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const table = await shell.newPage();
    await table.addInitScript("window.__name = (fn) => fn");
    await table.goto(`${base}${path}`, { timeout: 180_000 });
    await table.locator('[data-hand-seat][data-side="you"] [data-hand-card]').first().waitFor({ state: "visible", timeout: 120_000 });
    await table.waitForTimeout(3000);
    const count = await table.locator('[data-hand-seat][data-side="you"] [data-hand-card]').count();
    for (let index = 0; index < count; index += 1) {
      const centre = await table.evaluate((i: number) => { const box = document.querySelectorAll('[data-hand-seat][data-side="you"] [data-hand-card]')[i]!.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }, index);
      await table.mouse.move(2, 2);
      await table.waitForTimeout(700);
      await table.mouse.move(centre.x, centre.y, { steps: 4 });
      await table.waitForTimeout(900);
      const stray = await table.evaluate(() => {
        const card = document.querySelector<HTMLElement>('[data-hand-seat][data-side="you"] [data-hand-card]:hover');
        if (!card) return ["no hovered card"];
        const f = (card.querySelector("[data-card-frame]") ?? card).getBoundingClientRect();
        const found: string[] = [];
        for (const fx of [0.05, 0.25, 0.5, 0.75, 0.95]) for (const fy of [0.04, 0.2, 0.4, 0.6, 0.8, 0.96]) {
          const x = f.left + f.width * fx, y = f.top + f.height * fy;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          const hit = document.elementFromPoint(x, y);
          // A neighbour card of the same hand is no field card: the pointer there still ends in your hand.
          if (hit && !card.contains(hit) && !hit.closest('[data-hand-seat][data-side="you"]')) found.push(`${Math.round(x)},${Math.round(y)} ${String(hit.className).slice(0, 40)}`);
        }
        return found;
      });
      assert.deepEqual(stray, [], `${name} ${width}x${height}: hand card ${index} is covered at these points`);
    }
    await table.screenshot({ path: resolve(out, `hand-over-field-${name}.png`) });
    results[`${name}:hand-hit`] = { cards: count };
    await shell.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
