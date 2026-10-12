import { seatCountFor } from "@yugidraft/shared/duels";
import { expect } from "vitest";
import type { createEngineGame } from "../../src/engine.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { compileBoard } from "../support/board.js";
import type { Scenario } from "../support/dsl.js";
import { activate, defineScenario, raw, zone } from "../support/dsl.js";
import { Session } from "../support/session.js";

/** Exercise the real engine and replay precisely the same seat/prompt/answer records. */
export async function runChainActivatorScenario(scenario: Scenario, create: typeof createEngineGame, multiWasmBinary?: ArrayBuffer): Promise<void> {
  const options = {
    ...compileBoard(scenario.setup).options,
    dataDirectory: engineDataDirectory,
    seed: ["1", "2", "3", "4"],
    ...(multiWasmBinary ? { multiWasmBinary } : {}),
  };
  const game = await create(options);
  const commands: Parameters<typeof game.answer>[] = [];
  const answer = game.answer;
  game.answer = (...args) => {
    const result = answer(...args);
    commands.push(structuredClone(args));
    return result;
  };
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
    const viewers = [...Array.from({ length: seatCountFor(scenario.setup.format ?? "1v1") }, (_, seat) => seat), null];
    for (const viewer of viewers) {
      const view = game.view(viewer);
      expect(view.chain).toMatchObject([{ seat: 0, name: "Mausoleum of the Emperor", zone: { controller: 1, location: 8, sequence: 5 } }]);
      expect(view.events.find((event) => event.kind === "activate")).toMatchObject({
        seat: 0, text: "Mausoleum of the Emperor is activating", zone: { controller: 1, location: 8, sequence: 5 },
      });
      expect(view.log.map((line) => line.text).filter((text) => text.endsWith(" is activating"))).toEqual([
        scenario.setup.format === "1v1" ? "Mausoleum of the Emperor is activating" : "Player 1's Mausoleum of the Emperor is activating",
      ]);
      expect(view.prioritySeat).toBe(1);
      if (viewer !== 1) expect(view.prompt).toBeNull();
      if (viewer !== 0) {
        for (const card of view.seats[0].hand) {
          expect(card.code).toBeUndefined();
          expect(card.name).toBeUndefined();
        }
      }
    }
    const replay = await create(options);
    try {
      for (const command of commands) replay.answer(...command);
      for (const viewer of viewers) expect(replay.view(viewer)).toEqual(game.view(viewer));
    } finally { replay.close(); }
  } finally { game.close(); }
}

/** Mandatory Quick Effects can all be selected before the core announces any of their links. */
export async function runQueuedChainActivatorScenario(create: typeof createEngineGame, bothSeatsChoose: boolean): Promise<void> {
  const scenario = defineScenario({
    id: "queued-mandatory-chain-activators", title: "Forced ordering answers belong to their selected cards",
    source: "Light and Darkness Dragon mandatory Quick Effect; native QuickEffect/AddChain ordering",
    tags: ["chain", "trigger", "segoc"],
    setup: {
      p0: { hand: ["Raigeki"], monsters: Array(bothSeatsChoose ? 2 : 1).fill("Light and Darkness Dragon") },
      p1: { monsters: ["Light and Darkness Dragon", "Light and Darkness Dragon"], spells: [{ card: "Waboku", pos: "set" as const }] },
    },
    steps: [activate("Raigeki", "p0"), zone("p0", "s0", "p0"),
      ...(bothSeatsChoose ? [raw({ choice: "card:0" }, "p0")] : []), raw({ choice: "card:0" }, "p1")],
  });
  const game = await create({ ...compileBoard(scenario.setup).options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
    const seats = bothSeatsChoose ? [0, 0, 0, 1, 1] : [0, 0, 1, 1];
    for (const viewer of [0, 1, null]) {
      const view = game.view(viewer);
      expect(view.events.filter((event) => event.kind === "activate").map((event) => event.seat)).toEqual(seats);
      expect(view.chain.map((link) => link.seat)).toEqual(seats);
      expect(view.log.filter((line) => line.text.endsWith(" is activating"))).toHaveLength(seats.length);
    }
  } finally { game.close(); }
}
