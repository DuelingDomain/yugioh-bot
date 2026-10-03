import { expect, type Page, type TestInfo } from "@playwright/test";
import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { expectReadyToAct, useCard } from "./board";
import { readTable, readTableTrace, tableField, tableGrave, tableLpValue } from "./table";

export const rulesPanel = (page: Page) => page.locator("[data-prompt-panel]");
export const rulesZone = (page: Page, seat: number, sequence: number) =>
  tableField(page, seat).locator(`[data-zones='${seat}:4:${sequence}']`);

/** A live prompt, polled without shortening Playwright's default assertion timeout. */
export async function waitRulesPrompt(page: Page, slug: string, matches: (prompt: DuelPrompt) => boolean): Promise<DuelPrompt> {
  await expect.poll(async () => {
    const prompt = (await readTable(page, slug)).engine!.prompt;
    return prompt?.seat === 0 && matches(prompt);
  }).toBe(true);
  await expectReadyToAct(page);
  return (await readTable(page, slug)).engine!.prompt!;
}

/** Only UI No clicks. Each iteration waits for a new recorded prompt before continuing. */
export async function declineToAction(page: Page, slug: string, turn?: number): Promise<void> {
  for (let step = 0; step < 24; step += 1) {
    const prompt = await waitRulesPrompt(page, slug, () => true);
    const view = (await readTable(page, slug)).engine!;
    if (prompt.context?.type === "action" && (turn == null || view.turn === turn)) return;
    expect(prompt.options.some((option) => option.id === "no") || prompt.cancelable, `unexpected prompt: ${JSON.stringify(prompt)}`).toBe(true);
    await rulesPanel(page).getByRole("button", { name: /^(No|Pass)$/, exact: true }).click();
    await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
  }
  throw new Error("No action prompt after 24 browser response windows");
}

/** Cards on the field are chosen on the board; hidden/pile cards use the real prompt strip. */
export async function pickRulesCard(page: Page, slug: string, name: string): Promise<void> {
  const prompt = await waitRulesPrompt(page, slug, (p) => p.options.some((option) => option.card?.name === name));
  const option = prompt.options.find((item) => item.card?.name === name)!;
  if (option.location === 4 && option.controller != null && option.sequence != null) {
    await rulesZone(page, option.controller, option.sequence).locator("button").click();
  } else {
    await rulesPanel(page).getByRole("button", { name: new RegExp(`^\\d+\\. ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$| ·)`) }).first().click();
  }
  // Card selections can require confirmation; toggle prompts answer each click directly.
  if (prompt.kind !== "toggle" && prompt.kind !== "choice") {
    const confirm = rulesPanel(page).getByRole("button", { name: "Confirm", exact: true });
    if (await confirm.count()) await confirm.click();
  }
  await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
}

/** Opens the real Extra Deck pile and invokes the offered summon action. */
export async function summonRulesExtra(page: Page, name: string): Promise<void> {
  await expectReadyToAct(page);
  await tableField(page, 0).getByRole("button", { name: /^Your Extra Deck \(/ }).click();
  await useCard(page, page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${name}`) }).first(), "Special Summon");
  // The pile inspector stays open after its card menu submits the summon action.
  await page.getByRole("dialog").getByRole("button", { name: "Close Your Extra Deck", exact: true }).click();
}

/** Engine/UI parity after a rule assertion: LP values, occupied zones, GY counts and hand metadata. */
export async function expectRulesUi(page: Page, slug: string, info: TestInfo): Promise<DuelEngineView> {
  const engine = (await readTable(page, slug)).engine!;
  for (const seat of engine.seats) {
    await expect(tableLpValue(page, seat.seat)).toHaveText(seat.lp.toLocaleString("en-US"));
    await expect(tableField(page, seat.seat).locator("[data-kind='mz'][data-occupied='true'], [data-kind='emz'][data-occupied='true']")).toHaveCount(seat.monsters.filter(Boolean).length);
    for (const card of seat.monsters.filter((card) => card?.code != null)) {
      await expect(rulesZone(page, seat.seat, card!.sequence).locator("[data-card-art] img")).toHaveAttribute("src", new RegExp(`/cards/${card!.code}/image`));
    }
    await expect(tableGrave(page, seat.seat)).toHaveAccessibleName(new RegExp(` (GY|Graveyard) \\(${seat.graveyard.length}\\)$`));
    await expect(page.locator(`[data-holo='${seat.seat}'] [title='Cards in hand']`)).toHaveText(String(seat.hand.length));
  }
  await info.attach("rules-engine-and-prompt-log", { body: JSON.stringify({ engine, trace: await readTableTrace(page, slug) }, null, 2), contentType: "application/json" });
  return engine;
}

export async function expectRulesPriority(page: Page, order: number[], choosing = 0): Promise<void> {
  const chips = page.locator("[data-chain-fx] [data-testid='priority-chips'] [data-seat]");
  await expect.poll(() => chips.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-seat"))))).toEqual(order);
  await expect(page.locator(`[data-chain-fx] [data-testid='priority-chips'] [data-seat='${choosing}']`)).toHaveAttribute("data-now", "true");
  for (const chip of await chips.all()) await expect(chip).toBeVisible();
}
