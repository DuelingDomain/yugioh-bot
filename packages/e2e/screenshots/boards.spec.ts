import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { expectReadyToAct, handCard, pickLegalZone, startDuel, startTable, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { shotDir } from "./shot";

// Marketing screenshots of live boards. Seeded test players and practice bots only; the stack serves stub card art.
const DECK_MASTER = "Celtic Guardian";
// The opening hand is the first five cards (the deck is not shuffled): one monster to summon, then the show cards.
const MAIN = [FILLER, "Dark Magician", "Blue-Eyes White Dragon", "Mirror Force", "Mystical Space Typhoon"];
const bots = { ordered: true, looseDecks: true, bots: [1, 2, 3] };

/** Normal Summon the first card of the hand, so the board shows a monster, then move the pointer off the cards. */
async function summon(page: Page, own = '[data-kind="mz"][data-side="you"][data-occupied="true"]') {
  await useCard(page, handCard(page, FILLER), "Normal Summon");
  await pickLegalZone(page, "mz");
  await expect(page.locator(own)).toHaveCount(1);
  await tidy(page);
}

/** Close the card drawer and the summon toast, and move the pointer off the cards, so the shot shows the board. */
async function tidy(page: Page) {
  await page.waitForTimeout(1500);
  const close = page.getByRole("button", { name: /^close/i });
  if (await close.first().isVisible().catch(() => false)) await close.first().click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2500);
}

/** The first page after a cold start can render without the multi-seat table types. Reload until the creator offers them. */
async function creatorReady(page: Page) {
  await expect(async () => {
    await page.goto("/duels/new");
    await expect(page.getByLabel("Table type")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

/** End the table, so the next test starts from a clean lobby. */
const leave = (page: Page, slug: string) => page.request.post(`/api/duels/${slug}/surrender`);

test("4-player free-for-all board", async ({ player }) => {
  const alice = await player("p1");
  await alice.page.setViewportSize({ width: 1920, height: 1080 });
  await creatorReady(alice.page);
  const { slug } = await startTable([alice], "Friday FFA", [{ main: withFiller(MAIN, 40) }], { ...bots, format: "ffa4" });
  await expect(alice.page.locator("[data-table-stage='ffa4'] [data-seat-field]")).toHaveCount(4);
  await expectReadyToAct(alice.page);
  await summon(alice.page, '[data-seat-field][data-side="you"] [data-kind="mz"][data-occupied="true"]');
  await alice.page.screenshot({ path: shotDir("ffa4.png") });
  await leave(alice.page, slug);
});

test("2v2 Tag board", async ({ player }) => {
  const alice = await player("p1");
  await alice.page.setViewportSize({ width: 1920, height: 1080 });
  const { slug } = await startTable([alice], "Friday Tag", [{ main: withFiller(MAIN, 40) }], { ...bots, format: "tag" });
  await expect(alice.page.locator("[data-table-stage='tag'] [data-seat-field]")).toHaveCount(4);
  await expectReadyToAct(alice.page);
  await summon(alice.page);
  await alice.page.screenshot({ path: shotDir("tag.png") });
  await leave(alice.page, slug);
});

test("Domain Format board with the Deck Master zone", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await alice.page.setViewportSize({ width: 1920, height: 1080 });
  const { slug } = await startDuel(alice, bob, "Domain", { main: withFiller(MAIN, 40), deckMaster: DECK_MASTER }, { main: withFiller(["Mirror Force"], 40), deckMaster: FILLER },
    { domain: true, ordered: true, looseDecks: true });
  await expectReadyToAct(alice.page);
  await summon(alice.page);
  await alice.page.screenshot({ path: shotDir("domain-board.png") });
  await alice.page.locator('[data-testid="dm-badge-wrap"][data-local="true"]').getByTestId("dm-badge").click();
  await expect(alice.page.getByTestId("dm-badge-pop")).toBeVisible();
  await alice.page.waitForTimeout(500);
  await alice.page.screenshot({ path: shotDir("domain-master.png") });
  await leave(alice.page, slug);
});
