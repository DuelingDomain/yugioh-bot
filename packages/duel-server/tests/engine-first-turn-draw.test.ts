import { expect, it } from "vitest";
import { defaultDuelSettings, seatCountFor, type DuelFormat, type DuelMasterRule, type DuelMode } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { defineScenarioWithFfaFirstDraw } from "./scenarios/multiplayer/ffa-first-draw.js";
import { expectBoard } from "./support/dsl.js";
import { runScenario } from "./support/session.js";

const formats: DuelFormat[] = ["1v1", "tag", "ffa3", "ffa4"];
const cases = (["normal", "domain"] as DuelMode[]).flatMap((mode) =>
  ([5] as DuelMasterRule[]).flatMap((masterRule) => formats.map((format) => ({ mode, masterRule, format }))),
);
cases.push(...([1, 2, 3] as DuelMasterRule[]).map((masterRule) => ({ mode: "normal" as const, masterRule, format: "1v1" as const })));
cases.push(...([1, 2, 3, 4] as DuelMasterRule[]).map((masterRule) => ({ mode: "domain" as const, masterRule, format: "1v1" as const })));

// DRAW messages become deck-to-hand move events in observeMoveEvents. Opening-hand
// messages precede the first Draw Phase, so this checks the turn draw separately.
describeWithCores("owner first-turn draw rule on installed cores", [needs.standard(), needs.domain(), needs.installedMulti(),
  ...needs.domainMulti(dataDirectory, `${dataDirectory}/ocgcore.multi-domain.wasm`)], () => {
  it.each(cases)("$mode MR$masterRule $format: each first turn checks every seat and its DRAW message", async ({ mode, masterRule, format }) => {
    const count = seatCountFor(format);
    const firstDraw = mode === "domain" || masterRule <= 2;
    const game = await createEngineGame({ mode, masterRule, format, dataDirectory, seed: ["1", "2", "3", "4"],
      settings: { ...defaultDuelSettings(mode), shuffleDeck: false },
      decks: Array.from({ length: count }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
        ...(mode === "domain" ? { deckMaster: 48305365 } : {}) })),
    });
    try {
      for (let actor = 0; actor < count; actor++) {
        const own = game.view(actor);
        expect(own.turn).toBe(actor + 1);
        expect(own.turnSeat).toBe(actor);
        expect(own.phase).toBe("main1");
        expect(own.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        for (let viewer = 0; viewer < count; viewer++) {
          const view = game.view(viewer);
          for (let seat = 0; seat < count; seat++) {
            const drew = seat <= actor && (seat > 0 || firstDraw);
            expect(view.seats[seat].hand, `viewer ${viewer}, seat ${seat}, turn ${actor + 1}`).toHaveLength(5 + Number(drew));
            expect(view.seats[seat].deckCount).toBe(35 - Number(drew));
          }
          const messages = view.events.filter((event) => event.kind === "move" && event.reason === "draw"
            && event.seat === actor && event.zone?.sequence === 5);
          expect(messages).toHaveLength(actor > 0 || firstDraw ? 1 : 0);
          if (messages.length) expect(messages[0]).toMatchObject({ seat: actor,
            from: { controller: actor, location: OcgLocation.DECK }, zone: { controller: actor, location: OcgLocation.HAND } });
        }
        if (actor + 1 < count) game.answer(actor, own.prompt!.id, { choice: "to_ep" });
      }
    } finally { game.close(); }
  });

  it("Standard MR3 FFA3: P68 rejects old-rule flags before any first turn", async () => {
    await expect(createEngineGame({ mode: "normal", masterRule: 3, format: "ffa3", dataDirectory,
      seed: ["1", "2", "3", "4"], decks: Array.from({ length: 3 }, () => ({ main: Array(40).fill(15025844), extra: [], side: [] })),
    })).rejects.toThrow("DUEL_CANNOT_SUMMON_OATH_OLD is not supported with more than 2 duelists");
  });

  it("Domain MR3 FFA3: P68 also rejects old-rule flags with the Domain draw flag", async () => {
    await expect(createEngineGame({ mode: "domain", masterRule: 3, format: "ffa3", dataDirectory,
      seed: ["1", "2", "3", "4"], decks: Array.from({ length: 3 }, () => ({ main: Array(40).fill(15025844), extra: [], side: [], deckMaster: 48305365 })),
    })).rejects.toThrow("DUEL_CANNOT_SUMMON_OATH_OLD is not supported with more than 2 duelists");
  });

  it("a captured Domain board keeps its hand when the fixture skips the opening draw", async () => {
    const scenario = defineScenarioWithFfaFirstDraw({
      id: "captured-domain-opening-draw", title: "Captured Domain board", source: "Owner first-draw rule",
      tags: [], setup: { mode: "domain", skipOpeningDraw: true,
        p0: { hand: [], deck: ["Silver Fang"], deckMaster: "Axe Raider" },
        p1: { hand: [], deckMaster: "Celtic Guardian" } },
      steps: [expectBoard({ p0: { hand: [], deckCount: 20 }, p1: { hand: [], deckCount: 20 } })],
    });
    await runScenario(scenario);
  });
});
