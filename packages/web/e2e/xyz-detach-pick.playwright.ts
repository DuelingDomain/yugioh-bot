import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DuelFormat } from "@yugidraft/shared/duels";
import { FIRST, openDetachGame, openDuoDrive, reachDetach, SECOND, XYZ } from "../../duel-server/tests/support/xyz-detach.js";
import { buildProofPage } from "./proof-build.js";

/*
 * Browser proof for choosing the Xyz material to detach: the real field and PromptCenter over the engine's own detach prompt.
 * The click in the browser becomes the answer, the answer goes to the real engine, and the Graveyard is checked. Run with
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PROOF_DIR=/tmp/xyz-detach-proof DUEL_DATA_DIR=<engine data> \
 *     node --import tsx packages/web/e2e/xyz-detach-pick.playwright.ts
 * PROOF_CASE = 1v1-standard (default), 1v1-domain, ffa3-standard or ffa3-domain (the table needs MULTI_WASM / DOMAIN_MULTI_WASM),
 *   or tag (the Rooftop stage with the Duo Drive detach of two: the window must sit above the plates and Confirm must work).
 * PROOF_PICK = one (Tornado Dragon: detach 1, default) or two (Ryzeal Duo Drive: detach 2, Confirm; 1v1-standard and tag only).
 * PROOF_WIDTH x PROOF_HEIGHT set the viewport; PROOF_TOUCH=1 taps.
 */
const artifacts = resolve(process.env.PROOF_DIR ?? "/tmp/xyz-detach-proof");
const kind = process.env.PROOF_CASE ?? "1v1-standard";
const tag = kind === "tag";
const pick = tag ? "two" : process.env.PROOF_PICK ?? "one";
const width = Number(process.env.PROOF_WIDTH) || 1920;
const height = Number(process.env.PROOF_HEIGHT) || 1080;
const touch = process.env.PROOF_TOUCH === "1";
await mkdir(artifacts, { recursive: true });

