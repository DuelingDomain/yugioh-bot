import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { XYZ_MATERIALS, xyzMaterialsGame } from "../../duel-server/tests/support/xyz-materials.js";
import { buildProofPage } from "./proof-build.js";

/*
 * Browser proof for the Xyz material badge and the Materials view (issue 394): the real field, badge, pile viewer, inspector and
 * card menu on views from the real engine. Run with
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PROOF_DIR=/tmp/xyz-proof DUEL_DATA_DIR=<engine data> \
 *     node --import tsx packages/web/e2e/xyz-materials.playwright.ts
 * PROOF_CASE = 1v1-domain (default), 1v1-standard or ffa3-domain. PROOF_WIDTH x PROOF_HEIGHT set the viewport; PROOF_TOUCH=1 taps.
 * Besides the flow, every badge on the board (yours and the rival's) is measured against the ATK/DEF plate, the equip chip and the
 * legal mark of its own card, with and without an equip card and with legal targets. The Tag stage runs the same checks and the tap.
 */
const artifacts = resolve(process.env.PROOF_DIR ?? "/tmp/xyz-materials-proof");
const kind = process.env.PROOF_CASE ?? "1v1-domain";
const width = Number(process.env.PROOF_WIDTH) || 1920;
const height = Number(process.env.PROOF_HEIGHT) || 1080;
const touch = process.env.PROOF_TOUCH === "1";
await mkdir(artifacts, { recursive: true });

