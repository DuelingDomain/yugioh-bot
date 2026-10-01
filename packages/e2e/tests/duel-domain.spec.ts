import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { attackWithFirstMonster, endTurn, handCard, pickLegalZone, activateSingleResponse, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

const DECK_MASTER = "Celtic Guardian";

/** The two Deck Master panels of the room: what one screen says about a master. */
const masterPanel = (page: Page, title: "Your Master" | "Opponent Master") =>
  page.getByText(title, { exact: true }).locator("xpath=ancestor::*[1]");

async function expectMaster(page: Page, title: "Your Master" | "Opponent Master", facts: { status: string; returns: string; surcharge?: string }) {
  const panel = masterPanel(page, title);
  await expect(panel).toContainText(DECK_MASTER);
  await expect(panel).toContainText(new RegExp(`Status\\s*${facts.status}`));
  await expect(panel).toContainText(new RegExp(`Returns\\s*${facts.returns}`));
  if (facts.surcharge) await expect(panel).toContainText(new RegExp(`Next surcharge\\s*${facts.surcharge}`));
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
  await expectMaster(alice.page, "Your Master", { status: "In Deck Master Zone", returns: "0", surcharge: "0 LP" });
  await expectMaster(bob.page, "Opponent Master", { status: "In Deck Master Zone", returns: "0", surcharge: "0 LP" });

  // Turn 1: Normal Summon the master from its zone. Both screens say it is on the field.
  await alice.page.getByRole("button", { name: `Normal Summon ${DECK_MASTER}` }).click();
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await expectMaster(alice.page, "Your Master", { status: "On field", returns: "0" });
  await expectMaster(bob.page, "Opponent Master", { status: "On field", returns: "0" });
  await endTurn(alice.page, 2);

  // Turn 2: Bob Sets Mirror Force.
  await useCard(bob.page, handCard(bob.page, "Mirror Force"), "Set Spell/Trap");
  await pickLegalZone(bob.page, "st");
  await expect(bob.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(bob.page, 3);

  // Turn 3: the master attacks into Mirror Force and is destroyed. Alice is asked to recall it.
  await attackWithFirstMonster(alice.page);
  await activateSingleResponse(bob.page);
  const recall = alice.page.getByRole("group", { name: /Deck Master/i });
  await expect(recall).toBeVisible();
  await expect(recall).toContainText("Next summon after this recall: 500 LP");
  await recall.getByRole("button", { name: /^Yes/ }).click();

  // The master is back in its zone on both screens. The next summon costs 500 Life Points.
  await expectMaster(alice.page, "Your Master", { status: "In Deck Master Zone", returns: "1", surcharge: "500 LP" });
  await expectMaster(bob.page, "Opponent Master", { status: "In Deck Master Zone", returns: "1", surcharge: "500 LP" });
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(0);
  await endTurn(alice.page, 4);
  await endTurn(bob.page, 5);

  // Turn 5: the second summon pays the Life Point cost. Both screens show 7,500.
  await alice.page.getByRole("button", { name: `Normal Summon ${DECK_MASTER}` }).click();
  await pickLegalZone(alice.page, "mz");
  await expectMaster(alice.page, "Your Master", { status: "On field", returns: "1" });
  for (const page of [alice.page, bob.page]) await expect(page.getByText("7,500", { exact: true })).toBeVisible();
});
