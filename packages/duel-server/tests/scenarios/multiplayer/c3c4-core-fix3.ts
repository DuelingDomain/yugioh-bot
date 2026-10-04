import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt,
  pickOpponent, select, type Scenario, type DuelistId, type Step, type BoardExpect } from "../../support/dsl.js";

const SOURCE = "Giant Soldier of Stone";
const OX = "Battle Ox";
const ELF = "Mystical Elf";
const HEART = "Change of Heart";
type Case = "delayed" | "clone" | "turn-read" | "control";

function proof(format: "ffa3" | "ffa4" | "tag", domain: boolean, testCase: Case): Scenario {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const declared: DuelistId = testCase === "control" ? "p1" : "p2";
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  for (const seat of seats) setup[seat] = {
    monsters: seat === "p0" ? [SOURCE, OX] : [OX], deck: Array(20).fill(ELF),
    ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  if (testCase === "control") setup.p1!.hand = [HEART];
  if (testCase === "turn-read") setup.p1!.spells = [{ card: "Waboku", pos: "set" }];
  const steps: Step[] = [activate(SOURCE, "p0")];
  if (format !== "tag") steps.push(expectPickSeats(seats.slice(1), "p0"), pickOpponent(declared, "p0"));
  if (testCase === "turn-read") {
    // The declaration must be before the response window.
    steps.push(expectPrompt({ by: "p1", context: "chain" }), activate("Waboku", "p1"));
  } else {
    steps.push(endTurn("p0"), expectPrompt({ by: "p1", context: "action" }));
  }
  if (testCase === "control") {
    steps.push(activate(HEART, "p1"));
    if (format !== "tag") steps.push(expectPickSeats(seats.filter(s => s !== "p1"), "p1"), pickOpponent("p0", "p1"));
    steps.push(select({ card: SOURCE, owner: "p0" }), expectPrompt({ by: "p1", context: "action" }));
  }
  const board: BoardExpect = {};
  for (const seat of seats) {
    const drawn = seat === "p0" ? Number(domain) : seat === "p1" && testCase !== "turn-read" ? 1 : 0;
    const boost = testCase === "control"
      ? format === "tag" ? seat === "p0" || seat === "p2" : seat === "p0"
      : testCase === "clone" ? seat !== "p0"
      : format === "tag" ? seat === "p1" || seat === "p3" : seat === declared;
    board[seat] = {
      lp: (format === "tag" ? 16000 : 8000) + (testCase === "turn-read" && seat === declared ? 100 : 0),
      monsters: seat === "p0" ? testCase === "control" ? [OX] : [SOURCE, OX]
        : seat === "p1" && testCase === "control" ? [OX, SOURCE] : [OX],
      zones: { [seat === "p0" ? "m1" : "m0"]: { card: OX, attack: 1700 + (boost ? 700 : 0) } },
      hand: Array(drawn).fill(ELF), deckCount: 20 - drawn, spells: [], banished: [],
      grave: testCase === "control" && seat === "p1" ? [HEART]
        : testCase === "turn-read" && seat === "p1" ? ["Waboku"] : [],
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
    };
  }
  // The clone control in Tag still uses the opposing team.
  if (testCase === "clone" && format === "tag") board.p2!.zones = { m0: { card: OX, attack: 1700 } };
  steps.push(expectBoard(board));
  return defineScenario({ id: `c3c4-fix3-${testCase}-${format}${domain ? "-domain" : ""}`,
    title: `${format}: ${testCase} keeps the correct opponent`, setup, steps,
    source: "C3/C4 fix3 review and DECISIONS-2026-10-01.md",
    rules: [testCase === "control" ? "R-FFA-LOCK-CONTROL-CHANGE" : "R-FFA-ACTIVATED-LOCK"],
    tags: ["multiplayer", `fixture:${testCase}`] });
}

export const C3C4_CORE_FIX3_SCENARIOS: Scenario[] = [false, true].flatMap(domain =>
  (["ffa3", "ffa4", "tag"] as const).flatMap(format =>
    (["delayed", "clone", "control", ...(format === "tag" ? [] : ["turn-read"])] as Case[])
      .map(testCase => proof(format, domain, testCase))));
