import { describe, expect, vi } from "vitest";
import { OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { DuelAnswer } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";

const messages = vi.hoisted(() => [] as OcgMessage[]);
vi.mock("ocgcore-wasm", async (original) => {
  const actual = await original<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (...args: Parameters<typeof actual.default>) => {
    const core = await actual.default(...args);
    const get = core.duelGetMessage.bind(core);
    core.duelGetMessage = ((handle: never) => {
      const batch = get(handle) as OcgMessage[];
      messages.push(...batch);
      return batch;
    }) as typeof core.duelGetMessage;
    return core;
  } };
});

const STONE = 13039848;
const AXE = 48305365;
const CONTROLLER = 98045062;
const FILLER = 69247929;
const deck = (head: number[]) => ({ main: [...head, ...Array(20 - head.length).fill(FILLER)], extra: [], side: [] });

describe("Enemy Controller reproduction", () => {
  for (const [engine, create, format] of [["legacy", createLegacyEngineGame, "1v1"], ["pinned", createEngineGame, "1v1"], ["three-player", createEngineGame, "ffa3"]] as const) {
    const pairs = format === "ffa3" ? [[0, 1], [1, 0], [1, 2]] as const : [[0, 1], [1, 0]] as const;
    for (const [activator, defender] of pairs) {
      for (const phase of ["main1", "battle"] as const) {
        const required = [needs.cards(), needs.scripts(), ...(format === "ffa3" ? [needs.installedMulti()] : engine === "pinned" ? [needs.standard()] : [])];
        itWithCores(`${engine}: seat ${activator} changes seat ${defender}'s position in ${phase}; combat uses DEF`, required, async () => {
          messages.length = 0;
          const viewers = [0, 1, ...(format === "ffa3" ? [2] : [])];
          const game = await create({ mode: "normal", format, dataDirectory: engineDataDirectory,
            seed: ["11", "22", "33", "44"],
            decks: viewers.map((seat) => deck(seat === activator ? [AXE, CONTROLLER] : seat === defender ? [STONE] : [])),
            settings: { ...defaultDuelSettings("normal"), validateDeck: false, shuffleDeck: false, banlist: "none" },
          });
          let activated = false;
          let attacked = false;
          // FFA forbids Battle Phase for every seat's first turn.
          const activationTurn = format === "ffa3" ? 4 + activator : activator === 0 ? 3 : 2;
          try {
            for (let step = 0; step < 100; step++) {
              const seat = viewers.find((seat) => game.view(seat).prompt)!;
              const view = game.view(seat);
              const prompt = view.prompt!;
              expect(prompt).toBeTruthy();
              const ids = prompt.options.map((o) => o.id);
              let answer: DuelAnswer | undefined;
              const summonCode = view.turn === seat + 1 ? seat === activator ? AXE : seat === defender ? STONE : 0 : 0;
              const summon = prompt.options.find((o) => o.id.startsWith("summon:") && o.card?.code === summonCode);
              const activate = prompt.options.find((o) => o.card?.code === CONTROLLER && /^(activate|chain):/.test(o.id));
              if (summon) answer = { choice: summon.id };
              else if (seat === activator && view.turn === activationTurn && !activated && activate && (view.phase === phase || phase === "battle" && view.phase.startsWith("battle"))) {
                activated = true; answer = { choice: activate.id };
              } else if (seat === activator && activated && ids.includes("opt:0")) {
                answer = { choice: "opt:0" };
              } else if (seat === activator && activated && prompt.kind === "cards" && prompt.options.some((o) => o.card?.code === STONE)) {
                answer = { selected: [prompt.options.find((o) => o.card?.code === STONE)!.id] };
              } else if (seat === activator && view.turn === activationTurn && ids.includes("to_bp")) answer = { choice: "to_bp" };
              else if (seat === activator && activated && !attacked && ids.some((id) => id.startsWith("attack:"))) {
                const snapshots = viewers.map((viewer) => game.view(viewer));
                expect(messages.filter((m) => m.type === OcgMessageType.POS_CHANGE)).toContainEqual(expect.objectContaining({code:STONE, controller:defender, prev_position:OcgPosition.FACEUP_ATTACK, position:OcgPosition.FACEUP_DEFENSE}));
                for (const snapshot of snapshots) {
                  expect(snapshot.seats[defender]!.monsters[0]).toMatchObject({code:STONE,position:OcgPosition.FACEUP_DEFENSE});
                  expect(snapshot.events).toContainEqual(expect.objectContaining({kind:"position",fromPosition:1,toPosition:4}));
                }
                attacked = true; answer = { choice: ids.find((id) => id.startsWith("attack:"))! };
              } else if (attacked && ids.includes("to_m2")) break;
              if (!answer) answer = ids.includes("no") ? { choice: "no" } : ids.includes("to_ep") ? { choice: "to_ep" } : choosePracticeBotAnswer(prompt);
              game.answer(seat, prompt.id, answer);
            }
            expect(activated).toBe(true);
            expect(attacked).toBe(true);
            for (const viewer of viewers) {
              const view = game.view(viewer);
              expect(view.seats[defender]!.lp).toBe(8000);
              expect(view.seats[activator]!.lp).toBe(7700);
              expect(view.seats[defender]!.monsters[0]?.code).toBe(STONE);
              expect(view.seats[activator]!.monsters[0]?.code).toBe(AXE);
            }
            expect(messages).toContainEqual(expect.objectContaining({
              type: OcgMessageType.BATTLE,
              card: expect.objectContaining({ attack: 1700 }),
              target: expect.objectContaining({ position: 4, defense: 2000 }),
            }));
          } finally { game.close(); }
        });
      }
    }
  }
});
