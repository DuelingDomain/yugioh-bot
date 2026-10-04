// Don Zaloog uses the damaged player as its causal opponent, outside the battle-event path.
import {
  attack, changePhase, endTurn, expectEliminated, expectPrompt, pickOpponent, surrender, yes,
  type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { everySeat } from "./table-cards.js";

export const QUEUED_BOUND_OPPONENT_SCENARIOS: Scenario[] = (["ffa3", "ffa4"] as const).map((format) => {
  const seats = format === "ffa3" ? ["p0", "p1", "p2"] as const : ["p0", "p1", "p2", "p3"] as const;
  return defineScenario({
    id: `queued-${format}-don-zaloog-damaged-opponent-surrenders-before-trigger-answer`,
    title: `${format}: Don Zaloog damages p1 for 1400; p1 surrenders before the trigger answer; no other opponent loses a hand or Deck card`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-RESPONSE] [R-COMMON-SURRENDER-EOT]",
    rules: ["R-FFA-OPP-RESPONSE", "R-COMMON-SURRENDER-EOT"],
    tags: ["multiplayer", "trigger", "event-opponent", "elimination", format, "card:76922029"],
    setup: {
      format,
      p0: { monsters: ["Don Zaloog"] },
      p1: { hand: ["Mystical Elf"] },
      p2: { hand: ["Mystical Elf"] },
      ...(format === "ffa4" ? { p3: { hand: ["Mystical Elf"] } } : {}),
    },
    steps: [
      ...seats.map((seat) => endTurn(seat)),
      changePhase("battle", "p0"),
      attack("Don Zaloog", "direct", "p0"),
      pickOpponent("p1", "p0"),
      expectPrompt({ by: "p0", title: 'Activate the Trigger Effect of "Don Zaloog"' }),
      surrender("p1"),
      yes("p0"),
      expectEliminated("p1"),
      expectPrompt({ by: "p0", title: "Choose a battle action" }),
      everySeat(format, {
        p0: { monsters: ["Don Zaloog"], hand: ["Mystical Elf"], deckCount: 19 },
        p1: { lp: 6600, hand: [], deckCount: 0 },
        p2: { hand: ["Mystical Elf", "Mystical Elf"], deckCount: 19 },
        ...(format === "ffa4" ? { p3: { hand: ["Mystical Elf", "Mystical Elf"], deckCount: 19 } } : {}),
      }),
    ],
  });
});
