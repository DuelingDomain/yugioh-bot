import { expect, type Page, type TestInfo } from "@playwright/test";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPracticeBotDeck } from "../../duel-server/src/practice-bot";
import { duelDataDir } from "../stack/env.mjs";
import { expectReadyToAct, handCard, pickLegalZone, useCard } from "./board";
import { readTable, readTableTrace } from "./table";

/** Decline optional human windows only, until a named engine state is reached. */
export async function declineUntil(page: Page, slug: string, ready: (view: DuelEngineView) => boolean): Promise<DuelEngineView> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await expect.poll(async () => {
      const view = (await readTable(page, slug)).engine!;
      return ready(view) || view.prompt?.seat === 0;
    }).toBe(true);
    const view = (await readTable(page, slug)).engine!;
    if (ready(view)) return view;
    expect(view.prompt?.context?.type, "only optional human chain windows may be declined").toBe("chain");
    await expectReadyToAct(page);
    const no = page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true });
    const pass = page.locator("[data-prompt-panel]").getByRole("button", { name: /^Pass/ });
    await expect(no.or(pass)).toBeVisible();
    await (await no.isVisible() ? no : pass).click();
    await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.id).not.toBe(view.prompt!.id);
  }
  throw new Error("Elimination setup exceeded 24 optional human response windows");
}

export const actionAt = (turn?: number) => (view: DuelEngineView): boolean =>
  view.prompt?.seat === 0 && view.prompt.context?.type === "action" && (turn === undefined || view.turn === turn);

export async function castFromHand(page: Page, slug: string, name: string): Promise<void> {
  await declineUntil(page, slug, actionAt());
  await useCard(page, handCard(page, name), "Activate");
  await pickLegalZone(page, "st");
}

export async function pickEliminationOpponent(page: Page, slug: string, seat: number): Promise<void> {
  await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.context?.type).toBe("opponent");
  await expectReadyToAct(page);
  await page.getByTestId(`holo-pick-${seat}`).click();
}

/** Expand the compact multi-effect precheck, then select the named response through the UI. */
export async function chooseEliminationResponse(page: Page, slug: string, name: string): Promise<void> {
  const view = (await readTable(page, slug)).engine!;
  expect(view.prompt?.context?.type).toBe("chain");
  const offered = view.prompt!.options.filter((option) => option.card);
  expect(offered.some((option) => option.card?.name === name)).toBe(true);
  await expectReadyToAct(page);
  const panel = page.locator("[data-prompt-panel]");
  await expect(panel.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Yes", exact: true }).click();
  if (offered.length > 1) await panel.getByRole("button", { name: new RegExp(name) }).first().click();
}

export async function recordElimination(page: Page, slug: string, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, {
    body: JSON.stringify({ room: await readTable(page, slug), trace: await readTableTrace(page, slug) }, null, 2),
    contentType: "application/json",
  });
}

export async function expectDomainCore(page: Page, slug: string, info: TestInfo): Promise<void> {
  const trace = await readTableTrace(page, slug);
  expect(trace.wasmFile).toBe("ocgcore.multi-domain.wasm");
  expect(trace.wasmSha).toBe(createHash("sha256").update(readFileSync(join(duelDataDir, trace.wasmFile))).digest("hex"));
  expect(trace.bot.seats.map((seat) => seat.policy)).toEqual(["practice", "practice"]);
  await info.attach("real-domain-core", { body: JSON.stringify(trace, null, 2), contentType: "application/json" });
}

/** A legal singleton 60-card Domain deck from this stack's read-only catalog. */
export function legalDomainUpload(): { name: string; mimeType: string; buffer: Buffer } {
  const deck = buildPracticeBotDeck("domain", duelDataDir);
  const lines = ["#created by ffa3 elimination smoke", "#main", ...deck.main.map(String), "#extra", ...deck.extra.map(String), "!side", "#deckmaster", String(deck.deckMaster)];
  return { name: "ffa3-domain-smoke.ydk", mimeType: "text/plain", buffer: Buffer.from(`${lines.join("\n")}\n`) };
}
