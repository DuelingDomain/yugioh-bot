import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { createTable, enterDuelRoom, importDeckUploadAndReady, uniqueTableName } from "../helpers/duel";
import { expectReadyToAct, handCard, pickLegalZone, useCard, yourHand } from "../helpers/board";
import { cardCode } from "../helpers/cards";
import { withFiller, ydkUpload } from "../helpers/decks";

const DECK_MASTER = "Celtic Guardian";

for (const mode of ["classic", "3d"] as const) {
  test(`${mode}: Inspect in the Deck Master pop-over opens the card drawer`, async ({ player }) => {
    const { page } = await player("p5");
    await startBotDuel(page);
    const url = new URL(page.url());
    url.searchParams.set("view", mode);
    await page.goto(url.toString());
    await expectReadyToAct(page);
    await page.locator('[data-testid="dm-badge-wrap"][data-local="true"]').getByTestId("dm-badge").click();
    await page.getByTestId("dm-badge-inspect").click();
    await expect(page.getByTestId("dm-badge-pop")).toHaveCount(0);
    const drawer = page.getByRole("dialog", { name: mode === "3d" ? "Card · Log" : "Card", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(DECK_MASTER);
    await expect(drawer.locator('img[src$="/image"]')).toBeVisible();
    expect((await page.request.post(`/api/duels/${url.pathname.split("/").at(-1)}/surrender`)).ok()).toBe(true);
  });
}

test("the Deck Master keyboard shortcut moves focus into the pop-over", async ({ player }) => {
  const { page } = await player("p5");
  await startBotDuel(page);
  await page.keyboard.press("m");
  const pop = page.getByTestId("dm-badge-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator("button:focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  expect((await page.request.post(`/api/duels/${new URL(page.url()).pathname.split("/").at(-1)}/surrender`)).ok()).toBe(true);
});

type Sample = { x: number; y: number; w: number; h: number; opacity: number };

/** Records, every frame, the box of each flying ghost that shows the Deck Master art (summon and return flights). */
async function recordFlights(page: Page, code: number): Promise<void> {
  await page.addInitScript((masterCode) => {
    const samples: Sample[] = [];
    (window as unknown as { __dmFlights: Sample[] }).__dmFlights = samples;
    const tick = () => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[class*="ghost"]'))) {
        const img = el.querySelector("img");
        if (!img || !img.src.includes(String(masterCode))) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 4) continue;
        const opacity = Number(getComputedStyle(el).opacity);
        if (opacity <= 0.01) continue;
        if (samples.length < 4000) samples.push({ x: box.left + box.width / 2, y: box.top + box.height / 2, w: box.width, h: box.height, opacity });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, code);
}

const readFlights = (page: Page): Promise<Sample[]> => page.evaluate(() => (window as unknown as { __dmFlights: Sample[] }).__dmFlights.slice());
/** The samples of a flight, read once no new sample has come for 600 ms (the flight is over). */
async function flights(page: Page): Promise<Sample[]> {
  let last = -1;
  let quiet = 0;
  for (let i = 0; i < 60 && quiet < 3; i += 1) {
    const count = (await readFlights(page)).length;
    quiet = count === last && count > 0 ? quiet + 1 : 0;
    last = count;
    await page.waitForTimeout(200);
  }
  return readFlights(page);
}
const clearFlights = (page: Page): Promise<void> => page.evaluate(() => { (window as unknown as { __dmFlights: Sample[] }).__dmFlights.length = 0; });
const centerOf = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The table: a Domain duel against the practice bot, your Deck Master Celtic Guardian, Dark Hole in the deck. */
async function startBotDuel(page: Page): Promise<void> {
  const table = uniqueTableName("dm badge");
  await createTable(page, table, { domain: true, ordered: true, looseDecks: true, noBanlist: true });
  await page.getByRole("button", { name: "Add practice bot" }).click();
  const deck = { main: withFiller(["Dark Hole"], 14), deckMaster: DECK_MASTER };
  await importDeckUploadAndReady(page, ydkUpload(deck), deck.main.length);
  const start = page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();
  await enterDuelRoom(page);
  await expectReadyToAct(page);
}

/** What a press landed on, by the part of the table it belongs to. Recorded in the capture phase, so no handler can hide it. */
async function recordPresses(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __dmPresses: string[] }).__dmPresses = log;
    const name = (node: EventTarget | null): string => {
      const el = node instanceof Element ? node : null;
      if (!el) return "none";
      if (el.closest('[data-testid="dm-badge-shield"]')) return "shield";
      if (el.closest('[data-testid="dm-badge-pop"]')) return "pop";
      if (el.closest('[data-testid="dm-badge-wrap"]')) return "emblem";
      const zone = el.closest<HTMLElement>("[data-kind]");
      if (el.closest("[data-hand-card]")) return "hand";
      if (zone) return `zone:${zone.dataset.kind}`;
      return "other";
    };
    for (const type of ["pointerdown", "mousedown", "click"]) {
      document.addEventListener(type, (event) => { log.push(`${type}:${name(event.target)}`); }, true);
    }
  });
}
const presses = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __dmPresses: string[] }).__dmPresses.slice());
const clearPresses = (page: Page): Promise<void> => page.evaluate(() => { (window as unknown as { __dmPresses: string[] }).__dmPresses.length = 0; });

