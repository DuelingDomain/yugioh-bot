import { opponentSeatsOf, seatCountFor, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { activate, attack, defineScenario, endTurn, expectBoard, expectEvents, expectOffered, expectPrompt, pickOpponent, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const KURIBOH = "Kuriboh";
const AXE = "Axe Raider";

export function kuribohCase(format: DuelFormat, mode: DuelMode, owner: number, partner = false, wrongTeam = false): Scenario {
  const count = seatCountFor(format);
  const attacker = wrongTeam ? owner : opponentSeatsOf(format, owner)[0]!;
  const defender = wrongTeam ? opponentSeatsOf(format, attacker)[0]! : partner ? (owner + 2) % 4 : owner;
  const setup: Scenario["setup"] = { format, mode, attackFirstTurn: true, skipOpeningDraw: true };
  for (let seat = 0; seat < count; seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: "Mystical Elf" } : {};
  setup[SEATS[owner]!]!.hand = [KURIBOH];
  setup[SEATS[attacker]!]!.monsters = [AXE];
  const steps: Step[] = Array.from({ length: attacker }, (_, seat) => endTurn(SEATS[seat]!));
  steps.push(attack(AXE, "direct", SEATS[attacker]!), ...(count > 2 ? [pickOpponent(SEATS[defender]!, SEATS[attacker]!)] : []));
  if (wrongTeam) {
    steps.push(expectPrompt({ by: SEATS[attacker]!, context: "action" }), expectBoard({
      [SEATS[owner]!]: { hand: { include: [KURIBOH] }, grave: { exclude: [KURIBOH] } },
      [SEATS[defender]!]: { lp: (format === "tag" ? 16000 : 8000) - 1700 },
    }));
  } else {
    steps.push(expectOffered("activate", { card: KURIBOH, from: "hand" }, SEATS[owner]!), activate(KURIBOH, SEATS[owner]!),
      expectBoard({ [SEATS[owner]!]: { hand: { exclude: [KURIBOH] }, grave: { include: [KURIBOH] }, lp: format === "tag" ? 16000 : 8000 },
        [SEATS[defender]!]: { lp: format === "tag" ? 16000 : 8000 } }),
      expectEvents({ kind: "activate", card: KURIBOH, by: SEATS[owner]! }));
  }
  return defineScenario({ id: `kuriboh-${mode}-${format}-p${owner}-${wrongTeam ? "opponent-damage-negative" : partner ? "partner" : "defender"}`,
    title: `${format} ${mode}: p${owner} ${wrongTeam ? "cannot prevent the other team's damage" : "prevents battle damage"}${partner ? " to its partner" : ""}`,
    source: "card-scripts/official/c40640057.lua", tags: ["multiplayer", "hand-effects", "card:40640057", format, mode], setup, steps });
}

export const KURIBOH_SCENARIOS = (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    Array.from({ length: seatCountFor(format) }, (_, owner) => [kuribohCase(format, mode, owner),
      kuribohCase(format, mode, owner, false, true), ...(format === "tag" ? [kuribohCase(format, mode, owner, true)] : [])]).flat()));