const [format, mode] = (tag ? ["1v1", "normal"] : kind.split("-").map((part, index) => (index === 0 ? part : part === "domain" ? "domain" : "normal"))) as [DuelFormat, "normal" | "domain"];
const two = pick === "two";
const opened = two ? await openDuoDrive() : null;
const game = opened ? opened.game : await openDetachGame(mode, format);
try {
  const seats = format === "1v1" ? 2 : 3;
  const prompt = opened ? opened.prompt : reachDetach(game, seats);
  const html = await buildProofPage(artifacts, "xyz-detach-pick-browser.tsx", `Xyz detach pick (${kind}, ${pick})`,
    { engine: game.view(0), prompt, mySeat: 0, multi: format !== "1v1" }, { viewportMeta: true });
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
      await page.addInitScript("window.__name = (fn) => fn");
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => { pageErrors.push(error.message); });
      await page.route("**/api/cards/*/image?*", async (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
        const code = /\/cards\/(\d+)\//.exec(route.request().url())?.[1] ?? "0";
        await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260"><rect width="180" height="260" fill="#3b4a7a"/><text x="90" y="135" fill="white" text-anchor="middle" font-size="14">${code}</text></svg>` });
      });
      const shot = (name: string) => resolve(artifacts, `${kind}-${pick}-${width}x${height}-${name}.png`);
      const press = (locator: { click(): Promise<void>; tap(): Promise<void> }) => (touch ? locator.tap() : locator.click());
      const tile = (name: string) => page.locator(`[data-pile-card][aria-label^="${name},"]`);
      const evidence: Record<string, unknown> = { kind, pick, width, height, touch };

      await page.goto(`${pathToFileURL(html).href}${tag ? "?tag=1" : ""}`);
      const viewer = page.locator("[data-pile-viewer]");
      await viewer.waitFor({ state: "visible" });
      // The centred Materials window: art tiles for each material, over the board, inside the viewport.
      const box = (await viewer.boundingBox())!;
      const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      assert.ok(Math.abs(middle.x - width / 2) < width * 0.12, `the window is centred horizontally ${JSON.stringify(box)}`);
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `the window fits the viewport ${JSON.stringify(box)}`);
      evidence.window = box;
      const names = two ? ["Celtic Guardian", "Axe Raider", "Mystical Elf"] : [FIRST, SECOND];
      for (const name of names) assert.equal(await tile(name).count(), 1, `${name} is a tile`);
      assert.equal(await viewer.locator("img").count() >= names.length, true);
      if (tag) {
        // The Rooftop plates and HUD sit under the window: every point of the window, and every plate it covers, hits the window.
        const stacking = await page.evaluate(() => {
          const inWindow = (x: number, y: number) => document.elementFromPoint(x, y)?.closest("[data-pile-viewer]") != null;
          const dialog = document.querySelector("[data-pile-viewer]")!.getBoundingClientRect();
          const corners = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]].map(([fx, fy]) => inWindow(dialog.x + dialog.width * fx, dialog.y + dialog.height * fy));
          const hud = [...document.querySelectorAll("[data-team-plate], [data-camera-rail], [data-hub]")].map((el) => {
            const r = el.getBoundingClientRect();
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            const visible = r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
            const top = document.elementFromPoint(x, y);
            return { name: el.getAttributeNames().find((a) => a.startsWith("data-")) ?? "?", visible, covered: top != null && !el.contains(top) };
          });
          return { corners, hud };
        });
        assert.deepEqual(stacking.corners, [true, true, true, true, true], "the window is above the Rooftop board");
        assert.ok(stacking.hud.some((entry) => entry.visible), "the plates are on the page");
        assert.deepEqual(stacking.hud.filter((entry) => entry.visible && !entry.covered), [], "no Rooftop plate or HUD is drawn over the window or its scrim");
        evidence.stacking = stacking;
      }
      await page.screenshot({ path: shot("1-window"), fullPage: true });

      if (two) {
        const confirm = page.locator("[data-pick-confirm]");
        assert.equal(await confirm.isDisabled(), true, "Confirm waits for the second material");
        await press(tile("Mystical Elf"));
        assert.equal(await confirm.isDisabled(), true);
        await press(tile("Axe Raider"));
        assert.equal(await confirm.isDisabled(), false, "Confirm opens at the engine count");
        await page.screenshot({ path: shot("2-picked"), fullPage: true });
        // Confirm is what a tap or a click reaches: inside the viewport, and nothing else on top of it.
        const hit = await confirm.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { reached: top != null && el.contains(top), inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
        });
        assert.deepEqual(hit, { reached: true, inside: true }, "Confirm is on screen and nothing covers it");
        evidence.confirm = hit;
        await press(confirm);
      } else {
        assert.equal(await page.locator("[data-pick-confirm]").count(), 0, "a single pick has no Confirm");
        await press(tile(SECOND));
      }
      const answers = await page.evaluate(() => (window as unknown as { __answers: unknown[] }).__answers);
      assert.equal(answers.length, 1, "one answer");
      evidence.answer = answers[0];
      assert.deepEqual(pageErrors, [], "render harness must have no browser errors");

      // The answer from the browser goes to the real engine.
      game.answer(0, prompt.id, answers[0] as never);
      const seat = game.view(0).seats[0];
      const graveyard = seat.graveyard.map((card) => card.name).sort();
      const left = seat.monsters.find((card) => card?.materials != null && card.materials.length >= 0 && card.name === (two ? "Ryzeal Duo Drive" : XYZ))?.materials?.map((card) => card.name);
      if (two) {
        assert.deepEqual(graveyard, ["Axe Raider", "Mystical Elf"]);
        assert.deepEqual(left, ["Celtic Guardian"]);
      } else {
        assert.deepEqual(graveyard, [SECOND]);
        assert.deepEqual(left, [FIRST]);
      }
      evidence.graveyard = graveyard;
      evidence.materialsLeft = left;
      await writeFile(resolve(artifacts, `${kind}-${pick}-${width}x${height}-evidence.json`), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence));
    } finally {
      await browser.close();
    }
  }
} finally {
  game.close();
}