// Domain duel against the practice bot: your Deck Master emblem stands left of your hand, glows when the master can act, opens
// its pop-over on the first click, and the summon flies out of the emblem and the recall flies back into it.
test("the Deck Master emblem opens on one click, summons from the pop-over, and the master flies out and back", async ({ player }) => {
  const host = await player("p5");
  const page = host.page;
  await recordFlights(page, cardCode(DECK_MASTER));
  await recordPresses(page);
  // The e2e config reduces motion; this test needs the flights.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await startBotDuel(page);

  const mine = page.locator('[data-testid="dm-badge-wrap"][data-local="true"]');
  const rival = page.locator('[data-testid="dm-badge-wrap"][data-local="false"]');
  const badge = mine.getByTestId("dm-badge");
  const pop = page.getByTestId("dm-badge-pop");

  // At rest: both badges show, yours is ready and glows, the rival's is info only. Nothing is open.
  await expect(badge).toBeVisible();
  await expect(rival.getByTestId("dm-badge")).toBeVisible();
  await expect(mine).toHaveAttribute("data-ready", "true");
  await expect(mine.getByTestId("dm-badge-ready")).toBeVisible();
  await expect(rival).not.toHaveAttribute("data-ready", "true");
  await expect(mine.getByTestId("dm-badge-state")).toHaveText("In zone");
  expect(await badge.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe("none");
  await expect(pop).toHaveCount(0);

  // Your emblem is a large portrait with the whole card (not a round crop), left of your hand, and it covers no zone of the field.
  const art = mine.locator("[data-master-dock]");
  const emblem = (await mine.boundingBox())!;
  expect(emblem.width, "the emblem is large").toBeGreaterThanOrEqual(48);
  expect(emblem.height, "the emblem is tall").toBeGreaterThanOrEqual(70);
  expect(Math.abs(emblem.width / emblem.height - 59 / 86), "the emblem keeps the card shape").toBeLessThan(0.08);
  await expect(mine).toHaveAttribute("data-emblem", "docked");
  const picture = art.locator("img");
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth), "the art loaded").toBeGreaterThan(0);
  expect(await picture.evaluate((img) => getComputedStyle(img).objectFit), "the art fills the emblem").toBe("cover");
  expect(await art.evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius)), "the art is not a circle crop").toBeLessThan(12);
  const firstCard = (await yourHand(page).locator("button").first().boundingBox())!;
  expect(emblem.x + emblem.width, "the emblem stands left of the hand").toBeLessThanOrEqual(firstCard.x);
  const covered = await page.evaluate((box) => {
    const hit: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-zones][data-kind]"))) {
      if (el.dataset.kind === "hand" || el.closest("[data-hand-card]")) continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, box.x + box.width) - Math.max(r.left, box.x);
      const h = Math.min(r.bottom, box.y + box.height) - Math.max(r.top, box.y);
      if (w > 1 && h > 1) hit.push(`${el.dataset.kind}:${el.dataset.zones}`);
    }
    return hit;
  }, emblem);
  expect(covered, "the emblem covers no field zone at rest").toEqual([]);

  // A press on the emblem, inside the pop-over, and outside it (which only closes it) never reaches a hand card or a zone.
  await clearPresses(page);
  await badge.click();
  await expect(pop).toBeVisible();
  await pop.getByTestId("dm-badge-name").click();
  await expect(pop).toBeVisible();
  const aimAt = async (selector: string): Promise<{ x: number; y: number }> => {
    const point = await page.evaluate((sel) => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (r.width < 8 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        // Under the shield only: a point the pop-over itself covers would test nothing.
        if (document.elementFromPoint(x, y)?.closest('[data-testid="dm-badge-shield"]')) return { x, y };
      }
      return null;
    }, selector);
    expect(point, `a point of ${selector} that the pop-over does not cover`).not.toBeNull();
    return point!;
  };
  const overHand = await aimAt("[data-hand-seat][data-side='you'] [data-hand-card]");
  await page.mouse.click(overHand.x, overHand.y);
  await expect(pop).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await badge.click();
  await expect(pop).toBeVisible();
  const overZone = await aimAt("[data-kind='mz'][data-side='you'], [data-kind='st'][data-side='you']");
  await page.mouse.click(overZone.x, overZone.y);
  await expect(pop).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  const log = await presses(page);
  expect(log.length, "the presses were recorded").toBeGreaterThan(6);
  expect(log.filter((entry) => /:(hand|zone:|other)/.test(entry)), "no hand card, zone or background got a press").toEqual([]);
  expect(log.filter((entry) => entry.endsWith(":shield")).length, "the outside presses stopped at the shield").toBeGreaterThanOrEqual(4);

  // One click opens the pop-over, with the card, the place, the cost and all three buttons. Esc closes it.
  await badge.click();
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId("dm-badge-name")).toHaveText(DECK_MASTER);
  await expect(pop.getByTestId("dm-badge-stats")).toContainText("ATK");
  await expect(pop.getByTestId("dm-badge-where")).toHaveText("In the Deck Master Zone");
  await expect(pop.getByTestId("dm-badge-cost")).toHaveText("Next summon: Free");
  await expect(pop.getByTestId("dm-badge-summon")).toBeEnabled();
  await expect(pop.getByTestId("dm-badge-set")).toBeVisible();
  await expect(pop.getByTestId("dm-badge-inspect")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);

  // The rival's pop-over is info only.
  await rival.getByTestId("dm-badge").click();
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId("dm-badge-summon")).toHaveCount(0);
  await expect(pop.getByTestId("dm-badge-inspect")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);

  // Summon from the pop-over. The card flies out of the badge to a monster zone.
  const dock = mine.locator("[data-master-dock]");
  const badgeCenter = centerOf((await dock.boundingBox())!);
  const badgeSize = (await dock.boundingBox())!.width;
  await clearFlights(page);
  await badge.click();
  await pop.getByTestId("dm-badge-summon").click();
  await pickLegalZone(page, "mz");
  const zone = page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]');
  await expect(zone).toHaveCount(1);
  await expect(mine.getByTestId("dm-badge-state")).toHaveText("On field");
  const out = await flights(page);
  expect(out.length, "the summon flight was seen").toBeGreaterThan(2);
  expect(gap(out[0], badgeCenter), "the flight starts at the badge").toBeLessThan(badgeSize);
  const zoneCenter = centerOf((await zone.boundingBox())!);
  expect(gap(out[out.length - 1], zoneCenter), "the flight ends on the zone").toBeLessThan(badgeSize * 2);

  // Destroy it with Dark Hole, recall it: the card flies back into the badge.
  await useCard(page, handCard(page, "Dark Hole"), "Activate");
  await pickLegalZone(page, "st");
  const recall = page.getByRole("group", { name: /Deck Master/i });
  await expect(recall).toBeVisible();
  await badge.click();
  await expect(pop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(recall, "closing the pop-over must keep the pending recall").toBeVisible();
  await clearFlights(page);
  await recall.getByRole("button", { name: /^Yes/ }).click();
  await expect(mine.getByTestId("dm-badge-state")).toHaveText("In zone");
  await expect(zone).toHaveCount(0);
  const back = await flights(page);
  expect(back.length, "the return flight was seen").toBeGreaterThan(2);
  const home = centerOf((await dock.boundingBox())!);
  expect(gap(back[back.length - 1], home), "the flight ends in the badge").toBeLessThan(badgeSize);
});

