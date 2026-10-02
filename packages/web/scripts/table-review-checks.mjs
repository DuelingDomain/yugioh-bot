// Run against an isolated DUEL_FX_LAB=1 web server. No duel engine or live services are used.
// PREVIEW_BASE=http://127.0.0.1:3400 node packages/web/scripts/table-review-checks.mjs
// Optional CHECKS (comma-separated), OUT_DIR, REDUCED=0. Run from the repository root.
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const base = (process.env.PREVIEW_BASE ?? "http://127.0.0.1:3400").replace(/\/$/, "");
const out = process.env.OUT_DIR ?? "packages/web/coverage/ui-review/final";
const reduced = process.env.REDUCED !== "0";
const scenes = {
  lp: ["ffa3", "main"],
  result: ["ffa3", "result"],
  chain: ["ffa3", "chain-2"],
  "chain-expanded": ["ffa3", "chain-2"],
  responders: ["ffa3", "chain-2"],
  clock: ["ffa3", "chain-2"],
  damage: ["ffa3", "main"],
  "direct-names": ["ffa3", "direct-attack"],
  "direct-lane": ["ffa3", "direct-attack"],
  elimination: ["ffa3", "elimination"],
  attacklock: ["ffa3", "main"],
  "ffa4-chain": ["ffa4", "chain-2"],
  "ffa4-chain-expanded": ["ffa4", "chain-2"],
  "ffa4-direct-lane": ["ffa4", "direct-attack"],
  "1v1": [],
};
const checks = (process.env.CHECKS ?? Object.keys(scenes).join(",")).split(",");
for (const check of checks) assert(check in scenes, `Unknown check: ${check}`);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let passes = 0;
let failures = 0;

function overlaps(a, b) {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}
async function separate(a, b, label) {
  const ar = await a.boundingBox();
  const br = await b.boundingBox();
  assert(ar && br, `${label}: missing visible rectangles`);
  assert(!overlaps(ar, br), `${label}: overlap ${JSON.stringify({ ar, br })}`);
}
// The semantic LP value is visually hidden; compare the actual visible rolling numerals for geometry.
function lpNumber(page, seat) {
  return page.locator(`[data-lp-seat="${seat}"] [aria-hidden="true"]`).first();
}
async function clearRivalLp(page, panel, seatCount) {
  await expect(panel).toBeVisible();
  for (let seat = 1; seat < seatCount; seat++) await separate(panel, lpNumber(page, seat), `panel vs seat ${seat} LP`);
}
async function clearOwnMonsters(page, panel) {
  const monsters = page.locator('[data-seat-field="0"] [data-zones^="0:4:"][data-occupied="true"]');
  assert(await monsters.count() > 0, "fixture must contain own monsters");
  for (const monster of await monsters.all()) await separate(panel, monster, "direct choice vs own monster");
}
async function reachableOptions(panel, expectedCount) {
  const choices = panel.locator("button[data-index]");
  await expect(choices).toHaveCount(expectedCount);
  for (const choice of await choices.all()) {
    await choice.scrollIntoViewIfNeeded();
    await expect(choice).toBeInViewport({ ratio: 0.9 });
  }
}
async function settle(page) {
  // Hide only Next's development indicator. Product overlays remain visible and participate in checks.
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.waitForTimeout(reduced ? 800 : 2400);
}

