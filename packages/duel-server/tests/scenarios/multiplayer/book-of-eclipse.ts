// Book of Eclipse: the first flip affects every seat. In FFA, the End Phase flip and draw affect the opponent declared at activation.
// Tag still flips and draws per opposing controller. FFA IDs name the declared opponent; LIVE_PROOF uses the same IDs.
// Reason for changed FFA expectations: owner decision 2026-10-02 replaces the each-opponent delayed result.

import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, pass, pickOpponent, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
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

function eclipse(format: Format, actor: Seat, noMonsters = false): Scenario {
  const tag = format === "tag";
  const seats = seatsOf(format);
  const actorIndex = seats.indexOf(actor);
  const next = seats[(actorIndex + 1) % seats.length];
  const declared: Seat = noMonsters ? "p2" : actor === "p0" ? (format === "ffa4" ? "p3" : "p2") : actor === "p1" ? "p0" : "p1";
  const opponents = seats.filter((seat) => (tag ? teamOf(seat) !== teamOf(actor) : seat === declared));
  const field = MONSTERS[format];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) {
    setup[seat] = {
      hand: seat === actor ? [BOOK, HAND[seat]] : [HAND[seat]],
      monsters: field[seat],
      deck: Array.from({ length: 8 }, () => DECK[seat]),
    };
  }
  // Standard MR5 skips p0's turn-1 draw. Each later seat draws at the start of its turn.
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
      deckCount: 20 - normalDraws(seat),
      grave: seat === actor ? [BOOK] : [],
    };
  }
  steps.push(activate(BOOK, actor),
    ...(tag ? [] : [expectPrompt({ by: actor, context: "opponent" }), expectPickSeats(seats.filter((seat) => seat !== actor), actor), pickOpponent(declared, actor)]),
    everySeat(format, afterActivation));

  // The End Phase uses the activation binding in FFA; Tag still flips and draws per opposing controller.
  const afterEndPhase: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const opponent = opponents.includes(seat);
    const normal = seat === next ? 1 : 0;
    afterEndPhase[seat] = {
      monsters: field[seat],
      zones: opponent ? faceUpDefense(seat) : faceDown(seat),
      hand: [...handNow(seat, opponent ? field[seat].length : 0), ...Array.from({ length: normal }, () => DECK[seat])],
      deckCount: 20 - normalDraws(seat) - (opponent ? field[seat].length : 0) - normal,
      grave: seat === actor ? [BOOK] : [],
    };
  }
  steps.push(endTurn(actor), everySeat(format, afterEndPhase));

  const counts = opponents.map((seat) => `${seat} ${field[seat].length}`).join(", ");
  return defineScenario({
    id: noMonsters ? "book-of-eclipse-ffa4-p0-declared-p2-has-no-monsters-no-other-opponent-flips-or-draws" : `book-of-eclipse-${format}-${actor}-${tag ? "each-opponent" : "declared-opponent"}-flips-its-own-monsters-and-draws-for-them`,
    title: `${labelOf(format)}: ${actor} activates Book of Eclipse; all monsters turn face-down, then ${tag ? "each opposing member" : `only declared ${declared}`} flips its monsters and draws for them (${counts})`,
    source: `${SOURCE} ${tag ? "[R-COMMON-EACH-PLAYER]" : "[R-FFA-OPP-ONE]"}, owner decision 2026-10-02: Book of Eclipse`,
    rules: tag ? ["R-COMMON-EACH-PLAYER", "R-TAG-PARTNER", "R-COMMON-ALL-BOTH"] : ["R-FFA-OPP-ONE", "R-COMMON-ALL-BOTH"],
    tags: ["multiplayer", "book-of-eclipse", "declared-opponent", "draw", "delayed", format, `actor:${actor}`, "card:35480699"],
    setup: setup as unknown as Scenario["setup"],
    steps,
  });
}

// Off-turn activation declares p2 in p1's turn. The End Phase retains p2, even though p1 is the turn player.
function eclipseOffTurn(): Scenario {
  const format: Format = "ffa3";
  const actor: Seat = "p0";
  const seats = seatsOf(format);
  const field = MONSTERS[format];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) {
    setup[seat] = {
      hand: [HAND[seat]],
      monsters: field[seat],
      ...(seat === actor ? { spells: [{ card: BOOK, pos: "set" }] } : {}),
      deck: Array.from({ length: 8 }, () => DECK[seat]),
    };
  }
  const faceDown = (seat: Seat) => Object.fromEntries(field[seat].map((card, index) => [`m${index}`, { card, pos: "set" as const }]));
  const faceUpDefense = (seat: Seat) => Object.fromEntries(field[seat].map((card, index) => [`m${index}`, { card, pos: "def" as const }]));
  const draws = (seat: Seat, count: number) => Array.from({ length: count }, () => DECK[seat]);

  // p0 skips its first draw; p1 draws. p0 declines its End Phase window, then activates Book in p1 turn.
  const afterActivation: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    afterActivation[seat] = {
      monsters: field[seat],
      zones: faceDown(seat),
      hand: [HAND[seat], ...draws(seat, seat === "p1" ? 1 : 0)],
      deckCount: seat === "p1" ? 19 : 20,
      grave: seat === actor ? [BOOK] : [],
    };
  }
  // Only p2 flips and draws in the End Phase; p1 keeps both face-down monsters.
  const afterEndPhase: Partial<Record<Seat, DuelistExpect>> = {
    p0: { monsters: field.p0, zones: faceDown("p0"), hand: [HAND.p0], deckCount: 20, grave: [BOOK] },
    p1: { monsters: field.p1, zones: faceDown("p1"), hand: [HAND.p1, ...draws("p1", 1)], deckCount: 19 },
    p2: { monsters: field.p2, zones: faceUpDefense("p2"), hand: [HAND.p2, ...draws("p2", 3 + 1)], deckCount: 16 },
  };
  return defineScenario({
    id: "book-of-eclipse-ffa3-p0-activates-in-the-turn-of-p1-declared-opponent-flips-its-own-monsters-and-draws-for-them",
    title: "FFA3: p0 activates Set Book of Eclipse in p1 turn, declares p2, and only p2 flips and draws in p1 End Phase",
    source: `${SOURCE} [R-FFA-OPP-ONE], owner decision 2026-10-02: Book of Eclipse off-turn binding`,
    rules: ["R-FFA-OPP-ONE", "R-COMMON-ALL-BOTH"],
    tags: ["multiplayer", "book-of-eclipse", "declared-opponent", "draw", "delayed", "off-turn", format, `actor:${actor}`, "card:35480699"],
    setup: setup as unknown as Scenario["setup"],
    steps: [
      endTurn("p0"),
      pass("p0"),
      activate(BOOK, "p0"),
      expectPrompt({ by: "p0", context: "opponent" }),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      everySeat(format, afterActivation),
      endTurn("p1"),
      everySeat(format, afterEndPhase),
    ],
  });
}

export const BOOK_OF_ECLIPSE_SCENARIOS: Scenario[] = [
  eclipse("ffa3", "p0"),
  eclipse("ffa3", "p1"),
  eclipse("ffa4", "p0"),
  eclipse("ffa4", "p2"),
  eclipse("tag", "p0"),
  eclipse("tag", "p1"),
  eclipseOffTurn(),
  // Reason: an empty declared field must not send the delayed effect to a different opponent.
  eclipse("ffa4", "p0", true),
];
