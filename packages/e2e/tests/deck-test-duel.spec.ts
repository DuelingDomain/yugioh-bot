import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { enterDuelRoom, surrender, ydkFixture } from "../helpers/duel";
import { yourHand } from "../helpers/board";

// Test duel from the deck editor: a real engine duel against the practice bot, started from an unsaved deck.

const mainCards = (page: Page) => page.locator('section[data-section="main"] ul > li button[aria-label]');

async function mainLabels(page: Page): Promise<string[]> {
  return mainCards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
}

/** The editor with the fixture deck imported and a name typed, so there are unsaved edits to lose. */
async function openEditorWithDeck(page: Page, name: string): Promise<string[]> {
  await page.goto("/decks/new");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("YDK file").setInputFiles(ydkFixture);
  await expect(mainCards(page)).toHaveCount(40);
  // Card names load after the import. Wait for them, so the labels are the ones the hand will show.
  await expect.poll(async () => (await mainLabels(page)).some((label) => label.startsWith("Passcode"))).toBe(false);
  await page.keyboard.press("Escape");
  await page.getByLabel("Deck name").fill(name);
  return mainLabels(page);
}

async function startTestDuel(page: Page, options: { shuffle: boolean; goFirst: boolean }): Promise<void> {
  await page.getByRole("button", { name: "Test duel", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Test duel against a bot" });
  for (const [label, wanted] of [["Shuffle", options.shuffle], ["Go first", options.goFirst]] as const) {
    const box = dialog.getByLabel(label, { exact: true });
    // The label sits on top of the native input, so click the label like a user does.
    if ((await box.isChecked()) !== wanted) await dialog.locator(`label[for="${await box.getAttribute("id")}"]`).click();
    await expect(box).toBeChecked({ checked: wanted });
  }
  await dialog.getByRole("button", { name: "Start duel" }).click();
  await page.waitForURL(/\/duels\/(?!new)[^/?]+$/);
  await enterDuelRoom(page);
}

/** Browser Back. The leave guard cancels the traversal, so there is no load for page.goBack to wait for. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => history.back());
}

async function expectEditorRestored(page: Page, name: string, labels: string[]): Promise<void> {
  await expect(page).toHaveURL(/\/decks\/new$/);
  await expect(page.getByLabel("Deck name")).toHaveValue(name);
  await expect(mainCards(page)).toHaveCount(labels.length);
  expect(await mainLabels(page)).toEqual(labels);
}

test("Shuffle off deals the first five cards of the editor and Go first on moves first; Quit returns to the unchanged deck", async ({ player }) => {
  const { page } = await player("p5");
  const name = "Test duel deck order";
  const labels = await openEditorWithDeck(page, name);

  await startTestDuel(page, { shuffle: false, goFirst: true });
  const hand = yourHand(page).getByRole("button");
  await expect(hand).toHaveCount(5);
  const dealt = await hand.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  const sorted = (list: string[]) => list.map((label) => label.split(",")[0]).sort();
  expect(sorted(dealt)).toEqual(sorted(labels.slice(0, 5)));
  await expect(page.getByText("Your turn").first()).toBeVisible();

  await page.getByTestId("test-duel-quit").click();
  await expectEditorRestored(page, name, labels);
  // The last choice is remembered.
  await page.getByRole("button", { name: "Test duel", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Test duel against a bot" });
  await expect(dialog.getByLabel("Shuffle", { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel("Go first", { exact: true })).toBeChecked();
});

test("Go first off lets the bot move first; Back asks to quit, Stay keeps the duel and Quit returns to the deck", async ({ player }) => {
  const { page } = await player("p5");
  const name = "Test duel bot first";
  const labels = await openEditorWithDeck(page, name);

  await startTestDuel(page, { shuffle: true, goFirst: false });
  // The bot opens: it plays turn 1 from seat 0, the player sits in seat 1 and gets turn 2.
  // The bot passes fast, so read the room JSON instead of racing the "Your turn" label.
  const slug = page.url().split("/").pop()!;
  const room = async () => {
    const response = await page.request.get(`/api/duels/${slug}`);
    return (await response.json()) as { mySeat: number; engine: { turn: number; turnSeat: number } };
  };
  expect((await room()).mySeat).toBe(1);
  await expect.poll(async () => (await room()).engine.turn).toBeGreaterThanOrEqual(2);
  const after = await room();
  expect(after.engine.turn).toBe(2);
  expect(after.engine.turnSeat).toBe(1);
  const duelUrl = page.url();

  await pressBack(page);
  const dialog = page.getByRole("dialog", { name: "Would you like to quit the duel?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(duelUrl);
  await expect(page.locator('[aria-label="Duel field"]')).toBeVisible();

  await pressBack(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Quit" }).click();
  await expectEditorRestored(page, name, labels);
});

test("Surrender ends the test duel and the result screen returns to the unchanged deck", async ({ player }) => {
  const { page } = await player("p5");
  const name = "Test duel surrender";
  const labels = await openEditorWithDeck(page, name);

  await startTestDuel(page, { shuffle: true, goFirst: true });
  await surrender(page);
  await page.getByRole("button", { name: "Exit duel" }).last().click();
  await expectEditorRestored(page, name, labels);
});
