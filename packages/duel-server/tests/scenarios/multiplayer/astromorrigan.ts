// Astromorrigan: declare one opponent when the flip effect enters the chain in FFA; destroy and damage that same opponent in the End Phase.
// Tag keeps both opposing fields and their shared LP. Old IDs stay because coverage records can name them.
// Reason for changed FFA expectations: owner decision 2026-10-02 replaces the each-opponent delayed result.

import { changePhase, changePosition, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, pickOpponent, raw, type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
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

function astromorrigan(format: Format, actor: Seat, noDefense = false): Scenario {
  const tag = format === "tag";
  const seats = seatsOf(format);
  const actorIndex = seats.indexOf(actor);
  const next = seats[(actorIndex + 1) % seats.length];
  const declared: Seat = noDefense ? "p2" : actor === "p0" ? (format === "ffa4" ? "p3" : "p2") : actor === "p1" ? "p0" : "p1";
  const opponents = seats.filter((seat) => (tag ? teamOf(seat) !== teamOf(actor) : seat === declared));
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
  // Standard MR5 skips p0's turn-1 draw. Each later seat draws at the start of its turn.
  const steps: Step[] = seats.slice(0, actorIndex).map((seat) => endTurn(seat));
  const normalDraws = (seat: Seat) => (seats.indexOf(seat) >= 1 && seats.indexOf(seat) <= actorIndex ? 1 : 0);
  const names = (seat: Seat) => field[seat].map((m) => m.card);
  const handNow = (seat: Seat) => Array.from({ length: normalDraws(seat) }, () => DECK[seat]);

  // After the flip: Astromorrigan is face-up; nothing is destroyed yet.
  const afterFlip: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    afterFlip[seat] = { monsters: seat === actor ? [ASTRO, ...names(seat)] : names(seat), hand: handNow(seat), deckCount: 20 - normalDraws(seat) };
  }
  steps.push(changePosition({ card: ASTRO, owner: actor }, actor),
    ...(tag ? [] : [expectPrompt({ by: actor, context: "opponent" }), expectPickSeats(seats.filter((seat) => seat !== actor), actor), pickOpponent(declared, actor)]),
    everySeat(format, afterFlip));

  // The End Phase uses the activation binding in FFA. Tag still destroys both opposing fields.
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
      deckCount: 20 - normalDraws(seat) - (seat === next ? 1 : 0),
      grave: lost,
    };
  }
  steps.push(endTurn(actor), everySeat(format, afterEndPhase));

  const counts = opponents.map((seat) => `${seat} ${field[seat].filter((m) => m.pos === "def").length}`).join(", ");
  return defineScenario({
    id: noDefense ? "astromorrigan-ffa4-p0-declared-p2-has-no-defense-monsters-no-other-opponent-destroyed-or-damaged" : `astromorrigan-${format}-${actor}-each-opponent-takes-damage-for-its-own-destroyed-monsters`,
    title: tag
      ? `Tag: ${actor} flips Astromorrigan, then in its End Phase the Defense Position monsters of both opposing members are destroyed (${counts}) and the opposing team takes 500 for each (one LP pool, the sum is the stock value); the partner and ${actor} keep their monsters`
      : `${labelOf(format)}: ${actor} flips Astromorrigan and declares ${declared}; only that opponent loses Defense Position monsters (${counts}) and takes 500 damage for each`,
    source: `${SOURCE} ${tag ? "[R-TAG-PARTNER]" : "[R-FFA-OPP-ONE]"}, owner decision 2026-10-02: Astromorrigan`,
    rules: tag ? ["R-TAG-PARTNER", "R-TAG-LP"] : ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "astromorrigan", "declared-opponent", "damage", "delayed", format, `actor:${actor}`, "card:5010422"],
    setup: setup as unknown as Scenario["setup"],
    steps,
  });
}

// Battle flips Astromorrigan in p1 turn. The owner declares p2; the saved effect still uses p2 after Astromorrigan enters the GY.
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
  // Turns 1 to 4 pass. p0 draws on turn 4 only; p1 and p2 draw on their first turns. The attack is in turn 5.
  const steps: Step[] = [endTurn("p0"), endTurn("p1"), endTurn("p2"), endTurn("p0")];
  // p1 attacks the face-down card of p0 with Axe Raider (the only monster of p1 in Attack Position). A face-down card shows no code in
  // the prompt, so the DSL attack() cannot name it: the attacker is the first attack option, the target is the only "Face-down card"
  // option (card:4: the options list the monsters of p2 first, then the card of p0 and its Mystical Elf).
  steps.push(changePhase("battle", "p1"), raw({ choice: "attack:0" }, "p1"), raw({ selected: ["card:4"] }, "p1"),
    expectPrompt({ by: "p0", context: "opponent" }), expectPickSeats(["p1", "p2"], "p0"), pickOpponent("p2", "p0"));
  // The flip: Astromorrigan (DEF 0) is destroyed by the battle; nothing else is destroyed yet and nobody took damage.
  steps.push(
    everySeat(format, {
      p0: { monsters: names("p0"), hand: [DECK.p0], deckCount: 19, grave: [ASTRO] },
      p1: { monsters: names("p1"), hand: [DECK.p1, DECK.p1], deckCount: 18 },
      p2: { monsters: names("p2"), hand: [DECK.p2], deckCount: 19 },
    }),
  );
  // Only declared p2 loses Defense Position monsters and takes damage; p1 keeps its monsters and LP.
  const survivors = (seat: Seat) => field[seat].filter((m) => m.pos === "atk").map((m) => m.card);
  const lost = (seat: Seat) => field[seat].filter((m) => m.pos === "def").map((m) => m.card);
  steps.push(
    endTurn("p1"),
    everySeat(format, {
      p0: { lp: 8000, monsters: names("p0"), hand: [DECK.p0], deckCount: 19, grave: [ASTRO] },
      p1: { lp: 8000, monsters: names("p1"), hand: [DECK.p1, DECK.p1], deckCount: 18, grave: [] },
      p2: { lp: 8000 - 500 * lost("p2").length, monsters: survivors("p2"), hand: [DECK.p2, DECK.p2], deckCount: 18, grave: lost("p2") },
    }),
  );
  return defineScenario({
    id: "astromorrigan-ffa3-p0-flipped-in-the-turn-of-p1-each-opponent-takes-damage-for-its-own-destroyed-monsters",
    title: "FFA3: battle flips p0 Astromorrigan in p1 turn; p0 declares p2 and only p2 loses monsters and takes damage in the End Phase",
    source: `${SOURCE} [R-FFA-OPP-ONE], owner decision 2026-10-02: Astromorrigan off-turn binding`,
    rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "astromorrigan", "declared-opponent", "damage", "delayed", "off-turn", format, `actor:${actor}`, "card:5010422"],
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
  // Reason: no Defense Position monster at the declared seat must not change the affected opponent.
  astromorrigan("ffa4", "p0", true),
];
