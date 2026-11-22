// Cyber Jar: "both players" means every living duelist (R-COMMON-EACH-PLAYER). Every seat reveals its own top 5 cards.
// Level 4 or lower monsters are Special Summoned to the field of their Deck owner; the other cards go to that hand.
import {
  changePosition, expectBoard, faceDown, position, zone,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4";
const JAR = "Cyber Jar";
const FIELD = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
const TOP = ["Mystical Elf", "Beaver Warrior", "Celtic Guardian", "Neo the Magic Swordsman"];
const FILLER = "Dark Hole";
const seat = (n: number) => `p${n}` as DuelistId;

function cyberJar(format: Format): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true };
  const board: BoardExpect = {};
  const steps: Step[] = [changePosition(JAR, "p0")];
  for (let i = 0; i < n; i++) {
    setup[seat(i)] = {
      monsters: i === 0 ? [faceDown(JAR)] : [FIELD[i]],
      deck: [TOP[i], FILLER, FILLER, FILLER, FILLER],
    };
    board[seat(i)] = {
      lp: 8000, monsters: [TOP[i]], spells: [], hand: [FILLER, FILLER, FILLER, FILLER], banished: [],
      grave: i === 0 ? [JAR] : [FIELD[i]],
    };
    // The summon happens duelist by duelist from the turn player: one free zone is picked, then the position.
    steps.push(zone(seat(i), "m0", seat(i)), position("atk", seat(i)));
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `both-players-jar-${format}-cyber-jar-reveals-for-every-duelist`,
    title: `${format.toUpperCase()}: p0 flips Cyber Jar, every monster is destroyed, then every duelist (not only two) reveals the top 5 cards, summons its monster and adds the other cards to its hand`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "each-player", format, "card:34124316"], setup, steps,
  });
}

export const BOTH_PLAYERS_JAR_SCENARIOS: Scenario[] = [cyberJar("ffa3"), cyberJar("ffa4")];
