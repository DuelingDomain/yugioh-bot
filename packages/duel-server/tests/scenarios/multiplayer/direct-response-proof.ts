// Direct-attack response controls for R-FFA-OPP-RESPONSE. FFA asks only the attacked duelist; Tag can ask the attacked duelist's partner.
import {
  activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectPrompt, faceDown, pickOpponent,
  type BoardExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";
const GATE = "Counter Gate";
const RAT = "Giant Rat";
const DRAW = "Dark Hole";

function directResponse(format: Format, holder: Seat, attacked: Seat, offered: boolean): Scenario {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const setup: Record<string, unknown> = { format };
  for (const seat of seats) setup[seat] = {
    deck: Array.from({ length: 6 }, () => DRAW),
    ...(seat === "p1" ? { monsters: [RAT] } : {}),
    ...(seat === holder ? { spells: [faceDown(GATE)] } : {}),
  };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const normalDraws = seat === "p0" ? 1 : seat === "p1" ? 2 : 1;
    board[seat] = {
      lp: format === "tag" ? 16000 : seat === attacked && !offered ? 6600 : 8000,
      monsters: seat === "p1" ? [RAT] : [],
      spells: seat === holder && !offered ? [GATE] : [],
      grave: seat === holder && offered ? [GATE] : [],
      banished: [],
      hand: Array.from({ length: normalDraws + (seat === holder && offered ? 1 : 0) }, () => DRAW),
      deckCount: 20 - normalDraws - (seat === holder && offered ? 1 : 0),
    };
  }
  const steps: Step[] = [
    ...seats.map((seat) => endTurn(seat)),
    endTurn("p0"),
    changePhase("battle", "p1"),
    attack(RAT, "direct", "p1"),
    pickOpponent(attacked, "p1"),
    ...(offered ? [activate(GATE, holder)] : []),
    expectPrompt({ by: "p1", context: "action", offers: ["to_m2", "to_ep"] }),
    expectBoard(board),
  ];
  return defineScenario({
    id: `direct-response-proof-${format}-${holder}-${attacked}-${offered ? "offered" : "not-offered"}`,
    title: `${format.toUpperCase()}: p1 attacks ${attacked} directly; Counter Gate of ${holder} is ${offered ? "offered and negates the attack" : "not offered and the attacked seat takes 1400"}`,
    source: `${SOURCE} [R-FFA-OPP-RESPONSE], owner decision 2026-10-02`,
    rules: ["R-FFA-OPP-RESPONSE", ...(format === "tag" ? ["R-TAG-ATTACK"] : ["R-FFA-ATTACK"])],
    tags: ["multiplayer", "direct-response", format, "card:94561645"],
    setup: setup as Scenario["setup"],
    steps,
  });
}

export const DIRECT_RESPONSE_PROOF_SCENARIOS: Scenario[] = [
  directResponse("ffa3", "p0", "p0", true),
  directResponse("ffa3", "p0", "p2", false),
  directResponse("ffa4", "p0", "p0", true),
  directResponse("ffa4", "p0", "p3", false),
  directResponse("tag", "p2", "p0", true),
  directResponse("tag", "p0", "p2", true),
];