try {
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
    let errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    for (const check of checks) {
      try {
        errors = [];
        const [format, state] = scenes[check];
        const url = check === "1v1" ? `${base}/dev/fx-lab`
          : `${base}/dev/table-preview/${format}?fixture=review&state=${state}&reduced=${reduced ? 1 : 0}`;
        const response = await page.goto(url, { waitUntil: "networkidle" });
        assert(response?.ok(), `HTTP ${response?.status()}`);
        if (check !== "1v1") await expect(page.locator("[data-table-stage]")).toHaveAttribute("data-ready", "true");
        await settle(page);
        if (check === "damage") {
          await page.getByRole("button", { name: "Fixture damage", exact: true }).click();
          await expect(page.locator('[data-lp-seat="2"] [data-lp-value]')).toHaveText("6,000");
          await page.waitForTimeout(reduced ? 300 : 2400);
        }
        if (check.endsWith("chain-expanded")) {
          await page.getByRole("button", { name: "Yes", exact: true }).click();
          await expect(page.locator("[data-prompt-panel]:not([data-precheck])")).toBeVisible();
        }
        if (check === "elimination") {
          await page.reload({ waitUntil: "networkidle" });
          await settle(page);
        }
        // Capture even when a geometry assertion fails, so the failure is reviewable.
        await page.screenshot({ path: `${out}/${check}-${width}x${height}.png` });

        if (check === "lp") {
          for (const seat of [0, 1, 2]) {
            await expect(page.locator(`[data-lp-seat="${seat}"] [data-lp-value]`)).toHaveText("8,000");
            await expect(page.locator(`[data-lp-seat="${seat}"] [data-damage-chip]`)).toHaveCount(0);
          }
        }
        if (check === "result") {
          const rows = page.getByRole("list", { name: "Final standings" }).locator("li");
          assert.deepEqual(await rows.evaluateAll((rs) => rs.map((row) => row.dataset.seat)), ["0", "1", "2"]);
          await expect(rows.nth(1)).toContainText("Practice Bot (seat 2)");
          await expect(rows.nth(2)).toContainText("Practice Bot (seat 3)");
        }
        if (["chain", "chain-expanded", "ffa4-chain", "ffa4-chain-expanded"].includes(check)) {
          const panel = page.locator("[data-chain-panel]");
          await clearRivalLp(page, panel, format === "ffa4" ? 4 : 3);
          assert((await panel.boundingBox()).width >= 180, "chain panel collapsed");
          await expect(panel.getByText("Chain", { exact: true })).toBeVisible();
          await clearRivalLp(page, page.locator("[data-prompt-panel]"), format === "ffa4" ? 4 : 3);
          if (check.endsWith("chain-expanded")) {
            const responsePanel = page.locator("[data-prompt-panel]");
            await reachableOptions(responsePanel, 2);
            const priority = responsePanel.getByTestId("priority-chips");
            await priority.scrollIntoViewIfNeeded();
            for (const chip of await priority.locator("[data-seat]").all()) await expect(chip).toBeInViewport({ ratio: 0.95 });
            await responsePanel.getByRole("button", { name: "Back", exact: true }).scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${out}/${check}-scrolled-${width}x${height}.png` });
          }
        }
        if (check === "responders") {
          const chips = page.locator('[data-chain-panel] [data-testid="priority-chips"] [data-seat]');
          assert.deepEqual((await chips.allTextContents()).map((s) => s.trim()), ["You", "Practice Bot (seat 2)", "Practice Bot (seat 3)"]);
          for (const chip of await chips.all()) assert(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "responder clipped");
        }
        if (check === "clock") {
          const phases = page.getByRole("navigation", { name: "Duel phases" });
          const clock = phases.getByRole("timer");
          await expect(clock).toHaveCount(1);
          await expect(clock.locator("small")).toHaveCount(0);
          await separate(clock, phases.locator("strong[title]"), "clock vs dock name");
          await separate(clock, phases.getByText(/^Turn \d+$/), "clock vs turn label");
          for (const seat of [0, 1, 2]) await expect(page.locator(`[data-holo="${seat}"]`)).toContainText(["03:12", "04:00", "03:25"][seat]);
        }
        if (check === "damage") {
          const panel = page.locator('[data-holo="2"]');
          const chip = page.locator("[data-damage-chip]");
          await expect(chip).toHaveCount(1);
          await expect(page.locator('[data-lp-seat="2"] [data-change]')).toHaveCount(0);
          const pr = await panel.boundingBox();
          const cr = await chip.boundingBox();
          assert(pr && cr);
          assert(cr.x >= pr.x && cr.y >= pr.y && cr.x + cr.width <= pr.x + pr.width + 1 && cr.y + cr.height <= pr.y + pr.height + 1, "damage chip escaped panel");
          for (const seat of [0, 1]) await expect(page.locator(`[data-lp-seat="${seat}"] [data-damage-chip]`)).toHaveCount(0);
        }
        if (check === "direct-names") {
          for (const seat of [2, 3]) await expect(page.getByRole("button", { name: `Attack Practice Bot (seat ${seat}) directly`, exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: /Attack Player \d+ directly/ })).toHaveCount(0);
        }
        if (["direct-lane", "ffa4-direct-lane"].includes(check)) {
          const panel = page.locator("[data-prompt-panel]");
          await expect(panel).toBeVisible();
          await clearOwnMonsters(page, panel);
          await clearRivalLp(page, panel, format === "ffa4" ? 4 : 3);
          if (format === "ffa4") await expect(panel.getByRole("button", { name: /^Attack .* directly$/ })).toHaveCount(3);
          await reachableOptions(panel, format === "ffa4" ? 3 : 2);
          await page.screenshot({ path: `${out}/${check}-scrolled-${width}x${height}.png` });
          const opponentBar = page.locator("[data-opponent-bar]");
          for (let seat = 1; seat < (format === "ffa4" ? 4 : 3); seat++) await separate(opponentBar, lpNumber(page, seat), `opponent bar vs seat ${seat} LP`);
        }
        if (check === "elimination") {
          await expect(page.locator("[data-table-stage]")).toHaveAttribute("data-camera-mode", "home");
          assert.match(await page.locator("[data-turn-ring]").getAttribute("style"), /488px.*260px.*scale\(1\)/);
          await expect(page.locator("[data-camera-cue]")).toHaveCount(0);
          const note = page.getByTestId("seat-out");
          const titles = page.locator('[data-seat-field] [class*="sfName"]');
          await expect(titles).toHaveCount(3);
          for (const title of await titles.all()) await separate(note, title, "out note vs field title");
        }
        if (check === "attacklock") await expect(page.getByText("No attack until turn 4", { exact: true })).toBeVisible();
        if (check === "1v1") {
          await expect(page.locator("[data-table-stage]")).toHaveCount(0);
          await expect(page.locator("[data-duel-field]")).toBeVisible();
        }
        assert.deepEqual(errors, [], "browser errors");
        passes++;
        console.log(`PASS ${check} ${width}x${height}`);
      } catch (error) {
        failures++;
        console.error(`FAIL ${check} ${width}x${height}: ${error.message}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
