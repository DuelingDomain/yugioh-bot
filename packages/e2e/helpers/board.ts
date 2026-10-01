import { expect, type Locator, type Page } from "@playwright/test";
import type { Seat } from "./fixtures";
import { addBotToSeat, createTable, enterDuelRoom, importDeckUploadAndReady, uniqueTableName, type TableOptions } from "./duel";
import { ydkUpload, type DeckSpec } from "./decks";

export type Duelists = { alice: Seat; bob: Seat; slug: string; table: string };

/**
 * Two duelists, one table, both decks imported, duel started, both in the duel room.
 * Alice takes seat 1 (moves first, no draw on turn 1). Decks are in imported order when `ordered` is set.
 */
export async function startDuel(
  alice: Seat,
  bob: Seat,
  label: string,
  aliceDeck: DeckSpec,
  bobDeck: DeckSpec,
  options: TableOptions = { ordered: true, looseDecks: true, noBanlist: true },
): Promise<Duelists> {
  const table = uniqueTableName(label);
  const slug = await createTable(alice.page, table, options);
  await bob.page.goto(`/duels/${slug}`);
  await expect(bob.page.getByRole("heading", { level: 1, name: table })).toBeVisible();
  await bob.page.getByRole("button", { name: "Join table" }).click();
  await importDeckUploadAndReady(bob.page, ydkUpload(bobDeck), bobDeck.main.length);
  await importDeckUploadAndReady(alice.page, ydkUpload(aliceDeck), aliceDeck.main.length);
  const start = alice.page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();
  await enterDuelRoom(alice.page);
  await enterDuelRoom(bob.page);
  return { alice, bob, slug, table };
}

/** A spectator opens the room of a running duel. */
export async function watchDuel(spectator: Seat, slug: string): Promise<void> {
  await spectator.page.goto(`/duels/${slug}`);
  await expect(spectator.page.getByText("You are spectating")).toBeVisible();
  await expect(spectator.page.getByRole("region", { name: "Duel field" })).toBeVisible();
}

export const yourHand = (page: Page): Locator => page.getByRole("group", { name: "Your hand" });

/** A card in your own hand. The n-th copy when a name repeats. */
export const handCard = (page: Page, name: string, nth = 0): Locator => yourHand(page).getByRole("button", { name, exact: true }).nth(nth);

/** A card on your side of the field: zone buttons hold the art only, so find it by its zone. */
export const ownZone = (page: Page, kind: "mz" | "st" | "emz" | "field", index: number): Locator =>
  page.locator(`[data-kind="${kind}"][data-side="you"]`).nth(index);

/** Opens the card menu and picks an action, e.g. `useCard(page, handCard(page, "Raigeki"), "Activate")`. */
export async function useCard(page: Page, card: Locator, action: RegExp | string): Promise<void> {
  await expectReadyToAct(page);
  await card.click();
  const item = page.getByRole("menu").getByRole("menuitem", { name: typeof action === "string" ? new RegExp(`^${action}`) : action });
  await item.click();
}

/**
 * The card menu is built from the open question. Between two answers the page says "Waiting for a response."
 * and a click on a card would open no menu. Wait until that text is gone.
 */
export async function expectReadyToAct(page: Page): Promise<void> {
  await expect(page.getByText("Waiting for a response.")).toHaveCount(0);
}

/**
 * Answers a zone prompt by clicking the first free legal zone of a kind on your side.
 * It waits for the zone prompt first: until it arrives, zones can still be legal for the
 * previous prompt (for example a monster you may reposition), and a click would hit those.
 */
export async function pickLegalZone(page: Page, kind: "mz" | "st"): Promise<void> {
  await expect(page.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
  await page.locator(`[data-kind="${kind}"][data-side="you"][data-legal="true"][data-occupied="false"] button`).first().click();
}

/** A chain response window. Returns the panel. */
export const respondPanel = (page: Page, title: RegExp | string = /^You can respond/): Locator => page.getByRole("group", { name: title });

export const chainList = (page: Page): Locator => page.getByRole("region", { name: "Current chain" });

/** Count label on a pile button: "Your Graveyard (2)", "Opponent Main Deck (7)". */
export const pile = (page: Page, owner: "Your" | "Opponent", name: "Graveyard" | "Banished" | "Main Deck" | "Extra Deck"): Locator =>
  page.getByRole("button", { name: new RegExp(`^${owner} ${name} \\(\\d+\\)$`) });

/** Names of the cards in a pile, read from the card panel after the pile is opened. */
export async function pileCards(page: Page, owner: "Your" | "Opponent", name: "Graveyard" | "Banished"): Promise<string[]> {
  // The "Open" chip shows on hover or focus only.
  await page.getByRole("button", { name: new RegExp(`^${owner} ${name} \\(\\d+\\)$`) }).hover();
  await page.getByRole("button", { name: `Open ${owner} ${name}` }).click();
  const dialog = page.getByRole("dialog", { name: `${owner} ${name}` });
  const cards = dialog.getByRole("list", { name: `${owner} ${name}, newest first` }).getByRole("button");
  await expect(cards.first()).toBeVisible();
  const names = await cards.evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("aria-label") ?? "").replace(/, \d+ of \d+.*$/, "")));
  await dialog.getByRole("button", { name: `Close ${owner} ${name}` }).click();
  await expect(dialog).toHaveCount(0);
  return names;
}

