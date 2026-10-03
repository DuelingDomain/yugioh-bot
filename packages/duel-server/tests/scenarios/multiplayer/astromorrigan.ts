// Live scenarios of Prediction Princess Astromorrigan (R1 each opponent, follows the Book of Eclipse decision). Plain data, also read by
// scripts/rule-coverage.ts; astromorrigan.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi
// core. Every scenario uses the real card script plus the overlay, and asserts the state of EVERY seat (LP, field, hand, GY, banished zone).
//
// When Astromorrigan is flipped face-up, in the End Phase of that turn all Defense Position monsters of the opponents are destroyed and "your
// opponent takes 500 damage for each monster destroyed this way". The stock script reads one group (the Defense Position monsters of every
// opponent) and lets ONE opponent take all the damage. The rule here: each opponent takes 500 damage for each of its OWN monsters that was
// destroyed. In Tag the opposing members share one LP pool, so the damage of the team is the sum (the stock value): the Tag scenario pins this.
// The next seat also makes its normal draw at the start of its turn, so its hand holds that card too.

import { changePhase, changePosition, defineScenario, endTurn, expectBoard, raw, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const ASTRO = "Prediction Princess Astromorrigan";
const ELF = "Mystical Elf";
const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const CELTIC = "Celtic Guardian";
const BEAVER = "Beaver Warrior";
const GAIA = "Gaia The Fierce Knight";

const ALL_SEATS: Seat[] = ["p0", "p1", "p2", "p3"];
const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ALL_SEATS.slice(0, 3) : ALL_SEATS);
const labelOf = (format: Format) => (format === "tag" ? "Tag" : format.toUpperCase());
const teamOf = (seat: Seat) => Number(seat[1]) % 2;

type Mon = { card: string; pos: "atk" | "def" };
const atk = (card: string): Mon => ({ card, pos: "atk" });
const def = (card: string): Mon => ({ card, pos: "def" });

/** The monsters of each seat besides Astromorrigan. Different Defense Position counts, so damage for the wrong seat shows. */
const MONSTERS: Record<Format, Record<Seat, Mon[]>> = {
  ffa3: { p0: [def(ELF)], p1: [def(RAT), def(OX), atk(AXE)], p2: [def(FANG), def(CELTIC), def(BEAVER), atk(GAIA)], p3: [] },
  ffa4: { p0: [def(ELF)], p1: [def(RAT), def(OX), atk(AXE)], p2: [atk(GAIA)], p3: [def(FANG), def(CELTIC), def(BEAVER)] },
  tag: { p0: [def(ELF)], p1: [def(RAT), def(OX), atk(AXE)], p2: [def(FANG), def(BEAVER)], p3: [def(CELTIC), atk(GAIA)] },
};
const DECK: Record<Seat, string> = { p0: OX, p1: AXE, p2: FANG, p3: ELF };

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, hand, Graveyard and banished zone are exact unless the spec names them. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const lp = format === "tag" ? 16000 : 8000;
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], hand: [], ...spec[seat] };
  return expectBoard(board);
}

