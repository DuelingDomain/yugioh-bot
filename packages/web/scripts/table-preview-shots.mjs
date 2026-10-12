// Screenshots of the multiplayer table preview, for comparing by eye with the prototype shots.
//   OUT_DIR=<scratchpad dir> node packages/web/scripts/table-preview-shots.mjs
// Env: PREVIEW_BASE (default http://localhost:3100), OUT_DIR (required), MODES=ffa3,ffa4,tag, SIZES=1440x900,1280x720,
//      STATES=main,battle-aim,... (default all nine), CAM=home|overview|fly|focus:1|look:1 (default home).
// It also shoots /dev/fx-lab, the 1v1 guard. Playwright comes from the root node_modules (chromium in ~/.cache/ms-playwright).
// Files land in OUT_DIR as <mode>-<state>-<cam>-<width>.png and console errors print at the end. Delete OUT_DIR when done.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.env.PREVIEW_BASE ?? "http://localhost:3100").replace(/\/$/, "");
const outDir = process.env.OUT_DIR;
if (!outDir) {
  console.error("OUT_DIR is required (use your scratchpad directory).");
  process.exit(1);
}
const modes = (process.env.MODES ?? "ffa3,ffa4,tag").split(",").map((part) => part.trim()).filter(Boolean);
const sizes = (process.env.SIZES ?? "1440x900,1280x720").split(",").map((part) => {
  const [width, height] = part.trim().split("x").map(Number);
  return { width, height };
});
const allStates = ["main", "battle-aim", "chain-2", "target-pick", "choose-opponent", "direct-attack", "elimination", "spectator", "result"];
const states = (process.env.STATES ?? allStates.join(",")).split(",").map((part) => part.trim()).filter(Boolean);
const cam = process.env.CAM ?? "home";
const camSlug = cam.replace(/[^a-z0-9]+/gi, "-");

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const problems = [];

try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await context.newPage();
    let current = "";
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`${current}: console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`${current}: page error: ${error.message}`));

    const shoot = async (url, file) => {
      current = `${url} @${size.width}`;
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
      if (!response || response.status() >= 400) problems.push(`${current}: HTTP ${response?.status() ?? "none"}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, file) });
    };

    for (const mode of modes) {
      for (const state of states) {
        await shoot(`${base}/dev/table-preview/${mode}?state=${state}&cam=${encodeURIComponent(cam)}`, `${mode}-${state}-${camSlug}-${size.width}.png`);
      }
    }
    await shoot(`${base}/dev/fx-lab`, `fx-lab-1v1-${size.width}.png`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Shots written to ${outDir}.`);
}
