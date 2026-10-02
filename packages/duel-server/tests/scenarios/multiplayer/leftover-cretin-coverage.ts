import { activate, changePosition, endTurn, expectPickOptions, expectPrompt, select, zone, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";

const CRETIN = "Spear Cretin", HOLE = "Dark Hole";
const PAIRS = [["Celtic Guardian", "Beaver Warrior"], ["Battle Ox", "Axe Raider"], ["Silver Fang", "Giant Soldier of Stone"], ["Mystical Elf", "Neo the Magic Swordsman"]];
function proof(format: Format, actor: Seat, emptyPartner: boolean): Scenario {
  const order = emptyPartner ? ["p0", "p1", "p3"] as Seat[] : ["p2", "p3", "p0", "p1"] as Seat[];
  return defineScenario({
    id: `leftover-spear-cretin-${format}-${actor}-${emptyPartner ? "empty-partner" : "late-actor"}`,
    title: `${format}: Spear Cretin ${emptyPartner ? "skips the empty partner Graveyard" : "starts the choices with the late turn player p2"}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", format, "card:58551308"],
    setup: baseSetup(format, Object.fromEntries(SEATS[format].map((seat, i) => [seat, {
      grave: emptyPartner && seat === "p2" ? [] : PAIRS[i],
      ...(seat === actor ? { monsters: [{ card: CRETIN, pos: "set" }], hand: [HOLE] } : {}),
    }]))),
    steps: [
      ...(actor === "p2" ? [endTurn("p0"), endTurn("p1")] : []),
      changePosition(CRETIN, actor), activate(HOLE, actor), zone(actor, "s0", actor),
      ...order.flatMap((seat) => { const pair = PAIRS[Number(seat[1])]; return [expectPickOptions(pair.map((card) => ({ seat, card })), seat), select({ card: pair[0], owner: seat })]; }),
      expectPrompt({ by: actor, context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat, i) => [seat, {
        monsters: emptyPartner && seat === "p2" ? [] : [PAIRS[i][0]],
        grave: [...(emptyPartner && seat === "p2" ? [] : [PAIRS[i][1]]), ...(seat === actor ? [CRETIN, HOLE] : [])],
        hand: actor === "p2" && (seat === "p1" || seat === "p2") ? ["Mystical Elf"] : [],
        deckCount: actor === "p2" && (seat === "p1" || seat === "p2") ? 19 : 20,
      }]))),
    ],
  });
}
export const LEFTOVER_CRETIN_COVERAGE_SCENARIOS = [proof("ffa4", "p2", false), proof("tag", "p0", true)];
