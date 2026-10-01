import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { createStandardTable, enterDuelRoom, importDeckAndReady, uniqueTableName } from "../helpers/duel";

// Flow b: solo table with the practice bot, one played action, then a spectator joins.
test("host plays one action against the practice bot and a spectator sees no hand faces", async ({ player }) => {
  const host = await player("p3");
  const spectator = await player("p4");
  const table = uniqueTableName("bot");

  const slug = await createStandardTable(host.page, table);
  await host.page.getByRole("button", { name: "Add practice bot" }).click();
  await importDeckAndReady(host.page);
  const start = host.page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();
  await enterDuelRoom(host.page);

  await playOneAction(host.page);

  await spectator.page.goto(`/duels/${slug}`);
  await expect(spectator.page.getByText("You are spectating")).toBeVisible();
  await expect(spectator.page.getByTestId("duel-window-gate")).toHaveCount(0);
  const hands = spectator.page.locator("[data-hand-seat]");
  await expect(hands).toHaveCount(2);
  // A hidden hand card is labelled "<owner> card N" and shows a card back, never art.
  for (const label of await hands.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""))) {
    expect(label).toMatch(/ card \d+$/);
  }
  await expect(hands.locator("button").first()).toBeVisible();
  await expect(hands.locator("img")).toHaveCount(0);
  await expect(hands.locator("[data-revealed]")).toHaveCount(0);
});

/** The host moves first. Normal Summon the first monster in hand and wait for it to land on the field. */
async function playOneAction(page: Page): Promise<void> {
  const myHand = page.locator('[data-hand-seat="0"]')  // the host takes seat 0;
  const handCards = myHand.locator("button");
  await expect(handCards).toHaveCount(5);
  const myMonsters = page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]');
  await expect(myMonsters).toHaveCount(0);

  await handCards.first().click();
  await page.getByRole("menu").getByRole("menuitem", { name: /Normal Summon/ }).click();
  // The prompt now asks for a zone: pick the first legal monster zone.
  await page.locator('[data-kind="mz"][data-side="you"][data-legal="true"] button').first().click();

  await expect(myMonsters).toHaveCount(1);
  await expect(handCards).toHaveCount(4);
}
