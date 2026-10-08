import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessageSelectCard } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { filterPromptOptions, mapPrompt } from "../src/prompts.js";
import { createRevealMap, projectView } from "../src/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Pinned engine (Tag, FFA and merged 1v1): an Xyz material in a card select, and a card the core removes meanwhile.
const MATERIALS = [91152256, 48305365, 15025844]; // Celtic Guardian, Axe Raider, Mystical Elf
const XYZ = { controller: 0 as const, location: OcgLocation.MZONE, sequence: 2 };
const OVERLAY = OcgLocation.OVERLAY;
const cards = loadCardDatabase(engineDataDirectory);

function detach(): OcgMessageSelectCard {
  return {
    type: OcgMessageType.SELECT_CARD, player: 0, can_cancel: false, can_finish: false, min: 1, max: 2,
    selects: MATERIALS.map((code, place) => ({ code, ...XYZ, position: OcgPosition.FACEUP_ATTACK, overlay_sequence: place })),
  } as unknown as OcgMessageSelectCard;
}

const left = (pending: ReturnType<typeof mapPrompt>, removedCards: Parameters<typeof filterPromptOptions>[1]["removedCards"]) =>
  filterPromptOptions(pending, { removedCards }).prompt.options.map((option) => option.card?.code);

describe("Xyz materials in a card select", () => {
  const pending = mapPrompt(detach(), cards, "p");

  it("maps to overlay cards with the Xyz zone as host", () => {
    expect(pending.prompt.options.map((option) => [option.location, option.sequence])).toEqual([[OVERLAY, 0], [OVERLAY, 1], [OVERLAY, 2]]);
    for (const option of pending.prompt.options) expect(option.host).toEqual(XYZ);
  });

  it("drops only the removed material (Xyz zone + overlay_sequence)", () => {
    expect(left(pending, [{ ...XYZ, overlay_sequence: 1 }])).toEqual([MATERIALS[0], MATERIALS[2]]);
  });

  it("drops every material when its Xyz is removed", () => {
    const other = { code: 46986414, controller: 0, location: OcgLocation.MZONE, sequence: 4, position: OcgPosition.FACEUP_ATTACK };
    const withOther = mapPrompt({ ...detach(), selects: [...detach().selects, other] } as never, cards, "p");
    expect(left(withOther, [XYZ])).toEqual([46986414]);
    // A suspended required pick that would become impossible keeps its indices, as for any card.
    expect(filterPromptOptions(pending, { removedCards: [XYZ] }).prompt.options).toHaveLength(3);
  });

  it("does not drop materials for a removed card of another zone", () => {
    expect(left(pending, [{ ...XYZ, sequence: 3 }, { ...XYZ, sequence: 3, overlay_sequence: 0 }])).toEqual(MATERIALS);
  });

  it("does not drop a card on the Xyz zone when only a material left it", () => {
    const board = mapPrompt({ ...detach(), selects: [{ code: 46986414, ...XYZ, position: OcgPosition.FACEUP_ATTACK }, ...detach().selects] } as never, cards, "p");
    expect(left(board, [{ ...XYZ, overlay_sequence: 0 }])).toEqual([46986414, MATERIALS[1], MATERIALS[2]]);
  });
});

describe("Xyz materials seen by a viewer who cannot see the Xyz", () => {
  it("are unknown cards, not face-down cards, and keep their place and host", () => {
    const vacant = { position: 0, materials: 0 };
    const player = { monsters: Array(7).fill(vacant), spells: Array(8).fill(vacant),
      deck_size: 0, hand_size: 0, grave_size: 0, banish_size: 0, extra_size: 0, extra_faceup_count: 0 };
    const view = projectView({
      lib: {
        duelQueryField: () => ({ flags: 0n, players: [player, player], chain: [] }),
        duelQueryLocation: (_handle: unknown, zone: { controller: number; location: number }) =>
          zone.controller === 0 && zone.location === OcgLocation.MZONE ? [null, null, { code: 7511613, position: OcgPosition.FACEDOWN_DEFENSE, level: 4 }] : [],
      } as never,
      handle: {} as never, cards, viewer: 1, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: { ...mapPrompt(detach(), cards, "p").prompt, seat: 1 }, promptSeat: 1, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal",
    });
    for (const option of view.prompt!.options) {
      expect(option.label).toBe("Unknown card");
      expect(option.card).toBeUndefined();
      expect(option.host).toEqual(XYZ);
    }
    expect(view.prompt!.options.map((option) => option.sequence)).toEqual([0, 1, 2]);
  });
});
