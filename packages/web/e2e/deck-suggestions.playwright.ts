/**
 * Browser proof for the deck editor Suggestions rows: inline above the card list while the search box is empty.
 *
 * Real parts: the whole deck editor (SavedDeckEditor, bundled from src with vite) and the real card data from
 * cards.cdb. Stand-ins: Discord sign-in, the web API routes (the deck, the card list, the card details and
 * the suggestion service, each answered here from a fixed fixture), next/navigation and card art (cached art
 * when CARD_IMAGE_CACHE_DIR has it, otherwise a labelled placeholder).
 *
 * Run (Node 22, shared built, engine data in data/duel-engine):
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs SUGGESTIONS_ARTIFACTS=/tmp/deck-suggestions \
 *   DUEL_DATA_DIR=/path/to/data/duel-engine CARD_IMAGE_CACHE_DIR=/path/to/data/card-images \
 *     node --import tsx packages/web/e2e/deck-suggestions.playwright.ts
 * Exits 1 when any check fails; screenshots and evidence.json are written either way.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";

const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const e2e = fileURLToPath(new URL(".", import.meta.url));
const web = resolve(e2e, "..");
const repo = resolve(web, "../..");
const out = resolve(process.env.SUGGESTIONS_ARTIFACTS ?? "/tmp/deck-suggestions");
const dataDirectory = resolve(process.env.DUEL_DATA_DIR ?? join(repo, "data/duel-engine"));
const imageCache = process.env.CARD_IMAGE_CACHE_DIR;
const ORIGIN = "http://suggestions.harness";
await mkdir(out, { recursive: true });

// ---- Fixture: a Blue-Eyes style deck and the rows the service would answer -----------------------
const cardDb = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
const byName = cardDb.prepare<[string], { id: number }>("select d.id from datas d join texts t on t.id = d.id where t.name = ? and d.alias = 0");
function id(name: string): number {
  const row = byName.get(name);
  if (!row) throw new Error(`cards.cdb has no card named ${name}`);
  return row.id;
}
const cardRow = cardDb.prepare<[number], Record<string, number | string>>(
  "select d.id as code, d.alias, d.setcode, d.type, d.atk as attack, d.def as defense, d.level, d.race, d.attribute, d.ot, t.name, t.desc as description from datas d join texts t on t.id = d.id where d.id = ?");
function details(code: number) {
  const row = cardRow.get(code);
  if (!row) return null;
  const level = Number(row.level);
  const scales = level >> 16;
  return { code, canonicalPasscode: code, name: row.name, description: row.description, type: row.type, attack: row.attack, defense: row.defense, level: level & 0xffff, attribute: row.attribute, race: "Dragon", alias: 0, setcodes: [], lscale: scales >> 8, rscale: scales & 0xff, arrows: 0, ot: row.ot, altArtCount: 0 };
}

const MAIN_NAMES = ["Blue-Eyes White Dragon", "Sage with Eyes of Blue", "Dragon Spirit of White", "Maxx \"C\"", "Ash Blossom & Joyous Spring", "Effect Veiler",
  "Ghost Ogre & Snow Rabbit", "Terraforming", "The Melody of Awakening Dragon", "Dragon Shrine", "Silver's Cry", "Trade-In", "Monster Reborn",
  "Pot of Desires", "Foolish Burial", "Called by the Grave", "Infinite Impermanence", "Solemn Strike", "Mirror Force", "Lord of D."];
const small = MAIN_NAMES.map(id);
/** 20 cards, then the same 20 plus 20 more copies: over the 40-card line for the Extra Deck row. */
const SMALL_DECK = { main: small, extra: [], side: [] };
const FULL_DECK = { main: [...small, ...small], extra: [id("Blue-Eyes Ultimate Dragon")], side: [] };

