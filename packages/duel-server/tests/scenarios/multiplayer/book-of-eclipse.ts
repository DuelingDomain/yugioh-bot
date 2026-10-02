// Live scenarios of Book of Eclipse (R1 each opponent, lead decision 2026-10-01). Plain data, also read by scripts/rule-coverage.ts;
// book-of-eclipse.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi core. Every
// scenario uses the real card script plus the overlay, and asserts the state of EVERY seat (LP, field, hand, GY, banished zone).
//
// Book of Eclipse turns all monsters on the field face-down. In the End Phase of that turn "your opponent changes all face-down monsters they
// control to face-up Defense Position, and draws 1 card for each". The stock script reads one group of the face-down monsters of every opponent
// and lets ONE opponent draw for all of them. The rule here: each opponent changes its OWN face-down monsters and draws 1 card for each of its
// own (in Tag each opposing member is such an opponent; the partner of the activator and the activator keep their face-down monsters).
// The next seat also makes its normal draw at the start of its turn, so its hand holds that card too.

import { activate, defineScenario, endTurn, expectBoard, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const BOOK = "Book of Eclipse";
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

/** The monsters of each seat (face-up Attack Position at the start). Different counts, so a draw for the wrong seat shows. */
const MONSTERS: Record<Format, Record<Seat, string[]>> = {
  ffa3: { p0: [ELF], p1: [RAT, OX], p2: [AXE, FANG, CELTIC], p3: [] },
  ffa4: { p0: [ELF], p1: [RAT, OX], p2: [], p3: [AXE, FANG, CELTIC] },
  tag: { p0: [ELF], p1: [RAT, OX], p2: [AXE, FANG], p3: [CELTIC] },
};
const HAND: Record<Seat, string> = { p0: GAIA, p1: BEAVER, p2: CELTIC, p3: RAT };
const DECK: Record<Seat, string> = { p0: OX, p1: AXE, p2: FANG, p3: ELF };

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, hand, Graveyard and banished zone are exact unless the spec names them. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const lp = format === "tag" ? 16000 : 8000;
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], hand: [], ...spec[seat] };
  return expectBoard(board);
}

function eclipse(format: Format, actor: Seat): Scenario {
  const tag = format === "tag";
  const seats = seatsOf(format);
  const actorIndex = seats.indexOf(actor);
  const next = seats[(actorIndex + 1) % seats.length];
  const opponents = seats.filter((seat) => (tag ? teamOf(seat) !== teamOf(actor) : seat !== actor));
  const field = MONSTERS[format];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) {
    setup[seat] = {
      hand: seat === actor ? [BOOK, HAND[seat]] : [HAND[seat]],
      monsters: field[seat],
      deck: Array.from({ length: 8 }, () => DECK[seat]),
    };
  }
  // The seats before the actor take their turns first: each one makes its normal draw at the start of its turn.
  const steps: Step[] = seats.slice(0, actorIndex).map((seat) => endTurn(seat));
  const normalDraws = (seat: Seat) => (seats.indexOf(seat) >= 1 && seats.indexOf(seat) <= actorIndex ? 1 : 0);
  const handNow = (seat: Seat, extra = 0) => [HAND[seat], ...Array.from({ length: normalDraws(seat) + extra }, () => DECK[seat])];
  const faceDown = (seat: Seat) =>
    Object.fromEntries(field[seat].map((card, index) => [`m${index}`, { card, pos: "set" as const }]));
  const faceUpDefense = (seat: Seat) =>
    Object.fromEntries(field[seat].map((card, index) => [`m${index}`, { card, pos: "def" as const }]));

  // After the activation: every monster of every seat is face-down. Nothing is drawn yet.
  const afterActivation: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    afterActivation[seat] = {
      monsters: field[seat],
      zones: faceDown(seat),
      hand: handNow(seat),
      grave: seat === actor ? [BOOK] : [],
    };
  }
  steps.push(activate(BOOK, actor), everySeat(format, afterActivation));

  // End Phase of the actor: each opponent flips its own monsters and draws for them; the next seat then draws its normal card.
  const afterEndPhase: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const opponent = opponents.includes(seat);
    const normal = seat === next ? 1 : 0;
    afterEndPhase[seat] = {
      monsters: field[seat],
      zones: opponent ? faceUpDefense(seat) : faceDown(seat),
      hand: [...handNow(seat, opponent ? field[seat].length : 0), ...Array.from({ length: normal }, () => DECK[seat])],
      grave: seat === actor ? [BOOK] : [],
    };
  }
  steps.push(endTurn(actor), everySeat(format, afterEndPhase));

  const counts = opponents.map((seat) => `${seat} ${field[seat].length}`).join(", ");
  return defineScenario({
    id: `book-of-eclipse-${format}-${actor}-each-opponent-flips-its-own-monsters-and-draws-for-them`,
    title: `${labelOf(format)}: ${actor} activates Book of Eclipse (every monster turns face-down), then in its End Phase each opponent flips its OWN face-down monsters and draws that many cards (${counts}); ${tag ? "the partner and " : ""}${actor} keep${tag ? "" : "s"} the face-down monsters and draw${tag ? "" : "s"} nothing`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER], lead decision 2026-10-01: Book of Eclipse (each opponent draws for its own face-down monsters)`,
    rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-OPP-FIELD", ...(tag ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "book-of-eclipse", "r1", "each-opponent", "draw", "delayed", format, `actor:${actor}`, "card:35480699"],
    setup: setup as unknown as Scenario["setup"],
    steps,
  });
}

export const BOOK_OF_ECLIPSE_SCENARIOS: Scenario[] = [
  eclipse("ffa3", "p0"),
  eclipse("ffa3", "p1"),
  eclipse("ffa4", "p0"),
  eclipse("ffa4", "p2"),
  eclipse("tag", "p0"),
  eclipse("tag", "p1"),
];
