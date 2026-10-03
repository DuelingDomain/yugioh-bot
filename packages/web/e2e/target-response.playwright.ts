import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { targetingResponseGame } from "../../duel-server/tests/helpers/target-response.js";

// Playwright is deliberately external to the repo. Set PLAYWRIGHT_MODULE to an installed index.mjs.
// Run: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx packages/web/e2e/target-response.playwright.ts
const root = fileURLToPath(new URL(".", import.meta.url));
const artifacts = resolve(process.env.TARGET_RESPONSE_ARTIFACTS ?? "/tmp/yugioh-target-response");
await mkdir(artifacts, { recursive: true });
const game = await targetingResponseGame();
let snapshot: ReturnType<typeof game.view>;
try {
  snapshot = game.view(1);
  for (const viewer of [0, 1, null]) {
    const view = game.view(viewer);
    assert.deepEqual(view.chain[0]?.targets, [{ controller: 1, location: 8, sequence: 0 }]);
    assert.deepEqual(view.events.findLast((event) => event.kind === "target")?.targets,
      [{ controller: 1, location: 8, sequence: 0 }]);
    assert.equal(view.seats[1].spells[0]?.code, viewer === 1 ? 44095762 : undefined);
    if (viewer !== 1) assert.doesNotMatch(JSON.stringify(view), /44095762|Mirror Force|53582587|Torrential Tribute/);
    await writeFile(resolve(artifacts, `viewer-${viewer ?? "spectator"}.json`), JSON.stringify(view, null, 2));
  }
} finally { game.close(); }
assert.equal(snapshot.prompt?.context?.type, "chain");
assert.equal(snapshot.chain.length, 1);
await writeFile(resolve(artifacts, "responding-view.json"), JSON.stringify(snapshot, null, 2));

await build({
  configFile: false, root, publicDir: resolve(root, "../public"), cacheDir: resolve(artifacts, ".vite"),
  base: "./",
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) }, dedupe: ["react", "react-dom"] },
  build: {
    outDir: resolve(artifacts, "bundle"), emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "target-response-browser.tsx"),
      output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" },
    },
  },
  plugins: [{
    name: "target-response-test-only",
    enforce: "pre",
    resolveId(id) { if (id === "next/font/google") return "\0test-fonts"; },
    load(id) {
      if (id === "\0test-fonts") return `const font = () => ({className: '', variable: '', style: {}});
        export {font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed};`;
    },
  }, react()],
});
const html = resolve(artifacts, "bundle/index.html");
await writeFile(html, `<!doctype html><html><head><title>MST target reproduction</title>
  <link rel="stylesheet" href="./browser.css"><style>
    * {box-sizing:border-box} body {margin:0;padding:20px;background:#111218;color:#efe7d5;font:16px Arial}
    h1 {margin:0 0 8px;font-size:24px} p {margin:0 0 12px} button {font:inherit}
  </style></head><body><div id="root"></div>
  <script type="application/json" id="engine-view">${JSON.stringify(snapshot).replace(/</g, "\\u003c")}</script>
  <script type="module" src="./browser.js"></script></body></html>`);
// This mode still runs the real engine, privacy assertions, snapshots and production UI build.
// The default path retains the browser assertions; use build-only in sandboxes without Chromium.
if (process.env.TARGET_RESPONSE_BUILD_ONLY === "1") {
  console.log(JSON.stringify({ snapshot: "passed", viewerPrivacy: "passed", build: "passed", artifacts }));
} else {
  const require = createRequire(import.meta.url);
  const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright");
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
    });
    const width = Number(process.env.PROOF_WIDTH) || 1440;
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 940 }, reducedMotion: "reduce" });
    const pageErrors: string[] = [];
    page.on("pageerror", (error: Error) => { pageErrors.push(error.message); });
    // No image cache is prepared here; label only the art with local deterministic SVG placeholders.
    const names: Record<string, string> = { "5318639": "Mystical Space Typhoon", "44095762": "Mirror Force", "53582587": "Torrential Tribute" };
    await page.route("**/api/cards/*/image?*", async (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
      const code = /\/cards\/(\d+)\//.exec(route.request().url())?.[1] ?? "0";
      const label = names[code] ?? `Card ${code}`;
      await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="260">
        <rect width="180" height="260" fill="${code === "5318639" ? "#236e64" : "#704354"}"/>
        <text x="90" y="115" fill="white" text-anchor="middle" font-size="12">${label}</text>
        <text x="90" y="145" fill="white" text-anchor="middle" font-size="12">${code}</text></svg>` });
    });
    const evidence = [];
    for (const provided of [false, true]) {
      await page.goto(`${pathToFileURL(html).href}${provided ? "?provided-target=1" : ""}`);
      await page.locator('[data-duel-field="true"]').waitFor({ state: "visible" });
      await page.locator('[data-prompt-panel="true"]').waitFor({ state: "visible" });
      await page.locator('[data-chain-link="1"][data-placed="true"]').waitFor({ state: "visible" });
      assert.deepEqual(pageErrors, [], "render harness must have no browser errors");
      const file = resolve(artifacts, provided ? "provided-target.png" : "real-duel-response.png");
      await page.screenshot({ path: file, fullPage: true });
      const text = await page.locator('[data-chain-sr-list="true"]').textContent();
      const targetMarks = await page.locator('[data-chain-target="1"][data-target-zone="1:8:0"][data-placed="true"]').count();
      const row = { suppliedTargetData: provided, responsePanel: true, placedChainBadge: true, targetMarks, chainText: text, screenshot: file };
      evidence.push(row);
      console.log(JSON.stringify(row));
    }
    await writeFile(resolve(artifacts, "evidence.json"), JSON.stringify(evidence, null, 2));
    // Assert after capturing BOTH cases, so a failing reproduction still leaves screenshots.
    assert.match(evidence[0].chainText ?? "", /target.*(?:Spell.*Trap|1:8:0)/i,
      "BUG 3: response is visible, but pending Chain Link 1 does not identify its target");
    assert.ok(evidence.every((row) => row.targetMarks > 0), "both cases must show a persistent effect-target marker");
  } finally {
    await browser?.close();
  }
}