// Hand cards overlap the Spell/Trap row above them (and a hovered card grows over it). A press on the visible part of a hand card
// selects that card; a press on the visible part of a zone selects that zone. Checked with real hit-testing, at rest and while hovered.
test("the visible edge of a hand card and of the Spell/Trap zone above it each take the press", async ({ player }) => {
  const host = await player("p5");
  const page = host.page;
  await startBotDuel(page);

  type Probe = { what: string; x: number; y: number; want: string; got: string };
  const probe = (): Promise<Probe[]> => page.evaluate(() => {
    const out: Array<{ what: string; x: number; y: number; want: string; got: string }> = [];
    const key = (el: Element | null): string => {
      const card = el?.closest<HTMLElement>("[data-hand-card]");
      if (card) return `hand:${card.dataset.handId ?? card.querySelector<HTMLElement>("[data-zones]")?.dataset.zones}`;
      const zone = el?.closest<HTMLElement>("[data-kind]");
      return zone ? `${zone.dataset.kind}:${zone.dataset.zones}` : "other";
    };
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-hand-seat][data-side='you'] [data-hand-card]"));
    const zones = Array.from(document.querySelectorAll<HTMLElement>("[data-kind='st'][data-side='you'], [data-kind='mz'][data-side='you']"));
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      // A usable card rests a little above its box: the visible top is the picture's top (a hover-grown picture does not count: it takes no press).
      const pic = card.querySelector<HTMLElement>("[data-card-frame]")?.getBoundingClientRect();
      const grown = !!pic && pic.height >= box.height * 1.2;
      const r = { left: box.left, width: box.width, top: pic && !grown ? Math.min(box.top, pic.top) : box.top };
      if (r.width < 8 || r.top > innerHeight - 6) continue;
      const cx = r.left + r.width / 2;
      const want = key(card);
      // The top edge of the visible card, then the strip above it where the zone above shows.
      const y = Math.max(r.top + 4, 0);
      out.push({ what: "top edge of the hand card", x: cx, y, want, got: key(document.elementFromPoint(cx, y)) });
      // A hover-grown card covers the row above on purpose: the zone strip is only checked for cards at their resting size.
      for (const zone of grown ? [] : zones) {
        const z = zone.getBoundingClientRect();
        if (z.width < 8 || cx < z.left + 2 || cx > z.right - 2 || z.bottom < r.top - 2 || z.top > r.top) continue;
        const zy = Math.min(z.bottom - 3, r.top - 3);
        if (zy <= z.top) continue;
        out.push({ what: `zone ${zone.dataset.kind} above the hand card, just over its top edge`, x: cx, y: zy, want: key(zone), got: key(document.elementFromPoint(cx, zy)) });
      }
    }
    return out;
  });
  const bad = (rows: Probe[]) => rows.filter((row) => row.want !== row.got).map((row) => `${row.what} at ${Math.round(row.x)},${Math.round(row.y)}: wanted ${row.want}, got ${row.got}`);

  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  const rest = await probe();
  expect(rest.length, "the hand has cards to probe").toBeGreaterThan(2);
  expect(bad(rest), "at rest").toEqual([]);

  // Each card hovered in turn: it grows over the row above, and the edge of the card and of the zone must still take their own press.
  const cards = yourHand(page).locator("[data-hand-card]");
  const count = await cards.count();
  for (let i = 0; i < count; i += 1) {
    await cards.nth(i).hover({ position: { x: 20, y: 40 } });
    await page.waitForTimeout(350);
    expect(bad(await probe()), `card ${i + 1} of ${count} hovered`).toEqual([]);
  }
});
