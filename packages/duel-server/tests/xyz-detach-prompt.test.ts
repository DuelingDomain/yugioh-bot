import { describe, expect, it } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { compileBoard } from "./support/board.js";
import { describeWithCores } from "./support/cores.js";
import { activate, defineScenario, select, xyz, type Scenario } from "./support/dsl.js";
import { liveNseat } from "./support/live-nseat.js";
import { nseatWasmBinary, Session } from "./support/session.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Duel.RemoveOverlayCard (the detach of Ryzeal Duo Drive) asks with a card select. Each Xyz material must reach the client as
// an overlay card (LOCATION_OVERLAY, place under the monster) that names its Xyz, never as a card on the Xyz's own zone.
const OVERLAY = 0x80;
const MZONE = 0x04;
const DUO_DRIVE = 7511613;

function scenario(setup: Scenario["setup"]): Scenario {
  return defineScenario({
    id: "xyz-detach-prompt", title: "Detach prompt of Ryzeal Duo Drive", source: "Ryzeal Duo Drive (2): detach 2 materials",
    tags: ["xyz", "detach", `card:${DUO_DRIVE}`], setup, steps: [activate("Ryzeal Duo Drive")],
  });
}

async function openDetach(setup: Scenario["setup"], multi = false): Promise<{ prompt: DuelPrompt; close: () => void; session: Session; game: Awaited<ReturnType<typeof createEngineGame>> }> {
  const scene = scenario(setup);
  const compiled = compileBoard(scene.setup);
  const game = await createEngineGame({
    ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...(multi ? { multiWasmBinary: nseatWasmBinary() } : {}),
  });
  const session = new Session(scene, game);
  session.reachMainPhase();
  session.run(scene.steps[0]!, 1);
  const prompt = game.view(0).prompt;
  if (!prompt) throw new Error("Expected the detach prompt");
  return { prompt, close: () => game.close(), session, game };
}

const DECK = ["Ryzeal Cross", "Ryzeal Detonator", "Ryzeal Mass Driver"];

describe("Xyz detach prompt (1v1)", () => {
  it("lists each material as an overlay card with its Xyz as host", async () => {
    const { prompt, close } = await openDetach({
      p0: { monsters: [xyz("Ryzeal Duo Drive", ["Celtic Guardian", "Axe Raider", "Mystical Elf"])], deck: DECK },
    });
    try {
      expect(prompt.kind).toBe("cards");
      expect([prompt.min, prompt.max]).toEqual([2, 2]);
      expect(prompt.options.map((option) => option.card?.name)).toEqual(["Celtic Guardian", "Axe Raider", "Mystical Elf"]);
      expect(prompt.options.map((option) => [option.controller, option.location, option.sequence])).toEqual([[0, OVERLAY, 0], [0, OVERLAY, 1], [0, OVERLAY, 2]]);
      for (const option of prompt.options) {
        expect(option.host).toEqual({ controller: 0, location: MZONE, sequence: 0, code: DUO_DRIVE, name: "Ryzeal Duo Drive" });
      }
    } finally {
      close();
    }
  });

  it("names the Xyz of each material when two Xyz monsters hold them, and detaches the picked ones", async () => {
    const { prompt, close, session, game } = await openDetach({
      p0: {
        monsters: [xyz("Ryzeal Duo Drive", ["Celtic Guardian", "Axe Raider"]), xyz("Number 39: Utopia", ["Battle Ox", "Beaver Warrior"])],
        deck: DECK,
      },
    });
    try {
      expect(prompt.options).toHaveLength(4);
      expect(prompt.options.map((option) => [option.host?.sequence, option.host?.name, option.sequence])).toEqual([
        [0, "Ryzeal Duo Drive", 0], [0, "Ryzeal Duo Drive", 1], [1, "Number 39: Utopia", 0], [1, "Number 39: Utopia", 1],
      ]);
      // Pick one material of each Xyz: the answer is the option ids, as for any card select.
      session.run(select("Axe Raider", "Battle Ox"), 2);
      const view = game.view(0);
      expect(view.seats[0].monsters[0]?.materials?.map((m) => m.code)).toHaveLength(1);
      expect(view.seats[0].monsters[1]?.materials?.map((m) => m.code)).toHaveLength(1);
      expect(view.seats[0].graveyard.map((c) => c.name).sort()).toEqual(["Axe Raider", "Battle Ox"]);
    } finally {
      close();
    }
  });
});

describeWithCores("Xyz detach prompt (Tag)", liveNseat, () => {
  it("lists each material as an overlay card with its Xyz as host", async () => {
    const { prompt, close } = await openDetach({
      format: "tag",
      p0: { monsters: [xyz("Ryzeal Duo Drive", ["Celtic Guardian", "Axe Raider", "Mystical Elf"])], deck: DECK }, p1: {}, p2: {}, p3: {},
    }, true);
    try {
      expect(prompt.options.map((option) => [option.controller, option.location, option.sequence])).toEqual([[0, OVERLAY, 0], [0, OVERLAY, 1], [0, OVERLAY, 2]]);
      expect(prompt.options.every((option) => option.host?.name === "Ryzeal Duo Drive" && option.host.location === MZONE)).toBe(true);
    } finally {
      close();
    }
  });
});
