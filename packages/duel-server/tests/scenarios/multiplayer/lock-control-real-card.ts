import {
  activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered,
  expectPickSeats, expectPrompt, normalSummon, pickOpponent, select, xyz,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

const SOURCE = "Number 18: Heraldry Patriarch";
const BIG_EYE = "Number 11: Big Eye";
const OX = "Battle Ox";
const ELF = "Mystical Elf";
const FANG = "Silver Fang";
const REMOVE = "Smashing Ground";

function proof(format: "ffa3" | "ffa4" | "tag", domain: boolean): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  // The Xyz monsters start with one remaining material. Each stock effect uses it.
  for (const seat of seats) setup[seat] = {
    monsters: seat === "p0" ? [xyz(SOURCE, [FANG]), OX]
      : seat === "p1" ? [xyz(BIG_EYE, [ELF]), OX] : [OX],
    hand: [OX, ...(seat === "p0" ? [REMOVE] : [])], deck: Array(20).fill(ELF),
    ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  const draws = seats.map(seat => seat === "p0" ? Number(domain) : 0);
  const summoned = new Set<DuelistId>();
  let stolen = false;
  let removed = false;
  const board = (): BoardExpect => Object.fromEntries(seats.map((seat, i) => {
    const hasSource = !removed && (stolen ? seat === "p1" : seat === "p0");
    return [seat, {
      lp: format === "tag" ? 16000 : 8000,
      monsters: [
        ...(seat === "p0" ? stolen ? [OX] : [SOURCE, OX] : seat === "p1" ? [BIG_EYE] : []),
        ...(stolen && !removed && seat === "p1" ? [SOURCE] : []), ...(summoned.has(seat) ? [OX] : []),
      ],
      hand: [...(summoned.has(seat) ? [] : [OX]), ...(seat === "p0" && !removed ? [REMOVE] : []),
        ...Array(draws[i]).fill(ELF)],
      deckCount: 20 - draws[i], spells: [],
      grave: seat === "p0" ? [FANG, ...(removed ? [REMOVE, SOURCE] : [])]
        : seat === "p1" && stolen ? [OX, ELF] : [OX],
      banished: [], extra: [],
      zones: {
        ...(seat === "p1" ? { m0: { card: BIG_EYE, materials: stolen ? 0 : 1 } } : {}),
        ...(hasSource ? { [stolen ? "m1" : "m0"]: { card: SOURCE, materials: 0, pos: "atk" } } : {}),
      },
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
    }];
  }));
  const steps: Step[] = [activate(SOURCE, "p0")];
  if (format !== "tag") steps.push(expectPickSeats(seats.slice(1), "p0"), pickOpponent("p1", "p0"));
  // The stock all-field destruction keeps p0's chosen Ox and destroys the other face-up copies.
  steps.push(select({ card: OX, owner: "p0" }), expectPrompt({ by: "p0", context: "action" }),
    expectOffered("normalSummon", OX, "p0"), expectBoard(board()), endTurn("p0"),
    expectPrompt({ by: "p1", context: "action" }));
  draws[1]++;
  steps.push(expectNotOffered("normalSummon", OX, "p1"), expectOffered("normalSummon", ELF, "p1"),
    activate(BIG_EYE, "p1"), select({ card: SOURCE, owner: "p0" }),
    expectPrompt({ by: "p1", context: "action" }));
  stolen = true;
  steps.push(expectBoard(board()), expectOffered("normalSummon", OX, "p1"), normalSummon(OX, "p1"),
    expectPrompt({ by: "p1", context: "action" }));
  summoned.add("p1");
  steps.push(expectBoard(board()));
  // Check a real Main Phase prompt for every seat after the control change.
  for (let i = 2; i <= seats.length; ++i) {
    const previous = seats[(i - 1) % seats.length], seat = seats[i % seats.length];
    draws[i % seats.length]++;
    steps.push(endTurn(previous), expectPrompt({ by: seat, context: "action" }));
    const locked = seat === "p0" || format === "tag" && seat === "p2";
    if (locked) steps.push(expectNotOffered("normalSummon", OX, seat), expectOffered("normalSummon", ELF, seat));
    else {
      steps.push(expectOffered("normalSummon", OX, seat), normalSummon(OX, seat),
        expectPrompt({ by: seat, context: "action" }));
      summoned.add(seat);
    }
    steps.push(expectBoard(board()));
  }
  // Smashing Ground destroys the stolen source (2200 DEF), above Big Eye (2000) and Ox (1000).
  // Its own continuous lock ends when it leaves the field. A player lock would remain.
  steps.push(activate(REMOVE, "p0"));
  if (format !== "tag") steps.push(expectPickSeats(seats.slice(1), "p0"), pickOpponent("p1", "p0"));
  steps.push(expectPrompt({ by: "p0", context: "action" }));
  removed = true;
  steps.push(expectBoard(board()), expectOffered("normalSummon", OX, "p0"), normalSummon(OX, "p0"),
    expectPrompt({ by: "p0", context: "action" }));
  summoned.add("p0");
  steps.push(expectBoard(board()));
  return defineScenario({
    id: `lock-control-heraldry-${format}${domain ? "-domain" : ""}`,
    title: `${format}: Heraldry Patriarch's continuous summon lock follows control`,
    source: "Number 18: Heraldry Patriarch 23649496; stock c23649496.lua; owner continuous-lock scope, 2026-10-03",
    rules: ["R-FFA-LOCK-CONTROL-CHANGE", ...(format === "tag" ? ["R-TAG-PARTNER"] : ["R-FFA-ACTIVATED-LOCK"])],
    tags: ["multiplayer", "control-change", "card:23649496"], setup, steps,
  });
}

export const LOCK_CONTROL_REAL_CARD_SCENARIOS = [false, true].flatMap(domain =>
  (["ffa3", "ffa4", "tag"] as const).map(format => proof(format, domain)));
