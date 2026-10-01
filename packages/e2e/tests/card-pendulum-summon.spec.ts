import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { expectReadyToAct, handCard, openLog, pickLegalZone, startDuel, useCard, watchDuel } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";

const LOW_SCALE = "Performapal Lebellman"; // Pendulum Scale 1
const HIGH_SCALE = "Endymion, the Mighty Master of Magic"; // Pendulum Scale 8

// The legacy 1v1 engine (E2E_1V1_ENGINE=legacy, the engine of production) is main's engine from before the n-seat work. Its history
// labels this summon "Special Summon" (it only knows the Pendulum Zones 6 and 7, Master Rule 5 uses 0 and 4). The merged engine fixes that.
const legacyEngine = process.env.E2E_1V1_ENGINE === "legacy";

// Master Rule 5: two Pendulum Scales open the range of levels 2 to 7. Level 4 Warwolves from the hand fit.
// The merged engine calls the summon a Pendulum Summon, the legacy engine a plain Special Summon.
test("a Pendulum Summon is shown as a Pendulum Summon on every screen", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const spectator = await player("p3");
  const { slug } = await startDuel(
    alice,
    bob,
    "pendulum",
    { main: withFiller([LOW_SCALE, HIGH_SCALE, FILLER, FILLER, FILLER], 14) },
    { main: withFiller([], 14) },
  );
  await watchDuel(spectator, slug);

  // Two scales. The second one goes to the only free Pendulum Zone without a zone prompt.
  await useCard(alice.page, handCard(alice.page, LOW_SCALE), "Activate");
  await pickLegalZone(alice.page, "st");
  await expect(alice.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await useCard(alice.page, handCard(alice.page, HIGH_SCALE), "Activate");
  await expect(alice.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(2);

  // The Pendulum Summon starts from a scale card. Pick one Warwolf, finish, choose a zone and a position.
  await alice.page.keyboard.press("Escape");
  await startPendulumSummon(alice.page);
  const choice = alice.page.getByRole("group", { name: "Select the card(s) to Special Summon" });
  // Cancel backs out of the summon without a stuck prompt. Then the summon starts again.
  await choice.getByRole("button", { name: "Cancel" }).click();
  await expect(choice).toHaveCount(0);
  await startPendulumSummon(alice.page);
  // The cards of a hand pick are chosen on the board; the bar holds Finish and Cancel.
  await handCard(alice.page, FILLER).click();
  await choice.getByRole("button", { name: "Finish" }).click();
  await pickLegalZone(alice.page, "mz");
  await alice.page.getByRole("button", { name: /Face-up Defense/ }).click();
  const summoned = alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]');
  await expect(summoned).toHaveCount(1);
  await expect(summoned).toHaveAttribute("data-defense", "true");

  for (const page of [alice.page, bob.page, spectator.page]) {
    const log = await openLog(page);
    if (legacyEngine) {
      await expect(log).toContainText(/Special Summon/i);
    } else {
      await expect(log).toContainText("Pendulum Summon");
      await expect(log).not.toContainText(/Special Summon/i);
    }
  }
});

/** The Pendulum Summon starts from a scale card on your side. */
async function startPendulumSummon(page: Page): Promise<void> {
  await expectReadyToAct(page);
  await page.locator('[data-kind="st"][data-side="you"][data-occupied="true"] button').first().click();
  await page.getByRole("menu").getByRole("menuitem", { name: /^Special Summon/ }).click();
}
