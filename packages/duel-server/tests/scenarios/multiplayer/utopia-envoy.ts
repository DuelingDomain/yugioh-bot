// Number 39: Utopia the Envoy of Light (76504386): "When the SECOND attack of this turn is declared: you can make this card gain 2500 ATK". The global check
// registers one flag per attack declaration (for the literal seat 0, the overlay wrapper writes it for every living duelist) and the trigger condition reads
// Duel.GetFlagEffect(0,id)==1: exactly one attack was declared before. The attacks of ANY turn player count, so the Utopia of a holder at any seat gets
// the trigger at the second attack of the turn, whoever declares it. After the first attack the holder is not offered it.
//
// The Utopia has no Xyz Material, so its Quick Effect (detach 1) is not offered in every window and the scenarios only see the trigger.
// A: the holder is the turn player: an Elf attacks an empty opponent (FFA) or a Defense Position Watapon (Tag), then the Utopia attacks a Blue-Eyes (3000 ATK)
//    of the other opponent (2nd attack): the trigger gives 5000 ATK, the Blue-Eyes is destroyed and the opponent takes 2000 damage (without the trigger
//    the Utopia keeps 2500 ATK and does not destroy it).
// B: the holder is not the turn player: two Elves attack an empty opponent (FFA) or the Defense Position Utopia (Tag); the holder gets the trigger at the 2nd attack
//    (not at the 1st) and uses it.

import { attack, expectNotOffered, expectPrompt, pickOpponent, yes, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const UTOPIA = "Number 39: Utopia the Envoy of Light";
const ELF = "Mystical Elf";
const BEWD = "Blue-Eyes White Dragon";
const WATAPON = "Watapon";
const team = (seat: Seat): number => Number(seat[1]) % 2;
const opponents = (format: Format, seat: Seat): Seat[] => SEATS[format].filter((s) => (format === "tag" ? team(s) !== team(seat) : s !== seat));
/** FFA always exposes the combined pick here; Tag retains the native direct-seat choice. */
const pick = (format: Format, by: Seat, target: Seat, busy: Seat[]): Step[] =>
  (format !== "tag" || opponents(format, by).filter((seat) => !busy.includes(seat)).length > 1) ? [pickOpponent(target, by)] : [];
/** Cards each seat drew until the turn of `turn` (the FFA first-draw fixture adds the draw of p0 in turn 1; Tag skips it). */
const drawn = (seat: Seat, turn: Seat): number => (seat !== "p0" && Number(seat[1]) <= Number(turn[1]) ? 1 : 0);

function holderAttacks(format: Format, holder: Seat): Scenario {
  const base = baseLp(format);
  const tag = format === "tag";
  const [elfTarget, dragonSeat] = opponents(format, holder) as [Seat, Seat];
  const steps: Step[] = [
    ...turnsBefore(format, holder),
    attack({ card: ELF, nth: 0 }, tag ? WATAPON : "direct", holder), ...(tag ? [] : pick(format, holder, elfTarget, [holder, dragonSeat])),
    expectNotOffered("activate", { card: UTOPIA, from: "mzone" }, holder),
    attack(UTOPIA, BEWD, holder),
    yes(holder), // the prompt "Activate the Trigger Effect of Number 39" is the offer of the trigger
  ];
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: { count: drawn(seat, holder) } };
  spec[holder] = { ...spec[holder], monsters: [UTOPIA, ELF], zones: { m0: { card: UTOPIA, attack: 5000 } } };
  const hit = (seat: Seat) => (!tag && seat === elfTarget ? 800 : 0) + (seat === dragonSeat || (tag && team(seat) === team(dragonSeat)) ? 2000 : 0);
  for (const seat of opponents(format, holder)) spec[seat] = { ...spec[seat], lp: base - hit(seat) };
  spec[dragonSeat] = { ...spec[dragonSeat], grave: [BEWD] };
  if (tag) spec[elfTarget] = { ...spec[elfTarget], grave: [WATAPON] };
  return defineScenario({
    id: `utopia-envoy-${format}-${holder}-second-attack-gives-2500-atk-and-wins`,
    title: `${label(format)}: ${holder} attacks twice (Elf on ${tag ? "the defending Watapon of " : ""}${elfTarget}, then Utopia on the Blue-Eyes of ${dragonSeat}) and the trigger of the second attack gives the Utopia 5000 ATK`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] a count of attacks of the turn that the holder reads`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:76504386"],
    setup: baseSetup(format, {
      [holder]: { monsters: [UTOPIA, ELF] },
      [dragonSeat]: { monsters: [BEWD] },
      ...(tag ? { [elfTarget]: { monsters: [{ card: WATAPON, pos: "def" }] } } : {}),
    }),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

function otherAttacks(format: Format, attacker: Seat, holder: Seat, target: Seat): Scenario {
  const base = baseLp(format);
  const tag = format === "tag";
  const steps: Step[] = [
    ...turnsBefore(format, attacker),
    attack({ card: ELF, nth: 0 }, tag ? UTOPIA : "direct", attacker), ...(tag ? [] : pick(format, attacker, target, [holder])),
    expectPrompt({ by: attacker, context: "action" }), // no trigger window after the first attack
    attack({ card: ELF, nth: 0 }, tag ? UTOPIA : "direct", attacker), ...(tag ? [] : pick(format, attacker, target, [holder])),
    yes(holder), // the prompt "Activate the Trigger Effect of Number 39" is the offer of the trigger
  ];
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: { count: drawn(seat, attacker) } };
  spec[attacker] = { ...spec[attacker], monsters: [ELF, ELF] };
  spec[holder] = { ...spec[holder], monsters: [UTOPIA], zones: { m0: { card: UTOPIA, attack: 5000 } } };
  if (tag) {
    // Utopia's 2000 DEF stays unchanged: each 800 ATK Elf takes 1200 damage.
    for (const seat of SEATS.tag.filter(seat => team(seat) === team(attacker))) spec[seat] = { ...spec[seat], lp: base - 2400 };
  } else spec[target] = { ...spec[target], lp: base - 1600 };
  return defineScenario({
    id: `utopia-envoy-${format}-${attacker}-attacks-twice-holder-${holder}-offered-at-second`,
    title: `${label(format)}: ${attacker} declares 2 ${tag ? `attacks on the defending Utopia of ${holder}` : `direct attacks on ${target}`}; the Utopia of ${holder} is offered its trigger at the second attack`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] a count of attacks of the turn that the holder reads`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:76504386"],
    setup: baseSetup(format, {
      [attacker]: { monsters: [ELF, ELF] },
      [holder]: { monsters: [tag ? { card: UTOPIA, pos: "def" } : UTOPIA] },
    }),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

export const UTOPIA_SCENARIOS: Scenario[] = [
  holderAttacks("ffa3", "p1"), holderAttacks("ffa3", "p2"), holderAttacks("ffa4", "p3"), holderAttacks("tag", "p1"), holderAttacks("tag", "p3"),
  otherAttacks("ffa3", "p1", "p2", "p0"), otherAttacks("ffa4", "p3", "p1", "p0"), otherAttacks("tag", "p1", "p0", "p2"), otherAttacks("tag", "p2", "p1", "p3"),
];
