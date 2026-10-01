import { expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

export const ydkFixture = fileURLToPath(new URL("../fixtures/earth-normals-40.ydk", import.meta.url));

let counter = 0;
/** A table name no other test uses, so tests can run in parallel on one stack. */
export function uniqueTableName(label: string): string {
  counter += 1;
  return `E2E ${label} ${Date.now().toString(36)}${counter}`;
}

/** Creates a public Standard table through the creator form. Returns the room slug. */
export async function createStandardTable(page: Page, name: string): Promise<string> {
  await page.goto("/duels/new");
  await page.getByLabel("Table name").fill(name);
  await page.getByRole("button", { name: /^Create game/ }).click();
  await page.waitForURL(/\/duels\/(?!new)[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** Imports the .ydk fixture and readies up. Waits for the seat to show Ready. */
export async function importDeckAndReady(page: Page): Promise<void> {
  await page.getByLabel("YDK file").setInputFiles(ydkFixture);
  await expect(page.getByLabel("Deck counts")).toContainText("Main 40");
  const ready = page.getByRole("button", { name: "Ready with this deck" });
  await expect(ready).toBeEnabled();
  await ready.click();
  await expect(page.getByRole("listitem").filter({ hasText: "· You" }).getByText("Ready", { exact: true })).toBeVisible();
}

/** A live duel opens behind a gate that offers a separate window. Tests play in the same tab. */
export async function enterDuelRoom(page: Page): Promise<void> {
  const gate = page.getByTestId("duel-window-gate");
  const board = page.getByRole("region", { name: "Duel field" });
  await expect(gate.or(board)).toBeVisible({ timeout: 60_000 });
  if (await gate.isVisible()) await page.getByRole("button", { name: "Open here instead" }).click();
  await expect(board).toBeVisible();
}

export async function openOptions(page: Page): Promise<void> {
  const gear = page.getByRole("button", { name: "Options" });
  if ((await gear.getAttribute("aria-pressed")) !== "true") await gear.click();
  await expect(gear).toHaveAttribute("aria-pressed", "true");
}

export async function surrender(page: Page): Promise<void> {
  await openOptions(page);
  await page.getByRole("button", { name: "Surrender", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Surrender" });
  await dialog.getByRole("button", { name: "Surrender", exact: true }).click();
}

/** Picks one option of a segmented control. The radio input is visually hidden, so the visible label takes the click. */
async function chooseOption(page: Page, group: string, label: string): Promise<void> {
  const radioGroup = page.getByRole("radiogroup", { name: group });
  await radioGroup.getByText(label, { exact: true }).click();
  await expect(radioGroup.getByRole("radio", { name: label, exact: true })).toBeChecked();
}

export type TableOptions = {
  /** Domain format (Deck Masters). Default is a Standard duel. */
  domain?: boolean;
  /** Keep the .ydk order: the first 5 main cards are the opening hand. */
  ordered?: boolean;
  /** Allow short decks and other deck shapes. Needed for small fixed decks. */
  looseDecks?: boolean;
  /** Turn off the banlist so any test card is legal. */
  noBanlist?: boolean;
  startingHand?: number;
  startingLP?: number;
  /** Table type of the creator ("Table type" select). Default 1v1. */
  format?: "1v1" | "tag" | "ffa3" | "ffa4";
};

/**
 * Creates a table through the creator form with a deterministic setup:
 * no turn timer, and optional imported deck order, loose deck checks, no banlist.
 */
export async function createTable(page: Page, name: string, options: TableOptions = {}): Promise<string> {
  await page.goto("/duels/new");
  await page.getByLabel("Table name").fill(name);
  if (options.format && options.format !== "1v1") await page.getByLabel("Table type").selectOption(options.format);
  if (options.domain) await chooseOption(page, "Duel type", "Domain");
  await page.getByLabel("Turn timer").selectOption({ label: "No turn timer" });
  if (options.noBanlist) await page.getByLabel("Forbidden & Limited list").selectOption({ index: 0 });
  if (options.ordered) await chooseOption(page, "Opening deck order", "Not shuffled");
  if (options.looseDecks) await chooseOption(page, "Deck validation", "Allow invalid decks");
  if (options.startingHand !== undefined) {
    await page.getByLabel("Starting hand").selectOption({ label: `${options.startingHand} ${options.startingHand === 1 ? "card" : "cards"} in Starting Hand` });
  }
  if (options.startingLP !== undefined) await page.getByLabel("Starting Life Points").selectOption({ label: `${options.startingLP} Life Points` });
  await page.getByRole("button", { name: /^Create game/ }).click();
  await page.waitForURL(/\/duels\/(?!new)[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** Imports a deck built in a test and readies up. */
export async function importDeckUploadAndReady(page: Page, upload: { name: string; mimeType: string; buffer: Buffer }, mainCount: number): Promise<void> {
  await page.getByLabel("YDK file").setInputFiles(upload);
  await expect(page.getByLabel("Deck counts")).toContainText(`Main ${mainCount}`);
  const ready = page.getByRole("button", { name: "Ready with this deck" });
  await expect(ready).toBeEnabled();
  await ready.click();
  await expect(page.getByRole("listitem").filter({ hasText: "· You" }).getByText("Ready", { exact: true })).toBeVisible();
}

/**
 * Puts a practice bot on a seat (0-based; with no seat, the first empty one). Uses the host's bot route
 * `POST /api/duels/<slug>/bot` with `{ seat }`, so a test can fill seats of a 3 or 4 seat table without the lobby buttons.
 */
export async function addBotToSeat(page: Page, slug: string, seat?: number): Promise<void> {
  const response = await page.request.post(`/api/duels/${encodeURIComponent(slug)}/bot`, {
    headers: { "Content-Type": "application/json" },
    data: seat === undefined ? {} : { seat },
  });
  expect(response.ok(), `add bot to seat ${seat ?? "(first empty)"}: ${response.status()} ${await response.text()}`).toBe(true);
}
