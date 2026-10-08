import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, type OcgMessageSelectCard } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { mapPrompt, resolveAnswer } from "../src/legacy/prompts.js";
import { createRevealMap, projectView } from "../src/legacy/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Production 1v1 runs the legacy engine. Its SELECT_CARD for a detach cost (Ryzeal Duo Drive) names each Xyz material by
// the Xyz's zone plus overlay_sequence. The prompt must show it as an overlay card with its Xyz as host.
const DUO_DRIVE = 7511613;
const MATERIALS = [91152256, 48305365, 15025844]; // Celtic Guardian, Axe Raider, Mystical Elf
const XYZ_ZONE = { controller: 0 as const, location: OcgLocation.MZONE, sequence: 2 };

const cards = loadCardDatabase(engineDataDirectory);

function detach(): OcgMessageSelectCard {
  return {
    type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, can_finish: false, min: 2, max: 2,
    selects: MATERIALS.map((code, place) => ({ code, ...XYZ_ZONE, position: OcgPosition.FACEUP_ATTACK, overlay_sequence: place })),
  } as unknown as OcgMessageSelectCard;
}

function project(viewer: 0 | 1, position: number, prompt = mapPrompt(detach(), cards, "p", "Select the Xyz Material(s) to detach").prompt) {
  const vacant = { position: 0, materials: 0 };
  const player = { monsters: Array(7).fill(vacant), spells: Array(8).fill(vacant),
    deck_size: 0, hand_size: 0, grave_size: 0, banish_size: 0, extra_size: 0, extra_faceup_count: 0 };
  return projectView({
    lib: {
      duelQueryField: () => ({ flags: 0n, players: [player, player], chain: [] }),
      duelQueryLocation: (_handle: unknown, zone: { controller: number; location: number }) => {
        if (zone.controller !== 0 || zone.location !== OcgLocation.MZONE) return [];
        const row = [null, null, { code: DUO_DRIVE, position, level: 4, overlay_cards: MATERIALS }];
        return row;
      },
    } as never,
    handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
    prompt: { ...prompt, seat: viewer }, promptSeat: viewer, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal",
  });
}

describe("legacy engine: Xyz materials in a card select", () => {
  it("maps each material to an overlay card (place under the Xyz) with the Xyz zone as host", () => {
    const { prompt } = mapPrompt(detach(), cards, "p", "Select the Xyz Material(s) to detach");
    expect(prompt).toMatchObject({ kind: "cards", min: 2, max: 2 });
    expect(prompt.options.map((option) => [option.controller, option.location, option.sequence])).toEqual([[0, 0x80, 0], [0, 0x80, 1], [0, 0x80, 2]]);
    for (const option of prompt.options) expect(option.host).toEqual(XYZ_ZONE);
    expect(prompt.options.map((option) => option.card?.code)).toEqual(MATERIALS);
  });

  it("answers card:2, card:0 with the engine indices 2 and 0", () => {
    const pending = mapPrompt(detach(), cards, "p");
    const response = resolveAnswer(pending, 0, "p", { selected: ["card:2", "card:0"] }, cards);
    expect(response.type).toBe(OcgResponseType.SELECT_CARD);
    expect([...(response as { indicies: number[] }).indicies].sort()).toEqual([0, 2]);
  });

  it("names the Xyz for its controller", () => {
    const view = project(0, OcgPosition.FACEUP_ATTACK);
    const options = view.prompt!.options;
    expect(options.map((option) => option.card?.code)).toEqual(MATERIALS);
    for (const option of options) expect(option.host).toMatchObject({ ...XYZ_ZONE, code: DUO_DRIVE, name: expect.stringContaining("Ryzeal Duo Drive") });
  });

  it("hides materials of a face-down Xyz from the opponent as unknown cards, not face-down cards", () => {
    // The opponent picks which of seat 0's materials go, and cannot see the face-down Xyz.
    const view = project(1, OcgPosition.FACEDOWN_DEFENSE);
    for (const option of view.prompt!.options) {
      expect(option.label).toBe("Unknown card");
      expect(option.card).toBeUndefined();
      expect(option.host).toEqual(XYZ_ZONE);
    }
    expect(view.prompt!.options.map((option) => option.sequence)).toEqual([0, 1, 2]);
  });
});
