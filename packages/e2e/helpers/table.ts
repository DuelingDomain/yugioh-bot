import { expect, type Page, type TestInfo } from "@playwright/test";
import type { DuelAnswer, DuelEngineView, DuelPrompt, DuelRoom } from "@yugidraft/shared/duels";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { duelDataDir } from "../stack/env.mjs";
import { enterDuelRoom } from "./duel";
import type { PromptTraceEntry } from "../../duel-server/src/prompt-trace";

export const tableField = (page: Page, seat: number) => page.locator(`[data-table-stage] [data-seat-field='${seat}']`);
export const tableLp = (page: Page, seat: number) => page.locator(`[data-table-stage] [data-lp-seat='${seat}']`);
export async function readTable(page: Page, slug: string): Promise<DuelRoom> {
  const response = await page.request.get(`/api/duels/${slug}`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

export interface TableTrace {
  wasmFile: string;
  wasmSha: string;
  seats: Array<{ seat: number; view: DuelEngineView; prompt?: DuelPrompt }>;
  bot: { seats: Array<{ seat: number; policy: string }> };
  promptLog: PromptTraceEntry[];
}

export async function readTableTrace(page: Page, slug: string): Promise<TableTrace> {
  const response = await page.request.get(`/api/duels/${slug}/debug-trace`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** Proves the running host loaded this snapshot's real n-seat wasm, rather than fixtures. */
export async function expectRealCore(page: Page, slug: string, bots: "practice" | "scripted", info: TestInfo, botCount = 2): Promise<void> {
  const trace = await readTableTrace(page, slug);
  expect(trace.wasmFile).toBe("ocgcore.multi.wasm");
  expect(trace.wasmSha).toBe(createHash("sha256").update(readFileSync(join(duelDataDir, trace.wasmFile))).digest("hex"));
  expect(trace.bot.seats.map((seat) => seat.policy)).toEqual(Array(botCount).fill(bots));
  await info.attach("real-core", { body: JSON.stringify(trace, null, 2), contentType: "application/json" });
}

export async function startTablePreset(page: Page, id: string): Promise<string> {
  const response = await page.request.post("/api/duels/preset", { data: { presetId: id, seed: ["11", "22", "33", "44"] } });
  expect(response.ok(), await response.text()).toBe(true);
  const { slug } = await response.json() as { slug: string };
  await page.goto(`/duels/${slug}?window=1`);
  await enterDuelRoom(page);
  await expect(page.locator("[data-table-shell]")).toBeVisible();
  return slug;
}

export async function answerTable(page: Page, slug: string, engine: DuelEngineView, answer: DuelAnswer): Promise<void> {
  expect(engine.prompt?.seat).toBe(0);
  const response = await page.request.post(`/api/duels/${slug}/actions`, {
    data: { revision: engine.revision, promptId: engine.prompt!.id, answer },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Records browser-visible turn indicators, including the bots' short turns. No engine state is injected. */
export async function observeTable(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Seen = { turn: number; seat: number; who: string; battleOffered: boolean };
    const state = window as typeof window & { tableTurns: Seen[]; tableObserver?: MutationObserver };
    state.tableObserver?.disconnect();
    state.tableTurns = [];
    const sample = () => {
      const stage = document.querySelector("[data-table-stage]");
      const ring = stage?.querySelector("[data-turn-ring]");
      const arc = ring?.querySelector("[data-arc][data-lit='true']");
      if (!arc) return;
      const record = {
        turn: Number(ring?.querySelector("text")?.textContent),
        seat: Number(arc.getAttribute("data-arc")),
        who: document.querySelector("[data-testid='who-pill']")?.textContent ?? "",
        battleOffered: [...document.querySelectorAll("button")].some((button) => /^To Battle/.test(button.textContent ?? "")),
      };
      if (JSON.stringify(record) !== JSON.stringify(state.tableTurns.at(-1))) state.tableTurns.push(record);
    };
    state.tableObserver = new MutationObserver(sample);
    state.tableObserver.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    sample();
  });
}

export async function tableTurns(page: Page): Promise<Array<{ turn: number; seat: number; who: string; battleOffered: boolean }>> {
  return page.evaluate(() => (window as typeof window & { tableTurns: Array<{ turn: number; seat: number; who: string; battleOffered: boolean }> }).tableTurns);
}

export function collectTableErrors(page: Page, others: Page[] = []): string[] {
  const errors: string[] = [];
  const record = (opened: Page) => {
    opened.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    opened.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  };
  for (const context of new Set([page, ...others].map((opened) => opened.context()))) {
    for (const opened of context.pages()) record(opened);
    context.on("page", record);
  }
  return errors;
}

/** A screenshot and the corresponding real engine view in the ordinary Playwright output folder. */
export async function tableShot(page: Page, slug: string, info: TestInfo, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath(`live-ffa3-${name}.png`), fullPage: true, animations: "disabled" });
  writeFileSync(info.outputPath(`live-ffa3-${name}.json`), JSON.stringify(await readTable(page, slug), null, 2));
}