const REASONS = {
  jet: "Summons itself from the hand when you control a Blue-Eyes monster, then helps your opponent's board stay empty.",
  alt: "Searched by Sage with Eyes of Blue and fills the Main Deck with another Level 8 Normal-like body.",
  phantom: "A second White Dragon that reuses your Dragon Spirit of White and Silver's Cry lines.",
  burst: "Pairs with Blue-Eyes White Dragon: a one-card board wipe once your dragons are on the field.",
  matched: "Stops a big opposing turn by forcing both players to discard to the same hand size.",
  cyclone: "Clears one Spell or Trap. Cheap, and it fits any deck that wants to remove backrow.",
  nibiru: "Punishes a long chain of Summons by tributing your opponent's board; your own Dragons stay safe.",
  ultimate: "Three Blue-Eyes White Dragon become one 4500 ATK Fusion Monster. Your Main Deck has all three materials.",
  tyrant: "Needs one Blue-Eyes plus one other Dragon; your Main Deck already holds both.",
  twin: "Needs Blue-Eyes White Dragon and one more Dragon; fits the cards you play now.",
  neo: "Needs Blue-Eyes Ultimate Dragon on the field; your Extra Deck already holds it.",
  pot: "Draws two cards for one banished pair of cards; the usual first pick in this format.",
  imperm: "A flexible answer that negates a monster effect or turns off a column of cards.",
  dark: "Destroys every monster on the field when you are losing the board.",
  solemn: "Negates a Summon or an activation, which keeps your Dragons safe from a combo.",
};
const ROW_FIXTURE = (mainCards: number) => [
  { id: "archetype", state: "ready", cards: [["Blue-Eyes Jet Dragon", REASONS.jet], ["Blue-Eyes Alternative White Dragon", REASONS.alt], ["Blue-Eyes White Dragon, the White Phantom Beast", REASONS.phantom]] },
  { id: "outside", state: "ready", cards: [["Burst Stream of Destruction", REASONS.burst], ["Evenly Matched", REASONS.matched], ["Cosmic Cyclone", REASONS.cyclone], ["Nibiru, the Primal Being", REASONS.nibiru]] },
  mainCards >= 40
    ? { id: "extra", state: "ready", cards: [["Blue-Eyes Twin Burst Dragon", REASONS.twin], ["Blue-Eyes Tyrant Dragon", REASONS.tyrant], ["Neo Blue-Eyes Ultimate Dragon", REASONS.neo], ["Blue-Eyes Alternative Ultimate Dragon", REASONS.ultimate]] }
    : { id: "extra", state: "hint", minimumMainCards: 40, mainCards, hint: "Add 40 Main Deck cards to see what your deck can make", cards: [] },
  { id: "staples", state: "ready", cards: [["Pot of Prosperity", REASONS.pot], ["Infinite Impermanence", REASONS.imperm], ["Dark Hole", REASONS.dark], ["Solemn Judgment", REASONS.solemn], ["Pot of Extravagance", REASONS.pot], ["Mirror Force", REASONS.solemn]] },
].map((row) => ({ ...row, cards: row.cards.map(([name, reason]) => ({ passcode: id(name as string), reason, score: 1, linkedCards: 2 })) }));

/** Limited, Semi-Limited and Forbidden marks, on every list id. */
const LIMITS: Record<number, 0 | 1 | 2> = { [id("Pot of Extravagance")]: 0, [id("Dark Hole")]: 1, [id("Infinite Impermanence")]: 2, [id("Maxx \"C\"")]: 2 };
const FACETS = { archetypes: [], banlists: Object.fromEntries(DUEL_BANLIST_OPTIONS.map((option) => [option.id, LIMITS])) };

// ---- Request log and answer control ---------------------------------------------------------------
const insightRequests: { deck: { main: number[] }; at: number }[] = [];
const control = { delayMs: 0, deck: "small" as "small" | "full" | "empty" };
const json = (status: number, data: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(data) });

