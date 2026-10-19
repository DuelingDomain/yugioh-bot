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

    await page.goto(pathToFileURL(html).href);
    const badge = page.locator("[data-materials-badge]").first();
    await badge.waitFor({ state: "visible" });
    assert.equal(await badge.getAttribute("data-materials-badge"), "2");
    assert.equal((await badge.textContent())?.trim(), "2");
    evidence.badgeBox = await badge.boundingBox();
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

    assert.deepEqual(pageErrors, [], "render harness must have no browser errors");
    await writeFile(resolve(artifacts, `${kind}-${width}x${height}-evidence.json`), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    await browser.close();
  }
}
