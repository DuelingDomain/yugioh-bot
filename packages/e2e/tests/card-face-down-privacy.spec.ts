import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { endTurn, handCard, openLog, pickLegalZone, startDuel, useCard, watchDuel } from "../helpers/board";
import { cardCode } from "../helpers/cards";
import { FILLER, withFiller } from "../helpers/decks";

const SET_MONSTER = "Celtic Guardian";
const SET_TRAP = "Mirror Force";

// Face-down cards are hidden information. Alice sets a monster and a trap. Only Alice may learn their names.
// The opponent and a spectator must not get the name, the code or the art from the screen, the detail panel,
// the log, the DOM, or the room API.
test("face-down cards stay hidden from the opponent and a spectator", async ({ player }) => {
  const alice = await player("p1");
  const bob = await player("p2");
  const spectator = await player("p3");
  const { slug } = await startDuel(
    alice,
    bob,
    "facedown",
    { main: withFiller([SET_MONSTER, SET_TRAP], 14) },
    { main: withFiller([FILLER], 14) },
  );
  await watchDuel(spectator, slug);

  await useCard(alice.page, handCard(alice.page, SET_MONSTER), "Set monster");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await useCard(alice.page, handCard(alice.page, SET_TRAP), "Set Spell/Trap");
  await pickLegalZone(alice.page, "st");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await expect(alice.page.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(1);

  // The owner sees both names in the detail panel.
  await alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"] button').click();
  await alice.page.keyboard.press("Escape");
  await expect(alice.page.getByRole("heading", { name: SET_MONSTER })).toBeVisible();

  // Control: the same check does see the names on the owner's screen.
  expect(await alice.page.content()).toContain(SET_MONSTER);

  await endTurn(alice.page, 2);
  for (const viewer of [bob.page, spectator.page]) {
    await expect(viewer.locator('[data-kind="mz"][data-occupied="true"]')).toHaveCount(1);
    await expect(viewer.locator('[data-kind="st"][data-occupied="true"]')).toHaveCount(1);
    await expectNothingLeaks(viewer, slug);
    // Inspecting the face-down cards shows no name.
    for (const kind of ["mz", "st"]) {
      await viewer.locator(`[data-kind="${kind}"][data-occupied="true"] button`).click();
      await viewer.keyboard.press("Escape");
      await expectNothingLeaks(viewer, slug);
    }
    const log = await openLog(viewer);
    await expect(log).not.toContainText(SET_MONSTER);
    await expect(log).not.toContainText(SET_TRAP);
  }
});

async function expectNothingLeaks(page: Page, slug: string): Promise<void> {
  const secrets = [SET_MONSTER, SET_TRAP];
  const codes = secrets.map(cardCode);
  const dom = await page.content();
  const room = await (await page.request.get(`/api/duels/${slug}`)).text();
  for (const [source, text] of [["DOM", dom], ["room API", room]] as const) {
    for (const name of secrets) expect(text, `${source} leaks the name ${name}`).not.toContain(name);
    for (const code of codes) expect(text, `${source} leaks code ${code}`).not.toMatch(new RegExp(`\\b${code}\\b`));
  }
}