const [format, mode] = kind === "ffa3-domain" ? (["ffa3", "domain"] as const) : kind === "1v1-standard" ? (["1v1", "normal"] as const) : (["1v1", "domain"] as const);
const game = await xyzMaterialsGame({ format, mode, legacy: format === "1v1" });
let snapshot: unknown;
try {
  const engine = game.view(0);
  assert.deepEqual(engine.seats[0].monsters.find((card) => card?.code != null)?.materials?.map((card) => card.name), XYZ_MATERIALS);
  snapshot = { engine, mySeat: 0, multi: format !== "1v1" };
} finally {
  game.close();
}
const html = await buildProofPage(artifacts, "xyz-materials-browser.tsx", `Xyz materials (${kind})`, snapshot);
if (process.env.PROOF_BUILD_ONLY === "1") {
  console.log(JSON.stringify({ build: "passed", artifacts }));
} else {
  const require = createRequire(import.meta.url);
  const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright");
  const playwright = await import(pathToFileURL(playwrightModule).href);
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce", hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
    // tsx wraps named functions in a __name helper that page.evaluate does not carry over.
    await page.addInitScript("window.__name = (fn) => fn");
    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => { pageErrors.push(error.message); });
    // No image cache here: label the art with local placeholders.
    await page.route("**/api/cards/*/image?*", async (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
      const code = /\/cards\/(\d+)\//.exec(route.request().url())?.[1] ?? "0";
      await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260"><rect width="180" height="260" fill="#3b4a7a"/><text x="90" y="135" fill="white" text-anchor="middle" font-size="14">${code}</text></svg>` });
    });
    const shot = (name: string) => resolve(artifacts, `${kind}-${width}x${height}-${name}.png`);
    const press = (locator: { click(): Promise<void>; tap(): Promise<void> }) => (touch ? locator.tap() : locator.click());
    const evidence: Record<string, unknown> = { kind, width, height, touch };

    /** Every badge of the board against the plate, equip chip and legal mark of its own zone: no two boxes may touch. */
    const measure = () => page.evaluate(() => {
      const box = (node: Element | null) => { const r = node?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
      const touches = (a: NonNullable<ReturnType<typeof box>>, b: NonNullable<ReturnType<typeof box>>) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      return [...document.querySelectorAll("[data-materials-badge]")].map((badge) => {
        const zone = badge.closest("[data-side]")!;
        const own = box(badge)!;
        const hits: string[] = [];
        for (const [name, selector] of [["plate", "[data-card-plate]"], ["equip chip", "[data-equip-chip]"], ["legal mark", "[data-zone-mark]"]] as const) {
          for (const other of zone.querySelectorAll(selector)) {
            const found = box(other);
            if (found && touches(own, found)) hits.push(name);
          }
        }
        const card = box(zone.querySelector("button") ?? zone);
        const chip = box(zone.querySelector("[data-equip-chip]"));
        const mark = box(zone.querySelector("[data-zone-mark]"));
        return { side: zone.getAttribute("data-side"), badge: own, card, chip, mark, hits, inside: !card || (own.x >= card.x - 3 && own.y >= card.y - 3 && own.x + own.w <= card.x + card.w + 3 && own.y + own.h <= card.y + card.h + 3) };
      });
    });
    const checkNoOverlap = async (label: string, expectLegal: boolean, expectEquip: boolean, bothSides = format === "1v1") => {
      const rows = await measure();
      assert.ok(rows.length >= 2, `${label}: a badge on your Xyz and on the rival's Xyz`);
      if (bothSides) assert.ok(rows.some((row) => row.side === "opp") && rows.some((row) => row.side !== "opp"), `${label}: both sides show a badge ${JSON.stringify(rows)}`);
      for (const row of rows) assert.deepEqual(row.hits, [], `${label}: the ${row.side} badge touches ${row.hits.join(", ")} ${JSON.stringify(row)}`);
      const marks = await page.locator("[data-zone-mark]").count();
      const chips = await page.locator("[data-equip-chip]").count();
      if (expectLegal) assert.ok(marks > 0, `${label}: legal marks show`);
      if (expectEquip) assert.ok(chips > 0, `${label}: equip chips show`);
      evidence[label] = { rows, marks, chips };
    };

    await page.goto(pathToFileURL(html).href);
    const badge = page.locator("[data-materials-badge]").first();
    await badge.waitFor({ state: "visible" });
    assert.equal(await badge.getAttribute("data-materials-badge"), "2");
    assert.equal((await badge.textContent())?.trim(), "2");
    evidence.badgeBox = await badge.boundingBox();
    await checkNoOverlap("board", false, false);
    await page.screenshot({ path: shot("1-board"), fullPage: true });

    // The badge opens the Materials view; each material shows and can be inspected.
    await press(badge);
    const viewer = page.locator("[data-pile-viewer]");
    await viewer.waitFor({ state: "visible" });
    assert.match((await viewer.textContent()) ?? "", /Materials \(2\)/);
    for (const name of XYZ_MATERIALS) assert.ok(await viewer.getByRole("button", { name: new RegExp(`^${name}`) }).count() > 0, `${name} listed`);
    await page.screenshot({ path: shot("2-materials-view"), fullPage: true });
    await press(viewer.getByRole("button", { name: new RegExp(`^${XYZ_MATERIALS[0]}`) }));
    await page.screenshot({ path: shot("3-material-inspected"), fullPage: true });

    // The view is live: a material that leaves the Xyz leaves the view, and a face-down Xyz shows none.
    await page.evaluate(() => (window as unknown as { __detachOne(): void }).__detachOne());
    await page.waitForFunction(() => /Materials \(1\)/.test(document.querySelector("[data-pile-viewer]")?.textContent ?? ""));
    await page.evaluate(() => (window as unknown as { __flipDown(): void }).__flipDown());
    await page.waitForFunction(() => !/Materials \([1-9]/.test(document.querySelector("[data-pile-viewer]")?.textContent ?? ""));

    // Overlap proof: a badge next to an equip chip, and next to legal marks.
    await page.goto(`${pathToFileURL(html).href}?equip=1`);
    await page.locator("[data-materials-badge]").first().waitFor({ state: "visible" });
    await checkNoOverlap("equip", false, true);
    await page.screenshot({ path: shot("5-equip"), fullPage: true });
    await page.goto(`${pathToFileURL(html).href}?legal=1&equip=1`);
    await page.locator("[data-materials-badge]").first().waitFor({ state: "visible" });
    await checkNoOverlap("legal", true, true);
    await page.screenshot({ path: shot("6-legal"), fullPage: true });
    // A legal target keeps its tap: the badge does not open the view.
    await press(page.locator("[data-materials-badge]").first());
    assert.equal(await page.locator("[data-pile-viewer]").count(), 0, "a legal target does not open Materials");

    // The card menu adds View materials.
    await page.goto(`${pathToFileURL(html).href}?menu=1`);
    const item = page.getByRole("menuitem", { name: "View materials (2)" });
    await item.waitFor({ state: "visible" });
    await page.screenshot({ path: shot("4-card-menu"), fullPage: true });
    await press(item);
    await page.locator("[data-pile-viewer]").waitFor({ state: "visible" });

    // The inspector button opens the same view.
    await page.goto(pathToFileURL(html).href);
    await press(page.getByTestId("inspector-view-materials"));
    await page.locator("[data-pile-viewer]").waitFor({ state: "visible" });

    // The Tag stage: the same measure, then a tap on the badge of the focused field.
    await page.goto(`${pathToFileURL(html).href}?tag=1&equip=1`);
    await page.locator("[data-materials-badge]").first().waitFor({ state: "visible" });
    await checkNoOverlap("tag", false, true, false);
    await page.screenshot({ path: shot("7-tag"), fullPage: true });
    await page.goto(`${pathToFileURL(html).href}?tag=1&legal=1`);
    await page.locator("[data-materials-badge]").first().waitFor({ state: "visible" });
    await checkNoOverlap("tag-legal", true, false, false);
    await page.goto(`${pathToFileURL(html).href}?tag=1`);
    await page.locator("[data-materials-badge]").first().waitFor({ state: "visible" });
    await press(page.locator("[data-materials-badge]").first());
    if (!(await page.locator("[data-pile-viewer]").count())) await press(page.locator("[data-materials-badge]").first());
    await page.locator("[data-pile-viewer]").waitFor({ state: "visible" });
    assert.match((await page.locator("[data-pile-viewer]").textContent()) ?? "", /Materials \(2\)/);
    await page.screenshot({ path: shot("8-tag-materials"), fullPage: true });

    assert.deepEqual(pageErrors, [], "render harness must have no browser errors");
    await writeFile(resolve(artifacts, `${kind}-${width}x${height}-evidence.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    await browser.close();
  }
}