function cardImage(code: string) {
  const cached = imageCache ? join(imageCache, `${code}-small.jpg`) : null;
  if (cached && existsSync(cached)) return { status: 200, contentType: "image/jpeg", body: readFileSync(cached) };
  const name = String(cardRow.get(Number(code))?.name ?? code).replace(/[<&>]/g, "").slice(0, 22);
  return { status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="246"><rect width="168" height="246" rx="6" fill="#3b3352"/><rect x="10" y="10" width="148" height="226" rx="4" fill="none" stroke="#c9a24a" stroke-width="2"/><text x="84" y="128" fill="#efe7d5" text-anchor="middle" font-family="Arial" font-size="18">${name}</text></svg>` };
}

async function api(method: string, url: URL, body: any) {
  const path = url.pathname;
  if (path === "/api/decks/1" && method === "GET") {
    const deck = control.deck === "full" ? FULL_DECK : control.deck === "empty" ? { main: [], extra: [], side: [] } : SMALL_DECK;
    return json(200, { deck: { id: 1, name: "Blue-Eyes", mode: "normal", genesys: null, deck, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" } });
  }
  if (path === "/api/decks/cards/facets") return json(200, FACETS);
  if (path === "/api/decks/cards" && method === "POST") {
    const text = String(body?.text ?? "").toLowerCase();
    const rows = cardDb.prepare<[string], { id: number }>("select d.id from datas d join texts t on t.id = d.id where d.alias = 0 and lower(t.name) like ? order by t.name limit 40").all(`%${text}%`);
    return json(200, { cards: rows.map((row) => details(row.id)).filter(Boolean), total: rows.length, offset: 0 });
  }
  if (path === "/api/duels/cards" && method === "POST") {
    const codes: number[] = body.codes ?? [];
    const cards = codes.map(details).filter(Boolean);
    return json(200, { cards, missing: codes.filter((code) => !details(code)) });
  }
  if (path === "/api/cards/insights" && method === "POST") {
    if (body.op === "suggestRows") {
      insightRequests.push({ deck: body.deck, at: Date.now() });
      if (control.delayMs) await new Promise((done) => setTimeout(done, control.delayMs));
      return json(200, { rows: ROW_FIXTURE(body.deck.main.length), version: 1 });
    }
    return json(200, { effectSearchEnabled: true, summary: null });
  }
  return json(404, { error: `harness: no route ${method} ${path}` });
}

// ---- Bundle the real editor for the browser -----------------------------------------------------------
const bundle = resolve(out, "bundle");
await build({
  configFile: false, root: e2e, logLevel: "warn", cacheDir: resolve(out, ".vite"), base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  css: { postcss: { plugins: [tailwindcss({ base: web })] } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(web, "src")}/` },
      { find: /^next\/navigation$/, replacement: resolve(e2e, "deck-suggestions-next.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: bundle, emptyOutDir: true, rollupOptions: { input: resolve(e2e, "deck-suggestions-browser.tsx"), output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" } } },
  plugins: [{
    name: "suggestions-next-stubs", enforce: "pre",
    resolveId(source: string) {
      if (source === "next/font/google" || source === "next/font/local") return "\0fonts";
      if (source === "next/link") return "\0link";
      if (source === "next/image") return "\0image";
    },
    load(source: string) {
      if (source === "\0fonts") return `const font = () => ({ className: "", variable: "", style: {} }); export { font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed }; export default font;`;
      if (source === "\0link") return `import { createElement } from "react"; export default function Link({ href, prefetch, ...rest }) { return createElement("a", { href: String(href), ...rest }); }`;
      if (source === "\0image") return `import { createElement } from "react"; export default function Image({ src, alt, fill, priority, unoptimized, ...rest }) { return createElement("img", { src: String(src), alt, ...rest }); }`;
    },
  }, react()],
});
await writeFile(resolve(bundle, "index.html"), `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deck suggestions proof</title><link rel="stylesheet" href="./browser.css">
  <style>body{margin:0;min-height:100vh;background:#0A0E1A;color:#E8ECF4;font-family:Arial,sans-serif} .harness-rail{width:0}@media (min-width:820px){.harness-rail{width:236px;flex:none;background:#0d0f15;border-right:1px solid #232634}}</style></head>
  <body><div id="root"></div><script type="module" src="./browser.js"></script></body></html>`);

