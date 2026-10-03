// Rebirth of the Seventh Emperors (83888009): "Activate by Releasing all Xyz Monsters you control: Special Summon 1 of your banished Xyz Monsters.
// During the End Phase of the turn you activated this card, each player takes 300 damage for each card in their hand".
//
// The stock End Phase operation damages tp for the cards in its hand and then 1-tp for the cards in ITS hand. Under the fold the value 1-tp is
// ONE opponent, and the hand count of 1-tp is the sum of the hands of ALL opponents, so one opponent took the damage for every other hand and
// the other opponents took nothing. In Tag the own team took damage only for the hand of the seat that activated the card. The overlay
// (kind fix) loops over every living duelist (aux.MPForEachDuelist): each duelist takes 300 for each card in its OWN hand (in Tag the
// two partners add up on the team LP).
//
// The Xyz Monster in the banished zone must have been properly summoned, so the actor attacks directly with Number 39: Utopia and the attacked
// duelist (the next seat in the turn order) banishes it with a Set Dimensional Prison. In Main Phase 2 the actor Releases its Gagaga Cowboy
// (the cost) and Special Summons the Utopia back. The hands before the turn are p0 1 card, p1 1 card, p2 2 cards, p3 3 cards (the Mystical Elf). A duelist that took its own turn before the End Phase of the actor
// drew 1 card, except p0 on global turn 1 in Standard MR3-MR5. The end hand
// is the setup hand plus each draw that occurred before the End Phase of the actor.

import { activate, attack, auto, changePhase, endTurn, expectEliminated, faceDown, pass, pickOpponent, xyz, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const REBIRTH = "Rebirth of the Seventh Emperors";
const REBIRTH_CODE = 83888009;
const PRISON = "Dimensional Prison";
const UTOPIA = "Number 39: Utopia";
const COWBOY = "Gagaga Cowboy";
const ELF = "Mystical Elf";
const SETUP_HAND: Record<Seat, number> = { p0: 1, p1: 1, p2: 2, p3: 3 };

function emperors(format: Format, actor: Seat, p0Out = false): Scenario {
  const seats = SEATS[format];
  const actorIndex = seats.indexOf(actor);
  const handAtEnd = (seat: Seat): number => (p0Out && seat === "p0" ? 0 : SETUP_HAND[seat]) + (seats.indexOf(seat) >= 1 && seats.indexOf(seat) <= actorIndex ? 1 : 0);
  const holder = seats[(actorIndex + 1) % seats.length]!;
  const setup: Partial<Record<Seat, object>> = {};
  for (const seat of seats) {
    setup[seat] = {
      hand: Array.from({ length: p0Out && seat === "p0" ? 0 : SETUP_HAND[seat] }, () => ELF),
      ...(p0Out && seat === "p0" ? { lp: 800 } : {}),
      ...(seat === actor ? { monsters: [xyz(UTOPIA, []), xyz(COWBOY, []), ...(p0Out ? [ELF] : [])], spells: [faceDown(REBIRTH)] } : {}),
      ...(seat === holder ? { spells: [faceDown(PRISON)] } : {}),
    };
  }
  const base = baseLp(format);
  const damage = (seat: Seat): number => 300 * (format === "tag" ? handAtEnd(seat) + handAtEnd(PARTNER[seat]) : handAtEnd(seat));
  const spec: Partial<Record<Seat, object>> = {};
  for (const seat of seats) {
    spec[seat] = {
      lp: p0Out && seat === "p0" ? 0 : base - damage(seat),
      // The turn of the next seat (the holder of the Prison) has begun when the board is read: it drew 1 card.
      hand: { count: handAtEnd(seat) + (seat === holder ? 1 : 0) },
      ...(seat === actor ? { monsters: [UTOPIA, ...(p0Out ? [ELF] : [])], grave: [COWBOY, REBIRTH] } : {}),
      ...(seat === holder ? { grave: [PRISON] } : {}),
    };
  }
  return defineScenario({
    id: `rebirth-emperors-${format}-${actor}-each-player-takes-damage-for-its-own-hand${p0Out ? "-p0-out-by-lp-zero" : ""}`,
    title: `${label(format)}: ${p0Out ? "p0 is out at LP 0; " : ""}${actor} activates Rebirth of the Seventh Emperors and in the End Phase every duelist takes 300 for each card in its OWN hand (${seats.map((s) => `${s} ${handAtEnd(s)}`).join(", ")})${format === "tag" ? "; the team LP takes the sum of both partners" : ""}`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER] "each player" is every living duelist, Tag partner included (Q3)`,
    rules: ["R-COMMON-EACH-PLAYER", ...(p0Out ? ["R-FFA-ELIMINATION"] : [])],
    tags: ["multiplayer", "each-player", "damage", format, `card:${REBIRTH_CODE}`],
    setup: baseSetup(format, setup),
    steps: [
      ...turnsBefore(format, actor),
      ...(p0Out ? [attack(ELF, "direct", actor), pickOpponent("p0", actor), pass(holder), expectEliminated("p0")] : []),
      attack(UTOPIA, "direct", actor),
      ...(!p0Out || format === "ffa4" ? [pickOpponent(holder, actor)] : []),
      activate(PRISON, holder),
      pass(actor),
      changePhase("main2", actor),
      activate(REBIRTH, actor),
      auto(actor),
      endTurn(actor),
      everySeat(format, spec),
    ],
  });
}

export const REBIRTH_EMPERORS_SCENARIOS: Scenario[] = [
  emperors("ffa3", "p0"), emperors("ffa3", "p2"),
  emperors("ffa4", "p0"), emperors("ffa4", "p3"),
  emperors("tag", "p0"), emperors("tag", "p3"),
  emperors("ffa3", "p1", true), emperors("ffa4", "p1", true),
];

/** Domain's opening draw adds one hand card to the End Phase damage of p0. */
export function rebirthEmperorsDomainVariant(scenario: Scenario): Scenario {
  const variant = domainVariant(scenario);
  return {
    ...variant,
    steps: variant.steps.map((step) => {
      if (step.op !== "expectBoard" || !step.board.p0?.lp) return step;
      const board = { ...step.board };
      const seats: Seat[] = scenario.setup.format === "tag" ? ["p0", "p2"] : ["p0"];
      for (const seat of seats) {
        const state = board[seat];
        if (state?.lp !== undefined) board[seat] = { ...state, lp: state.lp - 300 };
      }
      return { ...step, board };
    }),
  };
}
