import { beforeEach, expect, it, vi } from "vitest";
import { OcgMessageType, type OcgCoreSync, type OcgMessage } from "ocgcore-wasm";
import { seatCountFor, type DuelAnswer, type DuelEngineView, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame, type EngineStartupScript } from "../src/engine.js";
import { createEngineGame as createLegacyGame } from "../src/legacy/engine.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { describeWithCores, needs } from "./support/cores.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";

// Legacy has no startup hook. Seed the same Debug board in both real engines,
// and record messages without changing the core's prompts or responses.
const fixture = vi.hoisted(() => ({ scripts: [] as EngineStartupScript[], messages: [] as OcgMessage[] }));
vi.mock("ocgcore-wasm", async importOriginal => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: { sync: true }) => {
    const core = await actual.default(options);
    const start = core.startDuel, read = core.duelGetMessage;
    core.startDuel = ((handle) => {
      for (const script of fixture.scripts) if (!core.loadScript(handle, script.name, script.content)) throw Error(`Cannot load ${script.name}`);
      return start(handle);
    }) as OcgCoreSync["startDuel"];
    core.duelGetMessage = ((handle) => {
      const messages = read(handle);
      fixture.messages.push(...messages);
      return messages;
    }) as OcgCoreSync["duelGetMessage"];
    return core;
  } };
});
beforeEach(() => { fixture.scripts = []; fixture.messages = []; });

const HONEST = 37742478, LANCE = 27243130, LILY = 79575620, DRAGON = 89631139, DEFENDER = 43096270;
const WARRIOR = 7572887, RAT = 97017120, JAMMER = 77414722, MIRROR_FORCE = 44095762, MST = 5318639;
const ids = ["p0", "p1", "p2", "p3"] as const;

async function open(format: DuelFormat, mode: DuelMode, legacy: boolean, auto: boolean, holder: number, effect: number, keepDamageStepWindows = true): Promise<EngineGame> {
  const board: BoardSpec = { format, mode, attackFirstTurn: true, skipOpeningDraw: true,
    p0: { monsters: [effect === LILY ? LILY : DRAGON] },
    p1: { monsters: [effect === WARRIOR || effect === RAT ? effect : DEFENDER], deck: ["Beaver Warrior"] } };
  for (let seat = 0; seat < seatCountFor(format); seat++) {
    board[ids[seat]!] ??= {};
    if (mode === "domain") board[ids[seat]!]!.deckMaster = "Mystical Elf";
  }
  if (effect === HONEST) board[ids[holder]!]!.hand = [HONEST];
  if (effect === LANCE) board[ids[holder]!]!.spells = [LANCE, MIRROR_FORCE, MST].map(card => ({ card, pos: "set" }));
  if (effect === JAMMER) {
    board.p0!.spells = [{ card: LANCE, pos: "set" }];
    board[ids[holder]!]!.spells = [{ card: JAMMER, pos: "set" }];
    board[ids[holder]!]!.hand = ["Mystical Elf"];
  }
  const compiled = compileBoard(board);
  fixture.scripts = legacy ? compiled.options.startupScripts! : [];
  const create = legacy ? createLegacyGame as unknown as typeof createEngineGame : createEngineGame;
  return create({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"], keepDamageStepWindows,
    settings: { ...compiled.options.settings!, stopAtEveryWindow: !auto } });
}

function drive(game: EngineGame, decide: (view: DuelEngineView) => DuelAnswer | "stop" | undefined): void {
  let attacked = false;
  for (let guard = 0; guard < 150; guard++) {
    const view = game.view(0).seats.map(s => game.view(s.seat)).find(v => v.prompt);
    if (!view?.prompt) throw Error("No prompt");
    const prompt = view.prompt;
    const answer = decide(view);
    if (answer === "stop") return;
    let fallback: DuelAnswer;
    const option = prompt.options.find(o => o.id === "to_bp" || !attacked && o.id.startsWith("attack:"));
    if (option) {
      if (option.id.startsWith("attack:")) attacked = true;
      fallback = { choice: option.id };
    } else if (prompt.kind === "choice" && /attack target/i.test(prompt.title)) {
      const target = prompt.options.find(o => o.controller === 1 && o.location === 4)!;
      fallback = { choice: target.id };
    } else if (prompt.context?.type === "chain" && prompt.cancelable) fallback = { cancel: true };
    else if (prompt.options.some(o => o.id === "no")) fallback = { choice: "no" };
    else if (attacked && prompt.options.some(o => o.id === "to_m2")) return;
    else fallback = choosePracticeBotAnswer(prompt);
    game.answer(prompt.seat, prompt.id, answer ?? fallback);
  }
  throw Error("Battle did not finish");
}

