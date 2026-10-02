// Live scenarios of Prediction Princess Astromorrigan (R1 each opponent, lead decision 2026-10-01). Plain data, also read by
// scripts/rule-coverage.ts; astromorrigan.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi
// core. Every scenario uses the real card script plus the overlay, and asserts the state of EVERY seat (LP, field, hand, GY, banished zone).
//
// When Astromorrigan is flipped face-up, in the End Phase of that turn all Defense Position monsters of the opponents are destroyed and "your
// opponent takes 500 damage for each monster destroyed this way". The stock script reads one group (the Defense Position monsters of every
// opponent) and lets ONE opponent take all the damage. The rule here: each opponent takes 500 damage for each of its OWN monsters that was
// destroyed. In Tag the opposing members share one LP pool, so the damage of the team is the sum (the stock value): the Tag scenario pins this.
// The next seat also makes its normal draw at the start of its turn, so its hand holds that card too.

import { changePosition, defineScenario, endTurn, expectBoard, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
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
    source: `${SOURCE} [R-COMMON-EACH-PLAYER], lead decision 2026-10-01: Prediction Princess Astromorrigan (each opponent takes damage for its own destroyed monsters)`,
    rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-OPP-FIELD", ...(tag ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "astromorrigan", "r1", "each-opponent", "damage", "delayed", format, `actor:${actor}`, "card:5010422"],
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
];
