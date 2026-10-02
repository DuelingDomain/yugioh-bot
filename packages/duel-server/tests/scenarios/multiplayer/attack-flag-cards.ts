// Sangen Kaiho (25388971): "(Quick Effect) from your Graveyard, if 3 or more attacks were declared this turn: banish this card; draw 1 card".
// The global check registers a flag for the attacking player (ep) at every attack declaration and the condition reads
// Duel.GetFlagEffect(0,id)+Duel.GetFlagEffect(1,id) (the two players of a duel). With more than two duelists the holder must see the 3 attacks
// of ANY turn player, whichever seat the holder, the attacker and the attacked duelist have. No bug: the offer is right for every combination here
// (the flag of the attacker is read through the sum of both folded players). The turn player declares 3 direct attacks
// (a Mystical Elf each) and the holder is offered the card after the third; with 2 attacks it is not offered. Tag: both partners.

import { activate, attack, defineScenario, expectNotOffered, expectOffered, pickOpponent, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const KAIHO = "Sangen Kaiho";
const KAIHO_CODE = 25388971;
const ELF = "Mystical Elf";

/** On the turn of its own side the holder picks the opponent that its effect folds to (Tag: the partner of the turn player; FFA: the turn player itself). */
const sameSide = (format: Format, a: Seat, b: Seat): boolean => (format === "tag" ? Number(a[1]) % 2 === Number(b[1]) % 2 : a === b);

function kaiho(format: Format, attacker: Seat, target: Seat, holder: Seat, attacks: 2 | 3): Scenario {
  const base = format === "tag" ? 16000 : 8000;
  const offered = attacks === 3;
  const steps: Step[] = [
    ...turnsBefore(format, attacker),
    ...Array.from({ length: attacks }, () => [attack({ card: ELF, nth: 0 }, "direct", attacker), pickOpponent(target, attacker)]).flat(),
    ...(offered ? [expectOffered("activate", { card: KAIHO, from: "grave" }, holder), activate({ card: KAIHO, from: "grave" }, holder), ...(sameSide(format, attacker, holder) ? [pickOpponent(target, holder)] : [])] : [expectNotOffered("activate", { card: KAIHO, from: "grave" }, attacker)]),
  ];
  // Each seat that had its turn until now drew 1 card for it (p0 does not draw in the first turn); the holder draws 1 more with the card.
  const handCount = (seat: Seat): number => (seat !== "p0" && Number(seat[1]) <= Number(attacker[1]) ? 1 : 0) + (offered && seat === holder ? 1 : 0);
  const spec: Partial<Record<Seat, object>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: { count: handCount(seat) } };
  spec[attacker] = { ...spec[attacker], monsters: [ELF, ELF, ELF] };
  spec[holder] = { ...spec[holder], ...(offered ? { banished: [KAIHO] } : { grave: [KAIHO] }) };
  spec[target] = { ...spec[target], lp: base - attacks * 800 };
  return defineScenario({
    id: `sangen-kaiho-${format}-${attacker}-attacks-${target}-${attacks}-times-holder-${holder}-${offered ? "offered" : "not-offered"}`,
    title: `${label(format)}: ${attacker} declares ${attacks} direct attacks on ${target} and ${holder} (Sangen Kaiho in its Graveyard) ${offered ? "may banish it to draw 1 card" : "is not offered it"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] a count of attacks of the turn that every duelist reads`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${KAIHO_CODE}`],
    setup: baseSetup(format, {
      [attacker]: { monsters: [ELF, ELF, ELF] },
      ...(holder === attacker ? { [holder]: { monsters: [ELF, ELF, ELF], grave: [KAIHO] } } : { [holder]: { grave: [KAIHO] } }),
    }),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

export const ATTACK_FLAG_SCENARIOS: Scenario[] = [];
const rows: [Format, Seat, Seat, Seat][] = [
  ["ffa3", "p1", "p0", "p2"], ["ffa3", "p2", "p1", "p1"], ["ffa3", "p2", "p0", "p2"], ["ffa3", "p1", "p2", "p1"], ["ffa3", "p0", "p1", "p2"],
  ["ffa4", "p3", "p0", "p1"], ["ffa4", "p2", "p3", "p0"],
  ["tag", "p1", "p0", "p3"], ["tag", "p2", "p1", "p0"], ["tag", "p3", "p0", "p1"], ["tag", "p0", "p3", "p0"],
];
for (const [f, a, t, h] of rows) ATTACK_FLAG_SCENARIOS.push(kaiho(f, a, t, h, 3));
for (const [f, a, t, h] of [rows[3], rows[6], rows[9]]) ATTACK_FLAG_SCENARIOS.push(kaiho(f, a, t, h, 2));
