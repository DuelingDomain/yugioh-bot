import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgCoreSync } from "ocgcore-wasm";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import type { CardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";

const monster: DuelCardInfo = {
  code: 13039848, name: "Giant Soldier of Stone", type: 17,
  attack: 1300, defense: 2000, level: 3, attribute: 1, race: "Rock", description: "A rock warrior.",
};
const cards = { get: () => monster, counter: () => undefined } as unknown as CardDatabase;

describe("Enemy Controller position projection", () => {
  for (const [path, mapping, format, controllers, viewers] of [
    ["legacy", legacy, "1v1", [0, 1], [0, 1, null]],
    ["merged", merged, "1v1", [0, 1], [0, 1, null]],
    ["three-player", merged, "ffa3", [0, 1, 2], [0, 1, 2, null]],
  ] as const) {
    for (const controller of controllers) {
      for (const phase of ["main1", "battle_start", "battle"] as const) {
        it(`${path}: target at seat ${controller} remains in Defense for every viewer in ${phase}`, () => {
          const message = {
            type: OcgMessageType.POS_CHANGE, code: monster.code,
            controller, location: OcgLocation.MZONE, sequence: 0,
            prev_position: OcgPosition.FACEUP_ATTACK, position: OcgPosition.FACEUP_DEFENSE,
          } as const;
          const stored = path === "legacy"
            ? legacy.observeDuelEvent(message as never, cards, [], 1, legacy.createEventContext())!
            : merged.observeDuelEvent(message as never, cards, [], 1, merged.createEventContext(format))!;
          let position: number = OcgPosition.FACEUP_ATTACK;
          const lib = {
            duelQueryField: () => ({ players: [{ deck_size: 20, extra_size: 0 }, { deck_size: 20, extra_size: 0 }], chain: [] }),
            duelQueryCount: () => 0,
            duelQueryLocation: (_handle: unknown, query: { controller: number; location: number }) =>
              query.controller === controller && query.location === OcgLocation.MZONE
                ? [{ code: monster.code, position, attack: 1300, defense: 2000 }] : [],
          } as unknown as OcgCoreSync;
          const view = (viewer: number | null) => mapping.projectView({
            lib, handle: {} as never, cards, viewer, format, revision: 2, turn: 2, turnSeat: 0, phase,
            lp: [8000, 8000], prompt: null, promptSeat: null, log: [], events: [stored],
            result: null, reveals: path === "legacy" ? legacy.createRevealMap() : merged.createRevealMap(viewers.length - 1), mode: "normal",
          } as never);
          for (const viewer of viewers) expect(view(viewer).seats[controller]?.monsters[0]?.position).toBe(1);
          position = message.position;
          for (const viewer of viewers) {
            const projected = view(viewer);
            expect(projected.seats[controller]?.monsters[0]).toMatchObject({ code: monster.code, position: 4 });
            expect(projected.events).toContainEqual(expect.objectContaining({
              kind: "position", fromPosition: 1, toPosition: 4,
              zone: { controller, location: OcgLocation.MZONE, sequence: 0 },
              text: "Giant Soldier of Stone changed to Defense Position", card: monster,
            }));
          }
        });
      }
    }
  }
});
