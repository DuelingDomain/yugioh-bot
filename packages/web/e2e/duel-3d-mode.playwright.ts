import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Checks the 3D mode board on /dev/solid-preview against the Solid Vision concept.
// Playwright is deliberately external to the repo. Set PLAYWRIGHT_MODULE to an installed index.mjs
// (without it, `playwright` is resolved from node_modules).
// Start the page first:  cd packages/web && DUEL_FX_LAB=1 npx next dev -p 3616
// Run: PREVIEW_URL=http://localhost:3616 node --import tsx packages/web/e2e/duel-3d-mode.playwright.ts
// Environment: PREVIEW_URL, DUEL3D_OUT (default /tmp/yugioh-duel-3d-mode), DUEL3D_ID (shots go under <out>/<id>/),
// DUEL3D_STATES (comma list), CHROMIUM_PATH.
const here = fileURLToPath(new URL(".", import.meta.url));
const conceptDir = resolve(here, "../../../docs/design/duel-3d-mode/concept/solid-vision");
const base = (process.env.PREVIEW_URL ?? "http://localhost:3616").replace(/\/$/, "");
const out = resolve(process.env.DUEL3D_OUT ?? "/tmp/yugioh-duel-3d-mode");
const id = process.env.DUEL3D_ID ?? "e2e";
const shotDir = resolve(out, id);
const ALL_STATES = ["m1", "summon", "battle", "chain", "damage", "m2", "end"];
const states = (process.env.DUEL3D_STATES ?? ALL_STATES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const viewports = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
] as const;

/** The plane box of the tilted table may differ from the concept by this share (spec section 4, W8). */
const ASPECT_TOLERANCE = 0.04;
/** Zones must be at least this wide on a phone. */
const MIN_ZONE_PX = 44;
/** Phase bar hooks, most specific first. The station track root carries data-tone and data-reduced. */
const PHASE_BAR = '[data-sv-phase], [data-sv-phasebar], [data-tone][data-reduced]';

await mkdir(shotDir, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright");
const playwright = await import(pathToFileURL(playwrightModule).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
});

// tsx adds a __name helper to arrow functions; page.evaluate sends them to the browser, which has none.
const openPage = async (options: Record<string, unknown>) => {
  const page = await browser.newPage(options);
  await page.addInitScript("window.__name = (fn) => fn;");
  return page;
};

const failures: string[] = [];
const summary: Record<string, unknown>[] = [];
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message); };

type Box = { width: number; height: number };