for (const legacy of [false, true]) for (const mode of ["normal", "domain"] as const) for (const auto of [false, true]) {
  describeWithCores(`Damage Step: ${legacy ? "legacy" : "current"} ${mode} ${auto ? "Auto" : "Always"}`,
    [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
      for (const format of (legacy ? ["1v1"] : ["1v1", "tag", "ffa3", "ffa4"]) as DuelFormat[]) {
        testEffect(format, HONEST, 1, "defender's Honest", "damage");
        testEffect(format, LILY, 0, "Injection Fairy Lily", "damage-calculation");
        if (auto) it(`${format}: v7 Auto still passes the defender's zero-hint Honest windows`, async () => {
          const game = await open(format, mode, legacy, auto, 1, HONEST, false);
          try {
            drive(game, view => {
              if (view.battleStep === "damage") expect(view.prompt!.options.some(o => o.card?.code === HONEST)).toBe(false);
              return undefined;
            });
            expect(game.view(null).seats[1]!.lp).toBe((format === "tag" ? 16000 : 8000) - 1000);
            expect(game.view(1).seats[1]!.hand.some(c => c.code === HONEST)).toBe(true);
          } finally { game.close(); }
        });
        if (auto) it(`${format}: Off still passes optional Damage Step windows`, async () => {
          const game = await open(format, mode, legacy, auto, 1, HONEST);
          try {
            for (let seat = 0; seat < seatCountFor(format); seat++) game.setChainMode(seat, "off");
            drive(game, view => {
              expect(view.prompt!.options.some(o => o.card?.code === HONEST)).toBe(false);
              return undefined;
            });
            expect(game.view(null).seats[1]!.lp).toBe((format === "tag" ? 16000 : 8000) - 1000);
            expect(game.view(1).seats[1]!.hand.some(c => c.code === HONEST)).toBe(true);
          } finally { game.close(); }
        });
        for (let seat = 0; seat < seatCountFor(format); seat++) testEffect(format, LANCE, seat, `p${seat}'s Forbidden Lance`, "before-damage-calculation");
        it(`${format}: offers a counter trap to p${seatCountFor(format) - 1} during the Damage Step`, async () => {
          const holder = seatCountFor(format) - 1;
          const game = await open(format, mode, legacy, auto, holder, JAMMER);
          try {
            const activated = new Set<number>();
            drive(game, view => {
              const prompt = view.prompt!;
              if (view.battleStep === "damage") {
                const option = prompt.options.find(o => [LANCE, JAMMER].includes(o.card?.code ?? 0));
                if (option && !activated.has(option.card!.code)) {
                  activated.add(option.card!.code);
                  return { choice: option.id };
                }
              }
              if (activated.has(LANCE) && prompt.kind === "cards" && prompt.seat === 0) {
                return { selected: [prompt.options.find(o => o.card?.code === DRAGON)!.id] };
              }
              return undefined;
            });
            expect([...activated].sort()).toEqual([LANCE, JAMMER].sort());
            expect(game.view(null).seats[1]!.lp).toBe((format === "tag" ? 16000 : 8000) - 1000);
          } finally { game.close(); }
        });
        for (const [code, step] of [[WARRIOR, "after-damage-calculation"], [RAT, "damage-end"]] as const) {
          it(`${format}: labels ${code === RAT ? "Giant Rat" : "D.D. Warrior Lady"}'s trigger as ${step}`, async () => {
            const game = await open(format, mode, legacy, auto, 1, code);
            try {
              let offered = false;
              drive(game, view => {
                if (view.prompt?.source?.code !== code || !view.prompt.options.some(o => o.id === "yes")) return undefined;
                offered = true;
                for (const viewer of [...Array.from({ length: seatCountFor(format) }, (_, seat) => seat), null]) {
                  expect(game.view(viewer).battleStep).toBe(step);
                }
                return "stop";
              });
              expect(offered).toBe(true);
            } finally { game.close(); }
          });
        }
      }

      function testEffect(format: DuelFormat, code: number, holder: number, label: string, step: string) {
        // Registered through the existing real-core gate; no mocked battle state.
        it(`${format}: offers ${label} in ${step}`, async () => {
          const game = await open(format, mode, legacy, auto, holder, code);
          try {
            const offered: string[] = [];
            let activated = false;
            drive(game, view => {
              const prompt = view.prompt!;
              const option = prompt.options.find(o => o.card?.code === code && (o.id.startsWith("card:") || o.id.startsWith("activate:")));
              if (option && prompt.seat === holder && ["damage", "before-damage-calculation", "damage-calculation"].includes(view.battleStep ?? "")) {
                offered.push(view.battleStep!);
                expect(prompt.options.some(o => [MIRROR_FORCE, MST].includes(o.card?.code ?? 0))).toBe(false);
                if (!activated && view.battleStep === step) {
                  for (const viewer of [...Array.from({ length: seatCountFor(format) }, (_, seat) => seat), null]) {
                    expect(game.view(viewer).battleStep).toBe(step);
                    if (viewer !== holder) expect(game.view(viewer).prompt).toBeNull();
                  }
                  // Changing Always to Auto must keep the same eligible zero-hint window.
                  if (!auto) {
                    expect(game.setChainMode(holder, "auto")).toBe(false);
                    expect(game.view(holder).prompt!.id).toBe(prompt.id);
                  }
                  activated = true;
                  return { choice: option.id };
                }
              }
              if (code === LANCE && activated && prompt.kind === "cards") {
                const target = prompt.options.find(o => o.controller === 0 && o.card?.code === DRAGON)!;
                return { selected: [target.id] };
              }
              return undefined;
            });
            expect(offered).toContain(step);
            if (code === LANCE) expect(offered).toContain("damage");
            expect(game.view(null).events.some(e => e.kind === "activate" && e.card?.code === code)).toBe(true);
            expect(game.view(null).seats[code === HONEST ? 0 : 1]!.lp).toBe(
              (format === "tag" ? 16000 : 8000) - (code === HONEST ? 2000 : code === LANCE ? 200 : 1400));
            if (code === HONEST && auto) {
              expect(fixture.messages.some(m => m.type === OcgMessageType.SELECT_CHAIN && m.player === holder
                && m.spe_count === 0 && m.selects.some(c => c.code === HONEST))).toBe(true);
            }
          } finally { game.close(); }
        });
      }
    });
}
