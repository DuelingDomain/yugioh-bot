// Foolish Trap Hole (10529441): "When a monster effect is activated on your opponent's field during the turn they Special Summoned a monster(s):
// Destroy the monster that activated that effect, then destroy all opponent's cards in its adjacent Monster Zones and Spell & Trap Zones".
// The stock script keeps the flag "this player Special Summoned this turn" in a GLOBAL check that loops over the players 0 and 1. The overlay
// (kind hand, class R2 LOOP) loops over the real seats, so the flag exists for p1, p2 and p3 too, and the condition reads the flag of the
// opponent that activated the effect (in Tag one flag for the team). These scenarios prove it live: the holder is offered the card only
// during the turn in which the activating duelist Special Summoned, any holder seat (an earlier and a later seat) is offered, and in Tag the
// partner of the activating duelist is never offered it.
//
// The activator is p1 (or p2 / p0): it Special Summons Mystical Elf with Monster Reborn (the Elf goes to Monster Zone 5, away from the
// adjacent zones), then activates the ignition effect of Homunculus the Alchemic Being (Monster Zone 1). Setup puts the Traps in place: the
// scenarios prove the engine rule, not a legal deck.

import { activate, auto, choose, endTurn, expectOffered, expectPrompt, faceDown, pass, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const TRAP = "Foolish Trap Hole";
const TRAP_CODE = 10529441;
const REBORN = "Monster Reborn";
const HOMUNCULUS = "Homunculus the Alchemic Being";
const ELF = "Mystical Elf";
const RULE = `${SOURCE} [R-COMMON-SEAT-STATE] a per-player flag that a global check writes is kept for the real seat (Q6)`;

/** The activator Special Summons the Elf (Monster Reborn, Elf to Monster Zone 5) and then activates the effect of Homunculus. */
function summonThenEffect(seat: Seat): Step[] {
  return [activate(REBORN, seat), auto(seat), choose("Monster Zone 5", seat), activate(HOMUNCULUS, seat)];
}

const activatorSetup = { hand: [REBORN], monsters: [HOMUNCULUS], grave: [ELF] };

function holderTrapped(format: Format, activator: Seat, holders: Seat[], user: Seat, responders: Seat[]): Scenario {
  const seats = SEATS[format];
  const spec: Partial<Record<Seat, object>> = {};
  const setup: Partial<Record<Seat, object>> = { [activator]: activatorSetup };
  for (const holder of holders) setup[holder] = { spells: [faceDown(TRAP)] };
  // Seats that answer the chain link in turn order before the user pass (the prompt of each seat is checked with expectOffered).
  const steps: Step[] = [...turnsBefore(format, activator), ...summonThenEffect(activator)];
  for (const seat of responders) {
    steps.push(expectOffered("activate", TRAP, seat));
    steps.push(pass(seat));
  }
  steps.push(expectOffered("activate", TRAP, user), activate(TRAP, user));
  for (const seat of seats) {
    if (seat === user) spec[seat] = { grave: [TRAP] };
    else if (seat === activator) spec[seat] = { monsters: [ELF], grave: [REBORN, HOMUNCULUS] };
    else if (holders.includes(seat)) spec[seat] = { spells: [TRAP] };
    else spec[seat] = {};
  }
  return defineScenario({
    id: `foolish-trap-hole-${format}-${activator}-summoned-and-activated-${holders.join("-")}-offered-${user}-uses-it`,
    title: `${format === "tag" ? "Tag" : format.toUpperCase()}: ${activator} Special Summons and then activates a monster effect: ${holders.join(" and ")} hold Foolish Trap Hole and are offered it, ${user} uses it and destroys the monster (the Elf in Monster Zone 5 is not adjacent and stays)`,
    source: RULE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "seat-state", "flag", format, `card:${TRAP_CODE}`],
    setup: baseSetup(format, setup),
    steps: [...steps, everySeat(format, spec)],
  });
}