function astromorrigan(format: Format, actor: Seat): Scenario {
  const tag = format === "tag";
  const seats = seatsOf(format);
  const actorIndex = seats.indexOf(actor);
  const next = seats[(actorIndex + 1) % seats.length];
  const opponents = seats.filter((seat) => (tag ? teamOf(seat) !== teamOf(actor) : seat !== actor));
  const field = MONSTERS[format];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) {
    setup[seat] = {
      hand: [],
      monsters: [
        ...(seat === actor ? [{ card: ASTRO, pos: "set" as const }] : []),
        ...field[seat].map((m) => (m.pos === "def" ? { card: m.card, pos: "def" as const } : m.card)),
      ],
      deck: Array.from({ length: 8 }, () => DECK[seat]),
    };
  }
  // The seats before the actor take their turns first: each one makes its normal draw at the start of its turn.
  const steps: Step[] = seats.slice(0, actorIndex).map((seat) => endTurn(seat));
  const normalDraws = (seat: Seat) => (seats.indexOf(seat) >= 1 && seats.indexOf(seat) <= actorIndex ? 1 : 0);
  const names = (seat: Seat) => field[seat].map((m) => m.card);
  const handNow = (seat: Seat) => Array.from({ length: normalDraws(seat) }, () => DECK[seat]);
  const zonesOf = (seat: Seat, survivors: Mon[]) =>
    Object.fromEntries(survivors.map((m, index) => [`m${index}`, { card: m.card, pos: m.pos }]));

  // After the flip: Astromorrigan is face-up; nothing is destroyed yet.
  const afterFlip: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    afterFlip[seat] = { monsters: seat === actor ? [ASTRO, ...names(seat)] : names(seat), hand: handNow(seat) };
  }
  steps.push(changePosition({ card: ASTRO, owner: actor }, actor), everySeat(format, afterFlip));

  // End Phase of the actor: the Defense Position monsters of each opponent are destroyed and that opponent takes 500 for each of its own.
  const lp = tag ? 16000 : 8000;
  const afterEndPhase: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const opponent = opponents.includes(seat);
    const lost = opponent ? field[seat].filter((m) => m.pos === "def").map((m) => m.card) : [];
    const kept = field[seat].filter((m) => !(opponent && m.pos === "def"));
    // Tag: the opposing members share one LP pool, so every seat of that team shows the sum of the damage of the team.
    const teamLost = tag
      ? opponents.filter((o) => teamOf(o) === teamOf(seat)).reduce((sum, o) => sum + field[o].filter((m) => m.pos === "def").length, 0)
      : lost.length;
    afterEndPhase[seat] = {
      lp: opponent ? lp - 500 * teamLost : lp,
      monsters: seat === actor ? [ASTRO, ...kept.map((m) => m.card)] : kept.map((m) => m.card),
      hand: [...handNow(seat), ...(seat === next ? [DECK[seat]] : [])],
      grave: lost,
    };
  }
  steps.push(endTurn(actor), everySeat(format, afterEndPhase));

  const counts = opponents.map((seat) => `${seat} ${field[seat].filter((m) => m.pos === "def").length}`).join(", ");
  return defineScenario({
    id: `astromorrigan-${format}-${actor}-each-opponent-takes-damage-for-its-own-destroyed-monsters`,
    title: tag
      ? `Tag: ${actor} flips Astromorrigan, then in its End Phase the Defense Position monsters of both opposing members are destroyed (${counts}) and the opposing team takes 500 for each (one LP pool, the sum is the stock value); the partner and ${actor} keep their monsters`
      : `${labelOf(format)}: ${actor} flips Astromorrigan, then in its End Phase the Defense Position monsters of each opponent are destroyed (${counts}) and each opponent takes 500 for each of its OWN destroyed monsters; ${actor} keeps its monsters`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER], follows the Book of Eclipse decision (2026-10-01): Prediction Princess Astromorrigan (each opponent takes damage for its own destroyed monsters)`,
    rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-OPP-FIELD", ...(tag ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "astromorrigan", "r1", "each-opponent", "damage", "delayed", format, `actor:${actor}`, "card:5010422"],
    setup: setup as unknown as Scenario["setup"],
    steps,
  });
}

/**
 * The flip comes in the turn of ANOTHER seat (the usual case: an attack on the face-down card). p0 Sets Astromorrigan, p1 attacks it in
 * its own turn (turn 5, the first turn of p1 with a battle) and flips it. The End Phase effect belongs to p0, not to the turn player: in
 * the End Phase of p1 the Defense Position monsters of the opponents of p0 (p1 and p2) are destroyed and each of them takes 500 damage
 * for each of its OWN destroyed monsters (p1 2, p2 3), while p0 takes nothing and keeps its own Defense Position monster.
 */
function astromorriganOffTurn(): Scenario {
  const format: Format = "ffa3";
  const actor: Seat = "p0";
  const seats = seatsOf(format);
  const field = MONSTERS[format];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) {
    setup[seat] = {
      hand: [],
      monsters: [
        ...(seat === actor ? [{ card: ASTRO, pos: "set" as const }] : []),
        ...field[seat].map((m) => (m.pos === "def" ? { card: m.card, pos: "def" as const } : m.card)),
      ],
      deck: Array.from({ length: 12 }, () => DECK[seat]),
    };
  }
  const names = (seat: Seat) => field[seat].map((m) => m.card);
  // Turns 1 to 4 (p0, p1, p2, p0) pass; each seat makes its normal draw at the start of its turn (p0 one in turn 4, p1 one in turn 2,
  // p2 one in turn 3). The first battle is in turn 5.
  const steps: Step[] = [endTurn("p0"), endTurn("p1"), endTurn("p2"), endTurn("p0")];
  // p1 attacks the face-down card of p0 with Axe Raider (the only monster of p1 in Attack Position). A face-down card shows no code in
  // the prompt, so the DSL attack() cannot name it: the attacker is the first attack option, the target is the only "Face-down card"
  // option (card:4: the options list the monsters of p2 first, then the card of p0 and its Mystical Elf).
  steps.push(changePhase("battle", "p1"), raw({ choice: "attack:0" }, "p1"), raw({ selected: ["card:4"] }, "p1"));
  // The flip: Astromorrigan (DEF 0) is destroyed by the battle; nothing else is destroyed yet and nobody took damage.
  steps.push(
    everySeat(format, {
      p0: { monsters: names("p0"), hand: [DECK.p0], grave: [ASTRO] },
      p1: { monsters: names("p1"), hand: [DECK.p1, DECK.p1] },
      p2: { monsters: names("p2"), hand: [DECK.p2] },
    }),
  );
  // End Phase of p1: the Defense Position monsters of p1 and p2 are destroyed, each seat takes 500 for each of its OWN (p1 2, p2 3).
  const survivors = (seat: Seat) => field[seat].filter((m) => m.pos === "atk").map((m) => m.card);
  const lost = (seat: Seat) => field[seat].filter((m) => m.pos === "def").map((m) => m.card);
  steps.push(
    endTurn("p1"),
    everySeat(format, {
      p0: { lp: 8000, monsters: names("p0"), hand: [DECK.p0], grave: [ASTRO] },
      p1: { lp: 8000 - 500 * lost("p1").length, monsters: survivors("p1"), hand: [DECK.p1, DECK.p1], grave: lost("p1") },
      p2: { lp: 8000 - 500 * lost("p2").length, monsters: survivors("p2"), hand: [DECK.p2, DECK.p2], grave: lost("p2") },
    }),
  );
  return defineScenario({
    id: "astromorrigan-ffa3-p0-flipped-in-the-turn-of-p1-each-opponent-takes-damage-for-its-own-destroyed-monsters",
    title: "FFA3: p1 attacks the face-down Astromorrigan of p0 in its own turn and flips it, then in the End Phase of p1 the Defense Position monsters of the opponents of p0 (p1 and p2) are destroyed and each takes 500 for each of its OWN destroyed monsters (p1 2, p2 3); p0 takes nothing and keeps its monster",
    source: `${SOURCE} [R-COMMON-EACH-PLAYER], follows the Book of Eclipse decision (2026-10-01): Prediction Princess Astromorrigan (each opponent takes damage for its own destroyed monsters; the flip comes in the turn of another seat)`,
    rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "astromorrigan", "r1", "each-opponent", "damage", "delayed", "off-turn", format, `actor:${actor}`, "card:5010422"],
    setup: setup as unknown as Scenario["setup"],
    steps,
  });
}

export const ASTROMORRIGAN_SCENARIOS: Scenario[] = [
  astromorrigan("ffa3", "p0"),
  astromorrigan("ffa3", "p1"),
  astromorrigan("ffa4", "p0"),
  astromorrigan("ffa4", "p2"),
  astromorrigan("tag", "p0"),
  astromorrigan("tag", "p1"),
  astromorriganOffTurn(),
];