// ---- The scripted scenario ------------------------------------------------------------------------
type Check = { step: string; check: string; ok: boolean; detail: string };
const checks: Check[] = [];
const shots: Record<string, string> = {};
function check(step: string, name: string, ok: boolean, detail: unknown = "") {
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  checks.push({ step, check: name, ok, detail: text });
  console.log(`${ok ? "PASS" : "FAIL"} [${step}] ${name}${text === "" ? "" : ` (${text})`}`);
}

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 }, { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1366x768", width: 1366, height: 768 }, { name: "390x844", width: 390, height: 844 },
];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pageErrors: string[] = [];
const unrouted: string[] = [];
let exitCode = 0;
try {
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  await page.route(`${ORIGIN}/**`, async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    const image = /^\/api\/cards\/(\d+)\/image$/.exec(url.pathname);
    if (image) return route.fulfill(cardImage(image[1]!));
    if (url.pathname.startsWith("/api/")) {
      const raw = request.postData();
      const response = await api(request.method(), url, raw ? JSON.parse(raw) : null);
      if (response.status === 404) unrouted.push(`${request.method()} ${url.pathname}`);
      return route.fulfill(response);
    }
    const publicDir = resolve(web, "public");
    let file = resolve(bundle, `.${url.pathname}`);
    if (!file.startsWith(bundle) || !existsSync(file)) file = resolve(publicDir, `.${url.pathname}`);
    if ((!file.startsWith(publicDir) && !file.startsWith(bundle)) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });

  const panel = page.getByTestId("deck-suggestions");
  const search = () => page.getByRole("searchbox").or(page.locator('input[type="search"]')).first();
  const shot = async (name: string) => {
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file });
    shots[name] = file;
  };
  const open = async (deck: "small" | "full" | "empty", flag = "on") => {
    control.deck = deck;
    insightRequests.length = 0;
    await page.goto(`${ORIGIN}/index.html?deck=1&flag=${flag}`);
  };
  // Positions are relative to the panel, so a scroll of the list (hover scrolls a tile into view) is not a move.
  const tileBoxes = () => panel.evaluate((root: HTMLElement) => { const base = root.getBoundingClientRect(); return [...root.querySelectorAll("button")].map((node) => { const box = node.getBoundingClientRect(); return [Math.round(box.x - base.x), Math.round(box.y - base.y), Math.round(box.width), Math.round(box.height)]; }); });
  const rowTitles = () => panel.locator("h3").allTextContents();

  // a. A small deck: three ready rows, the Extra row as a hint.
  await open("small");
  await panel.locator("button").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
  check("a", "Suggestions show while the search box is empty", await panel.isVisible());
  check("a", "rows are in the owner's order", JSON.stringify(await rowTitles()) === JSON.stringify(["Archetype support", "Outside the archetype", "Extra Deck you can make", "Staples for this format"]), await rowTitles());
  check("a", "the Extra row shows its hint under 40 Main cards", (await panel.getByText("Add 40 Main Deck cards to see what your deck can make").count()) === 1);
  check("a", "Staples show at most 6 cards", (await panel.locator('section[aria-labelledby="suggest-staples"] button').count()) <= 6);
  const text = (await page.locator("body").innerText()).toLowerCase();
  check("a", "no AI or searchygo text on the page", !/\bai\b|searchygo/.test(text));
  check("a", "the first answer took one request", insightRequests.length === 1, insightRequests.length);
  const whyHeights = await panel.locator("button span[class*=why]").evaluateAll((nodes: HTMLElement[]) => [...new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().height)))]);
  check("a", "every reason has the same fixed height", whyHeights.length === 1, whyHeights);
  // A very long reason is clamped to the same box and does not grow the tile.
  const clamp = await panel.locator("button span[class*=why]").first().evaluate((node: HTMLElement) => {
    const card = node.closest("button") as HTMLElement; const before = [card.getBoundingClientRect().height, node.getBoundingClientRect().height];
    const text = node.textContent; node.textContent = "A very long reason that goes on and on about what this card does for the deck. ".repeat(8);
    const after = [card.getBoundingClientRect().height, node.getBoundingClientRect().height, node.scrollHeight - node.clientHeight];
    node.textContent = text; return { before, after };
  });
  check("a", "a long reason is clamped, not grown", clamp.after[2] > 0 && clamp.before[0] === clamp.after[0] && clamp.before[1] === clamp.after[1], clamp);
  const badges = await panel.locator("span[class*=de-lim]").count();
  const badgeOverlap = await panel.locator("button").evaluateAll((nodes: HTMLElement[]) => nodes.filter((node) => {
    const badge = node.querySelector("[class*=de-lim]") as HTMLElement | null;
    const have = node.querySelector("[class*=have]") as HTMLElement | null;
    const name = node.querySelector("[class*=name]") as HTMLElement | null;
    if (!badge) return false;
    const a = badge.getBoundingClientRect();
    return [have, name].some((other) => { if (!other) return false; const b = other.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
  }).length);
  check("a", "ban marks show and do not cover the name or count", badges > 0 && badgeOverlap === 0, { badges, badgeOverlap });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await shot(`small-${viewport.name}`);
    check("a", `no sideways page scroll at ${viewport.name}`, noScroll);
    // Whole cards only: every card sits inside the panel, and no list scrolls sideways.
    const clipped = await panel.evaluate((root: HTMLElement) => {
      const box = root.getBoundingClientRect();
      const cards = [...root.querySelectorAll("li > button")] as HTMLElement[];
      const outside = cards.filter((node) => { const r = node.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length;
      const scrolling = [...root.querySelectorAll("ul")].filter((list) => list.scrollWidth > list.clientWidth + 1).length;
      const textCut = cards.filter((node) => { const name = node.querySelector("[class*=name]") as HTMLElement | null; const r = node.getBoundingClientRect(); return name ? name.getBoundingClientRect().right > r.right + 0.5 : false; }).length;
      return { outside, scrolling, textCut, cards: cards.length };
    });
    check("a", `every card is whole inside the panel at ${viewport.name}`, clipped.outside === 0 && clipped.scrolling === 0 && clipped.textCut === 0 && clipped.cards > 0, clipped);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  // a2. A row shows 4 cards; "Show more (N)" opens the rest and "Show less" closes them.
  const stapleCount = () => panel.locator('section[aria-labelledby="suggest-staples"] li > button').count();
  check("a2", "a long row shows 4 cards by default", (await stapleCount()) === 4, await stapleCount());
  const more = panel.locator('section[aria-labelledby="suggest-staples"] button[aria-expanded]');
  check("a2", "the row offers Show more with the hidden count", (await more.innerText()).trim() === "Show more (2)", await more.innerText());
  check("a2", "a row of 4 or less has no Show more", (await panel.locator('section[aria-labelledby="suggest-archetype"] button[aria-expanded]').count()) === 0);
  await more.click();
  check("a2", "Show more opens the rest of the row", (await stapleCount()) === 6, await stapleCount());
  await shot("show-more-open");
  check("a2", "the opened row stays whole inside the panel", await panel.evaluate((root: HTMLElement) => { const box = root.getBoundingClientRect(); return [...root.querySelectorAll("li > button")].every((node) => { const r = node.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; }); }));
  await more.click();
  check("a2", "Show less closes the row again", (await stapleCount()) === 4, await stapleCount());

  // b. Hover moves nothing.
  await page.waitForTimeout(800);
  const before = await tileBoxes();
  await panel.locator("button").nth(0).hover();
  await panel.locator("button").nth(1).hover();
  await page.waitForTimeout(250);
  const afterHover = await tileBoxes();
  check("b", "hover leaves every tile where it was", JSON.stringify(before) === JSON.stringify(afterHover), before.map((box: number[], i: number) => JSON.stringify(box) === JSON.stringify(afterHover[i]) ? null : [i, box, afterHover[i]]).filter(Boolean).slice(0, 3));

  // c. A tile inspects on click, adds on double-click and right-click, and drags into the deck.
  const mainCount = async () => Number(/Main\s+(\d+)/.exec(await page.locator('main[aria-label="Deck"]').innerText())?.[1] ?? -1);
  const tile = panel.locator('section[aria-labelledby="suggest-outside"] button').first();
  await tile.click();
  await page.waitForTimeout(300);
  check("c", "click inspects the card (pressed)", (await tile.getAttribute("aria-pressed")) === "true");
  check("c", "the card view names the card", (await page.locator('aside[aria-label="Card details"]').innerText()).includes("Burst Stream of Destruction"));
  await shot("c-inspect");
  const start = await mainCount();
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(1).dblclick();
  await page.waitForTimeout(200);
  check("c", "double-click adds the card to the Main Deck", (await mainCount()) === start + 1, { start, now: await mainCount() });
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(0).click({ button: "right" });
  await page.waitForTimeout(200);
  check("c", "right-click adds the card to the Main Deck", (await mainCount()) === start + 2, { start, now: await mainCount() });
  await panel.locator('section[aria-labelledby="suggest-outside"] button').nth(0).dragTo(page.locator('main[aria-label="Deck"] section').first());
  await page.waitForTimeout(200);
  check("c", "dragging a tile into the deck adds the card", (await mainCount()) === start + 3, { start, now: await mainCount() });

  // c2. Three quick changes make one request, after the 600 ms wait.
  await page.waitForTimeout(1500);
  const settled = insightRequests.length;
  for (const index of [0, 1, 2]) await panel.locator('section[aria-labelledby="suggest-staples"] button').nth(index).dblclick();
  await page.waitForTimeout(300);
  check("c2", "no request while the changes are still fresh", insightRequests.length === settled, insightRequests.length - settled);
  await page.waitForTimeout(1500);
  check("c2", "three quick changes ask once", insightRequests.length === settled + 1, insightRequests.length - settled);
  check("c2", "the deck in that request has all the changes", insightRequests.at(-1)?.deck.main.length === (await mainCount()), insightRequests.at(-1)?.deck.main.length);

  // c3. A slow answer: the old rows stay and nothing moves.
  control.delayMs = 2500;
  const shown = await tileBoxes();
  await panel.locator('section[aria-labelledby="suggest-staples"] button').nth(3).dblclick();
  await page.waitForTimeout(1300);
  check("c3", "the status says Updating while the answer is slow", (await panel.getByText("Updating…").count()) === 1);
  check("c3", "the old rows stay on screen while loading", (await tileBoxes()).length === shown.length && (await panel.locator("button").count()) > 0);
  check("c3", "no tile moved while loading", JSON.stringify(shown) === JSON.stringify(await tileBoxes()));
  await shot("c3-updating");
  await page.waitForTimeout(2500);
  check("c3", "the status clears when the answer lands", (await panel.getByText("Updating…").count()) === 0);
  control.delayMs = 0;

  // d. Typing hides Suggestions; clearing brings them back with no new request.
  const requestsBefore = insightRequests.length;
  await search().fill("dragon");
  await page.waitForTimeout(400);
  check("d", "typing a search hides Suggestions", (await panel.count()) === 0);
  await shot("d-search");
  await search().fill("");
  await panel.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(900);
  check("d", "clearing the search brings Suggestions back", await panel.isVisible() && (await panel.locator("button").count()) > 0);
  check("d", "the same deck is not asked for again", insightRequests.length === requestsBefore, insightRequests.length - requestsBefore);

  // e. Flag off: no panel.
  await open("small", "off");
  await page.waitForTimeout(1500);
  check("e", "Suggestions are off when the server flag is off", (await panel.count()) === 0 && insightRequests.length === 0, insightRequests.length);

  // f. A deck with 40 Main cards gets the Extra row as cards.
  await open("full");
  await panel.locator("button").first().waitFor({ state: "visible", timeout: 15_000 });
  check("f", "the Extra row shows cards at 40 Main cards", (await panel.locator('section[aria-labelledby="suggest-extra"] button').count()) === 4 && (await panel.getByText("Add 40 Main Deck cards").count()) === 0);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(250);
    await shot(`full-${viewport.name}`);
  }
  // The phone layout keeps the card list on its own tab.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Cards" }).click();
  await panel.locator("button").first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
  await shot("full-390x844-cards-tab");
  check("f", "the phone Cards tab shows Suggestions without sideways page scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1920, height: 1080 });

  // g. An empty deck: a short empty state, and no request.
  await open("empty");
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1200);
  check("g", "an empty deck shows the empty state", (await panel.innerText()).includes("Add a few Main Deck cards"));
  check("g", "an empty deck makes no request", insightRequests.length === 0, insightRequests.length);
  await shot("g-empty-deck");

  check("all", "no browser errors", pageErrors.length === 0, pageErrors);
  check("all", "every API call the editor made is mirrored", unrouted.length === 0, [...new Set(unrouted)]);
} catch (error) {
  console.error(error);
  check("harness", browser ? "browser scenario completed" : "Chromium launched", false, error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await browser?.close();
  cardDb.close();
}
await writeFile(resolve(out, "evidence.json"), JSON.stringify({ checks, screenshots: shots }, null, 2));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed. Screenshots: ${out}`);
process.exit(exitCode || (failed.length > 0 ? 1 : 0));
