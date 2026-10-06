import { seatCountFor } from "@yugidraft/shared/duels";
import { activate, attack, defineScenario, endTurn, expectBoard, expectEvents, expectOffered, expectPrompt, pickOpponent, select, type DuelistId, type Scenario } from "../../support/dsl.js";

const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const BALLPARK = "Giant Ballpark";
const INSECT = "Man-Eater Bug";

// The holder p0 is outside the battle. Test its partner and the far opposing seat in Tag.
export const GIANT_BALLPARK_SCENARIOS = (["normal", "domain"] as const).flatMap(mode =>
  ([{ format: "tag", attacker: 1, defender: 2 }, { format: "tag", attacker: 2, defender: 3 },
    { format: "ffa3", attacker: 1, defender: 2 }, { format: "ffa4", attacker: 2, defender: 3 }] as const).map(({ format, attacker, defender }) => {
    const setup: Scenario["setup"] = { format, mode, attackFirstTurn: true, skipOpeningDraw: true };
    for (let seat = 0; seat < seatCountFor(format); seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: "Mystical Elf" } : {};
    setup.p0 = { ...setup.p0, field: BALLPARK, deck: [INSECT, "Pinch Hopper"] };
    setup[SEATS[attacker]!]!.monsters = ["Axe Raider"];
    return defineScenario({
      id: `giant-ballpark-${mode}-${format}-protect-p${defender}`,
      title: `${format} ${mode}: Giant Ballpark of p0 prevents battle damage to p${defender}`,
      source: "card-scripts/official/c58012707.lua", rules: ["R-COMMON-EACH-PLAYER"],
      tags: ["multiplayer", "card:58012707", format, mode], setup,
      steps: [
        ...Array.from({ length: attacker }, (_, seat) => endTurn(SEATS[seat]!)),
        attack("Axe Raider", "direct", SEATS[attacker]!), pickOpponent(SEATS[defender]!, SEATS[attacker]!),
        expectOffered("activate", BALLPARK, "p0"), activate(BALLPARK, "p0"), select(INSECT),
        expectPrompt({ by: SEATS[attacker]!, context: "action" }),
        expectBoard(Object.fromEntries(SEATS.slice(0, seatCountFor(format)).map(seat => [seat, {
          lp: format === "tag" ? 16000 : 8000, ...(seat === "p0" ? { grave: [INSECT], deckCount: 19 } : {}),
        }]))),
        expectEvents({ kind: "activate", card: BALLPARK, by: "p0" }),
      ],
    });
  }));