/** The `.plane` box of the concept at this viewport (a still render of the first state). */
async function conceptPlane(width: number, height: number): Promise<Box | null> {
  const page = await openPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${pathToFileURL(resolve(conceptDir, "index.html")).href}?still#m1`, { waitUntil: "load" });
    await page.waitForSelector(".plane", { timeout: 10_000 });
    await page.waitForTimeout(1500);
    return await page.evaluate(() => {
      const r = document.querySelector(".plane")!.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

/** Concept (left) and ours (right) on one canvas. */
async function composite(file: string, left: string, right: string, width: number, height: number) {
  const page = await openPage({ viewport: { width: width * 2 + 24, height: height + 40 }, deviceScaleFactor: 1 });
  const data = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
  await page.setContent(`<body style="margin:0;background:#111;color:#cfc6b0;font:14px sans-serif">
    <div style="display:flex;gap:24px;padding:0">
      <figure style="margin:0"><figcaption style="height:20px">concept</figcaption><img src="${await data(left)}" width="${width}"></figure>
      <figure style="margin:0"><figcaption style="height:20px">built</figcaption><img src="${await data(right)}" width="${width}"></figure>
    </div></body>`);
  await page.screenshot({ path: file });
  await page.close();
}

try {
  for (const vp of viewports) {
    const concept = await conceptPlane(vp.width, vp.height);
    check(concept != null, `${vp.name}: could not measure the concept plane`);
    const conceptAspect = concept ? concept.width / concept.height : 0;
    for (const state of states) {
      const label = `${vp.name}/${state}`;
      const page = await openPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.mobile, isMobile: false });
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      const response = await page.goto(`${base}/dev/solid-preview?state=${state}`, { waitUntil: "load" });
      assert.ok(response && response.status() === 200, `${label}: /dev/solid-preview answered ${response?.status()} (start next dev with DUEL_FX_LAB=1)`);
      await page.waitForSelector("[data-sv-plane]", { timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(900);

      const shot = resolve(shotDir, `${vp.name}-${state}.png`);
      await page.screenshot({ path: shot });
      const conceptShot = resolve(conceptDir, "shots", `${vp.name}-${state}.png`);
      if (existsSync(conceptShot)) await composite(resolve(out, `composite-${vp.name}-${state}.png`), conceptShot, shot, vp.width, vp.height);

      const m = await page.evaluate(({ phaseSel, minZone }: { phaseSel: string; minZone: number }) => {
        const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const plane = document.querySelector("[data-sv-plane]")!;
        const zones = [...plane.querySelectorAll("[data-zones]")].map((el) => {
          const r = rect(el);
          const cs = getComputedStyle(el);
          return { key: el.getAttribute("data-zones"), width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" };
        });
        const phase = document.querySelector(phaseSel);
        const hands = [...document.querySelectorAll("[data-hand-seat]")].map(rect);
        const phaseBox = phase ? rect(phase) : null;
        const overlap = phaseBox ? hands.filter((h) => h.width > 0 && h.height > 0 && h.left < phaseBox.right && h.right > phaseBox.left && h.top < phaseBox.bottom - 1 && h.bottom > phaseBox.top + 1).length : -1;
        const de = document.documentElement;
        return {
          plane: rect(plane), zones, phaseFound: !!phase, handCount: hands.length, overlap, minZone,
          scrollW: de.scrollWidth, clientW: de.clientWidth, bodyScrollW: document.body.scrollWidth,
          clocks: ["opp", "you"].map((side) => !!document.querySelector(`[data-sv-clock="${side}"]`)),
        };
      }, { phaseSel: PHASE_BAR, minZone: MIN_ZONE_PX });

      const aspect = m.plane.width / m.plane.height;
      if (concept) {
        const drift = Math.abs(aspect - conceptAspect) / conceptAspect;
        check(drift <= ASPECT_TOLERANCE, `${label}: plane aspect ${aspect.toFixed(3)} vs concept ${conceptAspect.toFixed(3)} (${(drift * 100).toFixed(1)}% > 4%)`);
      }
      check(m.zones.length > 0, `${label}: no [data-zones] inside the plane`);
      const hidden = m.zones.filter((z: { visible: boolean }) => !z.visible);
      check(hidden.length === 0, `${label}: ${hidden.length} zones are not visible`);
      if (vp.mobile) {
        const narrow = m.zones.filter((z: { width: number; visible: boolean }) => z.visible && z.width < MIN_ZONE_PX);
        check(narrow.length === 0, `${label}: zones under ${MIN_ZONE_PX}px wide: ${narrow.map((z: { key: string; width: number }) => `${z.key}=${z.width.toFixed(1)}`).join(", ")}`);
      }
      check(m.phaseFound, `${label}: phase bar not found (${PHASE_BAR})`);
      check(m.handCount > 0, `${label}: no hand found`);
      check(m.overlap === 0, `${label}: ${m.overlap} hand boxes overlap the phase bar`);
      check(m.scrollW <= m.clientW && m.bodyScrollW <= m.clientW, `${label}: horizontal scroll (${m.scrollW}/${m.bodyScrollW} > ${m.clientW})`);
      check(m.clocks[0] && m.clocks[1], `${label}: duel clock cells missing (opp=${m.clocks[0]}, you=${m.clocks[1]})`);
      check(pageErrors.length === 0, `${label}: page errors: ${pageErrors.join(" | ")}`);
      summary.push({ label, aspect: Number(aspect.toFixed(3)), conceptAspect: Number(conceptAspect.toFixed(3)), zones: m.zones.length, minZoneWidth: Math.min(...m.zones.map((z: { width: number }) => z.width)).toFixed(1) });
      await page.close();
    }
  }

  // The flags: a flat table and reduced motion must also fit.
  for (const flag of ["view=flat", "reduced=1"]) {
    for (const vp of viewports) {
      const page = await openPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
      await page.goto(`${base}/dev/solid-preview?state=m1&${flag}`, { waitUntil: "load" });
      await page.waitForSelector("[data-sv-plane]", { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(shotDir, `${vp.name}-m1-${flag.replace("=", "-")}.png`) });
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(scroll <= 0, `${vp.name}/m1?${flag}: horizontal scroll ${scroll}px`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ out, shots: shotDir, checked: summary }, null, 2));
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("duel-3d-mode e2e: all checks passed");
}
