import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach } from "vitest";
import type { DuelAnswer, DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { compileBoard, type BoardSpec } from "../../src/presets/board.js";
import { engineDataDirectory } from "../engine-data-dir.js";

export const variants: Array<{ name: string; format: DuelFormat; legacy?: boolean }> = process.env.DM_BUG_VARIANTS === "pinned"
  ? [{ name: "pinned", format: "1v1" }]
  : [{ name: "pinned", format: "1v1" }, { name: "legacy core", format: "1v1", legacy: true },
    ...(["ffa3", "ffa4", "tag"] as const).map(format => ({ name: format, format }))];
export type Variant = typeof variants[number];
export type Fixture = { id: number; lua: string; type?: number; level?: number };
const roots: string[] = [];
const games: EngineGame[] = [];
const scriptFiles = readdirSync(join(engineDataDirectory, "card-scripts"), { recursive: true }).filter(name => String(name).endsWith(".lua")).map(String);
afterEach(() => {
  for (const game of games.splice(0)) game.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export async function gameFor(variant: Variant, board: BoardSpec, fixtures: Fixture[] = [], startup = ""): Promise<EngineGame> {
  const root = mkdtempSync(join(tmpdir(), "domain-rules-"));
  roots.push(root);
  copyFileSync(join(engineDataDirectory, "cards.cdb"), join(root, "cards.cdb"));
  symlinkSync(join(engineDataDirectory, "strings.conf"), join(root, "strings.conf"));
  const wasm = variant.format === "1v1" ? variant.legacy ? "ocgcore.domain.legacy.wasm" : "ocgcore.domain.wasm" : "ocgcore.multi-domain.wasm";
  symlinkSync(join(engineDataDirectory, wasm), join(root, variant.format === "1v1" ? "ocgcore.domain.wasm" : wasm));
  mkdirSync(join(root, "card-scripts"));
  const db = new Database(join(root, "cards.cdb"));
  for (const fixture of fixtures) {
    db.prepare("INSERT INTO datas (id,ot,alias,setcode,type,atk,def,level,race,attribute,category) VALUES (?,3,0,0,?,0,0,?,1,1,0)")
      .run(fixture.id, fixture.type ?? 2, fixture.level ?? 4);
    db.prepare("INSERT INTO texts (id,name,desc) VALUES (?,?,?)").run(fixture.id, `Domain rule probe ${fixture.id}`, "Test fixture.");
    writeFileSync(join(root, "card-scripts", `c${fixture.id}.lua`), fixture.lua);
  }
  db.close();
  const setup: BoardSpec = { mode: "domain", skipOpeningDraw: true, ...board, format: variant.format };
  for (const seat of ["p0", "p1", "p2", "p3"].slice(0, variant.format === "1v1" ? 2 : variant.format === "ffa3" ? 3 : 4) as Array<"p0" | "p1" | "p2" | "p3">) {
    setup[seat] = { deckMaster: "Axe Raider", ...setup[seat] };
  }
  const compiled = compileBoard(setup, root);
  const codes = new Set(compiled.codes);
  // Include all helpers and only the card scripts on this exact board. Keep real
  // directories: the engine's script index deliberately does not follow directory symlinks.
  for (const file of scriptFiles) {
    const card = /^c(\d+)\.lua$/.exec(basename(file));
    if (card && !codes.has(Number(card[1]))) continue;
    const target = join(root, "card-scripts", file);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(engineDataDirectory, "card-scripts", file), target);
  }
  if (variant.legacy) {
    rmSync(join(root, "card-scripts/domain.lua"));
    symlinkSync(join(engineDataDirectory, "card-scripts/domain.legacy.lua"), join(root, "card-scripts/domain.lua"));
  }
  const options = compiled.options;
  options.startupScripts![0]!.content += "\n" + startup;
  const game = await createEngineGame({ ...options, seed: ["1", "2", "3", "4"], dataDirectory: root,
    multiScriptsDirectory: join(engineDataDirectory, "multi-scripts") });
  games.push(game);
  settle(game);
  return game;
}

export function waiting(game: EngineGame): DuelPrompt {
  for (let seat = 0; seat < game.view(0).seats.length; seat++) {
    const prompt = game.view(seat).prompt;
    if (prompt) return prompt;
  }
  throw new Error("Engine stopped without a prompt");
}
export function respond(game: EngineGame, answer: DuelAnswer): void {
  const prompt = waiting(game);
  game.answer(prompt.seat, prompt.id, answer);
}
export function idle(prompt: DuelPrompt): boolean { return prompt.options.some(option => option.id === "to_ep"); }
export function defaultAnswer(prompt: DuelPrompt, recall = true): DuelAnswer {
  if (["places", "cards", "tribute"].includes(prompt.kind)) return { selected: prompt.options.slice(0, prompt.min ?? 1).map(option => option.id) };
  if (prompt.kind === "toggle") {
    if (prompt.finishable) return { finish: true };
    const option = prompt.options.find(option => !option.selected);
    assert(option, JSON.stringify(prompt));
    return { choice: option.id };
  }
  if (prompt.context?.type === "deck-master-recall") return { choice: recall ? "yes" : "no" };
  if (prompt.options.some(option => option.id === "yes")) return { choice: "yes" };
  const trigger = prompt.options.find(option => option.card);
  if (trigger) return { choice: trigger.id };
  if (prompt.cancelable) return { cancel: true };
  assert(prompt.options[0], JSON.stringify(prompt));
  return { choice: prompt.options[0].id };
}
export function settle(game: EngineGame, recall = true): void {
  for (let step = 0; step < 60; step++) {
    const prompt = waiting(game);
    if (idle(prompt)) return;
    respond(game, defaultAnswer(prompt, recall));
  }
  throw new Error(`Did not reach idle: ${JSON.stringify(waiting(game))}`);
}
export function act(game: EngineGame, code: number, prefix = "activate:"): void {
  const prompt = waiting(game);
  const option = prompt.options.find(option => option.card?.code === code && option.id.startsWith(prefix));
  assert(option, `Missing ${prefix}${code}: ${JSON.stringify(prompt)}`);
  respond(game, { choice: option.id });
  settle(game);
}