/** Tag: the activator and its partner (a Set Trap too) are one team; the partner is never offered the Trap, the opposing team is (first, then user). */
function tagPartnerNotOffered(activator: Seat, first: Seat, user: Seat): Scenario {
  const partner = PARTNER[activator];
  const trapped: Partial<Record<Seat, object>> = {};
  for (const seat of SEATS.tag) trapped[seat] = seat === activator ? activatorSetup : { spells: [faceDown(TRAP)] };
  const end: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS.tag) {
    end[seat] = seat === activator ? { monsters: [ELF], grave: [REBORN, HOMUNCULUS] } : seat === user ? { grave: [TRAP] } : { spells: [TRAP] };
  }
  return defineScenario({
    id: `foolish-trap-hole-tag-${activator}-summoned-and-activated-partner-${partner}-not-offered-${user}-uses-it`,
    title: `Tag: ${activator} Special Summons and then activates a monster effect: ${first} and ${user} (the opposing team) are offered Foolish Trap Hole, the partner ${partner} holds one too and is NOT offered it; ${user} uses it`,
    source: `${RULE}; [R-TAG-PARTNER] the partner is not an opponent`,
    rules: ["R-COMMON-SEAT-STATE", "R-TAG-PARTNER"],
    tags: ["multiplayer", "seat-state", "flag", "tag", `card:${TRAP_CODE}`],
    setup: baseSetup("tag", trapped),
    steps: [
      ...turnsBefore("tag", activator),
      ...summonThenEffect(activator),
      expectOffered("activate", TRAP, first),
      pass(first),
      // The next prompt is the second opponent: the partner of the activator got no chain window.
      expectOffered("activate", TRAP, user),
      activate(TRAP, user),
      everySeat("tag", end),
    ],
  });
}

export const FOOLISH_TRAP_HOLE_SCENARIOS: Scenario[] = [
  holderTrapped("ffa3", "p1", ["p0", "p2"], "p0", ["p2"]),
  holderTrapped("ffa4", "p2", ["p0", "p3"], "p0", ["p3"]),
  holderTrapped("ffa3", "p2", ["p0", "p1"], "p1", ["p0"]),
  holderTrapped("ffa4", "p3", ["p0", "p1", "p2"], "p2", ["p0", "p1"]),
  tagPartnerNotOffered("p0", "p1", "p3"),
  tagPartnerNotOffered("p2", "p3", "p1"),
  // No Special Summon in the turn: the flag is not set, so no holder is offered the Trap.
  ...(["ffa3", "ffa4"] as Format[]).map((format) =>
    defineScenario({
      id: `foolish-trap-hole-${format}-no-special-summon-no-window`,
      title: `${format.toUpperCase()}: p1 activates a monster effect in a turn with no Special Summon: the Foolish Trap Hole of every other seat gets no chain window and stays Set`,
      source: RULE,
      rules: ["R-COMMON-SEAT-STATE"],
      tags: ["multiplayer", "seat-state", "flag", format, `card:${TRAP_CODE}`],
      setup: baseSetup(format, {
        p0: { spells: [faceDown(TRAP)] }, p1: { monsters: [HOMUNCULUS] }, p2: { spells: [faceDown(TRAP)] },
        ...(format === "ffa4" ? { p3: { spells: [faceDown(TRAP)] } } : {}),
      }),
      steps: [
        ...turnsBefore(format, "p1"),
        activate(HOMUNCULUS, "p1"),
        // The first prompt after the activation is the Attribute choice of p1 itself: no seat got a chain window.
        expectPrompt({ by: "p1" }),
        auto("p1"),
        everySeat(format, {
          p0: { spells: [TRAP] }, p1: { monsters: [HOMUNCULUS] }, p2: { spells: [TRAP] },
          ...(format === "ffa4" ? { p3: { spells: [TRAP] } } : {}),
        }),
      ],
    }),
  ),
];
