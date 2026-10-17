import { test, expect } from "../helpers/fixtures";
import { handCard, pickLegalZone, startDuel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

/**
 * One real mouse click on a prompt button must act. Coming back to the tab used to raise the room's
 * recovering flag, which disabled every prompt button until the re-read ended: the first click on
 * Confirm landed on a disabled button and the player had to click again. `page.mouse` is used on purpose:
 * `locator.click()` waits for the button to be enabled and would hide a lost first click.
 */
test("one click on Confirm submits right after the tab comes back", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "first-click", { main: withFiller(["Dark Designator"], 14) },
    { main: withFiller([FILLER, FILLER, FILLER, FILLER, FILLER, "Celtic Guardian", "Celtic Guardian"], 14) });
  await useCard(alice.page, handCard(alice.page, "Dark Designator"), "Activate");
  await pickLegalZone(alice.page, "st");
  await alice.page.getByLabel("Search card name").fill("Celtic Guardian");
  await alice.page.getByRole("option", { name: /Celtic Guardian/ }).click();

  const page = bob.page;
  const pick = page.getByRole("group", { name: "Select the card(s) to add to your hand" });
  const confirm = pick.getByRole("button", { name: "Confirm" });
  await expect(pick).toBeVisible();
  const card = (await pick.getByRole("list").getByRole("button").first().boundingBox())!;
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(confirm).toBeEnabled();

  const target = (await confirm.boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
  // The tab goes away and comes back, and the click follows at once, before the re-read can end.
  await page.evaluate(() => {
    const set = (value: string) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    set("visible");
  });
  await page.mouse.down();
  await page.mouse.up();
  await expect(pick).toHaveCount(0);
});
