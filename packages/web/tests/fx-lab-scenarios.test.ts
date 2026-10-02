import { describe, expect, it } from "vitest";
import type { DuelCard, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { applyEdits, numberSteps, scriptDurationMs, type LabBoard } from "@/components/duel/fx-lab/board";
import { LAB_CATEGORIES, LAB_SCENARIOS, findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { LOCATION_GRAVE, LOCATION_HAND, LOCATION_MZONE, LOCATION_REMOVED, LOCATION_SZONE } from "@/components/duel/constants";
import { CARDS } from "@/components/duel/fx-lab/cards";
import { groupScenes } from "@/components/duel/fx3d/scene-plan";

const KINDS = new Set<DuelEvent["kind"]>([
  "summon", "set", "activate", "chain-resolving", "chain-resolved", "chain-negated", "chain-end",
  "attack", "phase", "damage", "destroy", "move", "position", "equip",
]);

function cardAt(board: LabBoard, ref: DuelZoneRef): DuelCard | null | undefined {
  const seat = board.seats[ref.controller];
  if (!seat) return undefined;
  if (ref.location === LOCATION_MZONE) return seat.monsters[ref.sequence];
  if (ref.location === LOCATION_SZONE) return seat.spells[ref.sequence];
  if (ref.location === LOCATION_HAND) return seat.hand[ref.sequence];
  if (ref.location === LOCATION_GRAVE) return seat.graveyard[ref.sequence];
  if (ref.location === LOCATION_REMOVED) return seat.banished[ref.sequence];
  return undefined;
}

describe("fx lab scenarios", () => {
  it("has unique ids and every category is filled", () => {
    const ids = LAB_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of LAB_CATEGORIES) expect(scenariosIn(category).length).toBeGreaterThan(0);
    expect(LAB_SCENARIOS.every((scenario) => LAB_CATEGORIES.includes(scenario.category))).toBe(true);
    expect(findScenario("destroy-dark-hole")?.name).toBe("Dark Hole");
  });

  it("plays the right wipe piece, with the right number of victims, in each wipe scenario", () => {
    const expected: Array<[string, string, number]> = [
      ["destroy-dark-hole", "dark-hole", 5],
      ["destroy-dark-hole-one", "dark-hole", 1],
      ["destroy-dark-hole-full", "dark-hole", 10],
      ["destroy-raigeki", "raigeki", 3],
      ["destroy-raigeki-one", "raigeki", 1],
      ["destroy-raigeki-full", "raigeki", 5],
      ["destroy-feather-duster", "feather-duster", 3],
      ["destroy-feather-duster-one", "feather-duster", 1],
      ["destroy-feather-duster-full", "feather-duster", 5],
      ["destroy-heavy-storm", "heavy-storm", 4],
      ["destroy-heavy-storm-one", "heavy-storm", 1],
      ["destroy-heavy-storm-full", "heavy-storm", 9],
      ["destroy-banish-all", "banish-all", 4],
      ["destroy-banish-two", "banish-all", 2],
      ["destroy-banish-full", "banish-all", 9],
      ["destroy-torrential", "torrential", 3],
      ["destroy-torrential-one", "torrential", 1],
      ["destroy-torrential-full", "torrential", 10],
      ["destroy-mass", "mass-destroy", 3],
      ["destroy-mass-two", "mass-destroy", 2],
      ["destroy-mass-full", "mass-destroy", 5],
      ["destroy-mass-monster", "mass-destroy", 5],
      ["destroy-mirror-force", "mirror-force", 3],
      ["destroy-mirror-force-one", "mirror-force", 1],
      ["destroy-mirror-force-full", "mirror-force", 5],
      ["destroy-mirror-force-defense", "mirror-force", 3],
      ["destroy-mirror-force-one-defense", "mirror-force", 1],
      ["destroy-mirror-force-incoming", "mirror-force", 3],
      ["destroy-mirror-force-incoming-one", "mirror-force", 1],
      ["destroy-mirror-force-no-attack", "mirror-force", 3],
      ["destroy-mirror-force-opp", "mirror-force", 3],
      ["destroy-mirror-force-opp-full", "mirror-force", 5],
    ];
    for (const [id, piece, count] of expected) {
      const built = findScenario(id)?.build();
      expect(built, id).toBeDefined();
      const events = numberSteps(built!.steps, 100).flatMap((entry) => entry.events);
      const groups = groupScenes(events);
      expect(groups.map((g) => g.piece), id).toEqual([piece]);
      // A banish moves each card once; a destroy has a destroy event per card.
      expect(groups[0].events.length, id).toBe(count);
    }
  });

  it("gives every scenario a name and a description", () => {
    for (const scenario of LAB_SCENARIOS) {
      expect(scenario.name.length, scenario.id).toBeGreaterThan(3);
      expect(scenario.description.length, scenario.id).toBeGreaterThan(10);
    }
  });

  it("uses real passcodes on every fixture card", () => {
    for (const [key, card] of Object.entries(CARDS)) {
      expect(card.code, key).toBeGreaterThan(0);
      expect(card.name, key).not.toBe("");
    }
  });

  for (const scenario of LAB_SCENARIOS) {
    describe(scenario.id, () => {
      it("builds the same script twice (pure)", () => {
        expect(JSON.stringify(scenario.build())).toBe(JSON.stringify(scenario.build()));
      });

      it("has ordered steps and a positive duration", () => {
        const built = scenario.build();
        const times = built.steps.map((step) => step.at);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(times.every((at) => at >= 0)).toBe(true);
        expect(scriptDurationMs(built)).toBeGreaterThan(0);
        expect(built.initial.seats).toHaveLength(2);
      });

      it("builds valid events that match the board", () => {
        const built = scenario.build();
        const numbered = numberSteps(built.steps, 100);
        const ids = numbered.flatMap((entry) => entry.events.map((event) => event.id));
        expect(new Set(ids).size).toBe(ids.length);
        let before = built.initial;
        for (const { step, events } of numbered) {
          for (const event of events) {
            expect(KINDS.has(event.kind), `${scenario.id} kind ${event.kind}`).toBe(true);
            expect(event.text.length).toBeGreaterThan(0);
            if (event.kind.startsWith("chain-") && event.kind !== "chain-end") expect(event.chainIndex ?? 0).toBeGreaterThanOrEqual(1);
            if (event.kind === "activate") expect(event.chainIndex ?? 0).toBeGreaterThanOrEqual(1);
            if (["summon", "set", "attack", "destroy", "move", "position", "equip", "activate"].includes(event.kind)) {
              expect(event.zone, `${scenario.id} ${event.kind} needs a zone`).toBeDefined();
            }
            if (event.kind === "move") expect(event.from).toBeDefined();
            if (event.kind === "damage") expect(event.amount ?? 0).toBeGreaterThan(0);
            if (event.kind === "destroy" && event.zone) {
              const card = cardAt(before, event.zone) ?? cardAt(applyEdits(before, step.edits ?? []), event.zone);
              expect(card ?? null, `${scenario.id} destroy of an empty zone`).not.toBeNull();
            }
          }
          const after = applyEdits(before, step.edits ?? []);
          for (const event of events) {
            if (event.kind === "summon" && event.zone) {
              expect(cardAt(after, event.zone)?.code, `${scenario.id} summon lands on the board`).toBe(event.card?.code);
            }
          }
          before = after;
        }
      });

      it("keeps every card at its own coordinates", () => {
        const built = scenario.build();
        const boards = [built.initial];
        for (const step of built.steps) boards.push(applyEdits(boards[boards.length - 1], step.edits ?? []));
        for (const board of boards) {
          board.seats.forEach((seat, seatIndex) => {
            const lists: Array<[number, Array<DuelCard | null>]> = [
              [LOCATION_MZONE, seat.monsters],
              [LOCATION_SZONE, seat.spells],
              [LOCATION_HAND, seat.hand],
              [LOCATION_GRAVE, seat.graveyard],
              [LOCATION_REMOVED, seat.banished],
            ];
            for (const [location, list] of lists) {
              list.forEach((card, index) => {
                if (!card) return;
                expect(card.controller).toBe(seatIndex);
                expect(card.location).toBe(location);
                if (location === LOCATION_HAND) {
                  expect(list.map((c) => c!.sequence).sort((a, b) => a - b)).toEqual(list.map((_, i) => i));
                } else expect(card.sequence).toBe(index);
              });
            }
            expect(seat.extraCount).toBe(seat.extra.length);
            expect(seat.lp).toBeGreaterThanOrEqual(0);
          });
        }
      });
    });
  }
});
