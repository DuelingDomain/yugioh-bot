import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { attackWithFirstMonster, endTurn, handCard, pickLegalZone, activateSingleResponse, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

const DECK_MASTER = "Celtic Guardian";

/** The Deck Master badges of the room: one click opens a pop-over that says what one screen knows about a master. */
type Who = "you" | "rival";
const badgeOf = (page: Page, who: Who) =>
  page.locator(`[data-testid="dm-badge-wrap"][data-local="${who === "you"}"] [data-testid="dm-badge"]`);

async function expectMaster(page: Page, who: Who, facts: { where: string; cost: string }) {
  await badgeOf(page, who).click();
  const pop = page.getByTestId("dm-badge-pop");
  await expect(pop).toContainText(DECK_MASTER);
  await expect(pop.getByTestId("dm-badge-where")).toHaveText(facts.where);
  await expect(pop.getByTestId("dm-badge-cost")).toHaveText(`Next summon: ${facts.cost}`);
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
}

/** Summon the master from the pop-over of your badge. */
async function summonMaster(page: Page) {
  await badgeOf(page, "you").click();
  await page.getByTestId("dm-badge-summon").click();
}

// Domain format: the Deck Master waits in its own zone and is summoned from there. When it is destroyed,
// its owner may return it. The return adds a Life Point cost to the next summon.
test("a Deck Master is summoned from its zone, destroyed, recalled, and summoned again for a Life Point cost", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(
    alice,
    bob,
    "domain",
    { main: withFiller([], 14), deckMaster: DECK_MASTER },
    { main: withFiller(["Mirror Force"], 14), deckMaster: FILLER },
    { domain: true, ordered: true, looseDecks: true, noBanlist: true },
  );

  // The master waits in its zone on both screens.
  await expectMaster(alice.page, "you", { where: "In the Deck Master Zone", cost: "Free" });
  await expectMaster(bob.page, "rival", { where: "In the Deck Master Zone", cost: "Free" });

  // Turn 1: Normal Summon the master from its zone. Both screens say it is on the field.
  await summonMaster(alice.page);
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await expectMaster(alice.page, "you", { where: "On the field", cost: "500 LP" });
  await expectMaster(bob.page, "rival", { where: "On the field", cost: "500 LP" });
  await endTurn(alice.page, 2);

  // Turn 2: Bob Sets Mirror Force.
  await useCard(bob.page, handCard(bob.page, "Mirror Force"), "Set Spell/Trap");
  await pickLegalZone(bob.page, "st");
  await expect(bob.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(bob.page, 3);

  // Turn 3: use a hand card before attacking. The pinned Domain engine draws on turn 1 (legacy MR5 does not),
  // so Alice otherwise holds 7 cards and End Turn waits for a discard. Summoning the master never used her hand.
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(2);

  // The master attacks into Mirror Force and is destroyed with the filler. Alice is asked to recall it.
  await attackWithFirstMonster(alice.page);
  await activateSingleResponse(bob.page);
  const recall = alice.page.getByRole("group", { name: /Deck Master/i });
  await expect(recall).toBeVisible();
  await expect(recall).toContainText("Next summon after this recall: 500 LP");
  await recall.getByRole("button", { name: /^Yes/ }).click();

  // The master is back in its zone on both screens. The next summon costs 500 Life Points.
  await expectMaster(alice.page, "you", { where: "In the Deck Master Zone", cost: "500 LP" });
  await expectMaster(bob.page, "rival", { where: "In the Deck Master Zone", cost: "500 LP" });
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(0);
  await endTurn(alice.page, 4);
  await endTurn(bob.page, 5);

  // Turn 5: the second summon pays the Life Point cost. Both screens show 7,500.
  await summonMaster(alice.page);
  await pickLegalZone(alice.page, "mz");
  await expectMaster(alice.page, "you", { where: "On the field", cost: "1,000 LP" });
  for (const page of [alice.page, bob.page]) await expect(page.getByText("7,500", { exact: true })).toBeVisible();
});