/** The history rail lives on the Log tab. */
export async function openLog(page: Page): Promise<Locator> {
  const tab = page.getByRole("tab", { name: "Log" });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return page.getByRole("region", { name: "Duel history" });
}

/** The "Turn N" counter in the room header. */
export const turnLabel = (page: Page): Locator => page.getByText(/^Turn \d+$/).first();

/** Ends your turn with the dock button and waits until the header shows the next turn. */
export async function endTurn(page: Page, nextTurn: number): Promise<void> {
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(turnLabel(page)).toHaveText(`Turn ${nextTurn}`);
}

/**
 * Goes to the Battle Phase and attacks with the first monster on your side. When the opponent has no
 * monster, the attack is direct and needs no target pick.
 */
export async function attackWithFirstMonster(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^To Battle/ }).click();
  await expect(page.getByText(/Battle Phase/).first()).toBeVisible();
  await page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"] button').first().click();
  await page.getByRole("menu").getByRole("menuitem", { name: /Attack/ }).first().click();
}

export type Table = { seats: Seat[]; slug: string; table: string };

/**
 * A table of 3 or 4 seats (or 2). `humans[0]` creates the table and takes seat 0; the others join in order.
 * `bots` are the 0-based seats a practice bot fills (added through the bot route before the humans join, so
 * humans take the seats that are left). Every human imports its deck and readies, then the host starts the duel and
 * all humans enter the duel room. `decks` has one deck for each human, in the same order.
 * The bot route and the lobby for 3 and 4 seats belong to the multi-player work: specs that use this helper are
 * `test.fixme` until that lands.
 */
export async function startTable(
  humans: Seat[],
  label: string,
  decks: DeckSpec[],
  options: TableOptions & { bots?: number[] } = { ordered: true, looseDecks: true, noBanlist: true, format: "ffa4" },
): Promise<Table> {
  if (humans.length !== decks.length) throw new Error(`startTable: ${humans.length} players but ${decks.length} decks`);
  const [host, ...guests] = humans as [Seat, ...Seat[]];
  const table = uniqueTableName(label);
  const slug = await createTable(host.page, table, options);
  for (const seat of options.bots ?? []) await addBotToSeat(host.page, slug, seat);
  for (const guest of guests) {
    await guest.page.goto(`/duels/${slug}`);
    await expect(guest.page.getByRole("heading", { level: 1, name: table })).toBeVisible();
    await guest.page.getByRole("button", { name: "Join table" }).click();
  }
  for (const [index, guest] of guests.entries()) {
    const deck = decks[index + 1]!;
    await importDeckUploadAndReady(guest.page, ydkUpload(deck), deck.main.length);
  }
  await importDeckUploadAndReady(host.page, ydkUpload(decks[0]!), decks[0]!.main.length);
  const start = host.page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();
  for (const seat of humans) await enterDuelRoom(seat.page);
  return { seats: humans, slug, table };
}

/** The opponent boards a player sees at a multi-seat table (`section[data-relation="opponent"]`). */
export const opponentBoards = (page: Page): Locator => page.locator('[data-testid="multi-seat-stage"] section[data-relation="opponent"]');

/**
 * Each seat sees every other seat, and no seat shows the viewer's own board as an opponent. The turn order strip lists
 * `count` opponents. The focused opponent fills the top field, so the rail holds one board fewer.
 */
export async function expectOpponentBoards(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId("multi-seat-stage")).toBeVisible();
  await expect(page.getByTestId("seat-strip").locator('[data-relation="opponent"]')).toHaveCount(count);
  await expect(opponentBoards(page)).toHaveCount(count - 1);
}
