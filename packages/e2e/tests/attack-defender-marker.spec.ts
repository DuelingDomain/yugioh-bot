import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../helpers/fixtures";
import { enterDuelRoom } from "../helpers/duel";
import { answerTable, collectTableErrors, readTable, startTablePreset } from "../helpers/table";
import { rulesPanel } from "../helpers/table-rules";
import type { Locator, Page } from "@playwright/test";

// A rival declares an attack on the human's monster. While the human's response prompt is open, the arrow, the ring on the
// target and the "X attacks Y" line stay on screen, the prompt does not sit on the ring, and a reload keeps all of it.
// Preset ffa3-attack-defender (seat 1 is a scripted bot): needs DUEL_SCENARIOS=1 on the stack, which every e2e stack sets.
//   E2E_SLOT=7 E2E_WORKERS=1 npm run e2e --workspace=packages/e2e -- tests/attack-defender-marker.spec.ts
// ATTACK_SHOTS=<dir> also writes the screenshots used in the design review.

const shotsDir = process.env.ATTACK_SHOTS;

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "element has a box").not.toBeNull();
  return box!;
}

/** The marker of the declared attack, with the prompt open: arrow, caption and a target ring the prompt keeps off. */
async function expectDeclaredMarker(page: Page): Promise<void> {
  await expect(page.locator('[data-aim="locked"]')).toBeVisible();
  await expect(page.locator("[data-attack-caption]")).toBeVisible();
  await expect(page.locator("[data-attack-caption]")).toBeInViewport({ ratio: 1 });
  await expect(page.locator("[data-attack-caption]")).toContainText("attacks");
  const panel = rulesPanel(page).first();
  await expect(panel).toBeVisible();
  // The first ring is the attacker's, the last one the target's.
  const ring = page.locator('[data-aim="locked"] [class*="aimRing"]').last();
  await expect(ring).toBeVisible();
  await expect(ring).toBeInViewport({ ratio: 1 });
  // The panel may still be gliding into its place: the rects are read until they stand apart.
  await expect.poll(async () => overlaps(await boxOf(ring), await boxOf(panel))).toBe(false);
  await expect.poll(async () => overlaps(await boxOf(page.locator("[data-attack-caption]")), await boxOf(panel)), "the caption stays off the prompt").toBe(false);
}

/** Ends turn 1 and declines every earlier response window, until the first window after the attack is declared. */
async function passUntilAttack(page: Page, slug: string): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    const engine = (await readTable(page, slug)).engine!;
    const prompt = engine.prompt;
    if (prompt?.seat !== 0) {
      await page.waitForTimeout(300);
      continue;
    }
    if (engine.events.some((event) => event.kind === "attack")) return;
    const endTurn = prompt.context?.type === "action" ? prompt.options.find((option) => option.id.startsWith("to_ep")) : undefined;
    if (endTurn) await answerTable(page, slug, engine, { choice: endTurn.id });
    else await rulesPanel(page).getByRole("button", { name: /^(No|Pass)$/, exact: true }).click();
    await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.id).not.toBe(prompt.id);
  }
  throw new Error("The rival never declared an attack");
}

async function shot(page: Page, name: string): Promise<void> {
  if (!shotsDir) return;
  await page.mouse.move(0, 0);
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, `${name}.png`), animations: "disabled" });
}

test.describe("declared attack on the defender (FFA3)", () => {
  test.setTimeout(180_000);

  test("the response prompt keeps off the target ring, and a reload keeps the marker", async ({ player }) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    const slug = await startTablePreset(page, "ffa3-attack-defender");

    // Turn 1: pass. Turn 2: seat 1 declares Gemini Elf on Warrior of Zera and the human may respond.
    await passUntilAttack(page, slug);
    await expectDeclaredMarker(page);
    await shot(page, "defender-desktop");

    await page.reload();
    await enterDuelRoom(page);
    await expectDeclaredMarker(page);
    await shot(page, "defender-desktop-reload");

    // A spectator reads the same marker, on the compact boards.
    const watcher = await player("p2");
    await watcher.page.setViewportSize({ width: 1366, height: 768 });
    await watcher.page.goto(`/duels/${encodeURIComponent(slug)}?window=1&spectate=1`);
    await enterDuelRoom(watcher.page);
    await expect(watcher.page.locator('[data-aim="locked"]')).toBeVisible();
    await expect(watcher.page.locator("[data-attack-caption]")).toBeVisible();
    await shot(watcher.page, "spectator-desktop");

    // A phone keeps the marker, too.
    await page.setViewportSize({ width: 390, height: 844 });
    await expectDeclaredMarker(page);
    const switcher = page.locator("[data-seat-switcher]");
    await expect.poll(async () => overlaps(await boxOf(page.locator("[data-attack-caption]")), await boxOf(switcher)), "the caption stays off the phone camera tabs").toBe(false);
    await shot(page, "defender-mobile");

    expect(errors).toEqual([]);
  });
});
