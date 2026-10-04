// All/both reads include every seat for hand and Graveyard locations too.
import {
  activate, defineScenario, expectBoard, expectOffered, expectPrompt, faceDown, zone,
  type BoardExpect, type DuelistId, type Scenario,
} from "../../support/dsl.js";

import { domainProof } from "./proof-domain.js";

type Format = "ffa3" | "ffa4" | "tag";
const FORMATS: Format[] = ["ffa3", "ffa4", "tag"];
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const MONSTERS = ["Battle Ox", "Axe Raider", "Silver Fang", "Celtic Guardian"];
const DRAGON = "Blue-Eyes White Dragon";
const GEAS = "Final Geas";
const ROYAL = "Royal Tribute";
const NECRO = "Necrovalley";
const SPARKS = "Sparks";
const OOKAZI = "Ookazi";
const HOLE = "Dark Hole";
const seats = (format: Format) => SEATS.slice(0, format === "ffa3" ? 3 : 4);

function proof(format: Format, card: string, setup: Scenario["setup"], board: BoardExpect): Scenario {
  return defineScenario({
    id: `shared-location-${format}-${card === GEAS ? "final-geas-all-graveyards" : "royal-tribute-all-hands"}`,
    title: `${format}: ${card} affects the monsters of every seat without an opponent declaration`,
    source: "Owner answers 2026-10-02; ADR-0002 R-COMMON-ALL-BOTH and R-COMMON-EACH-PLAYER",
    rules: [card === GEAS ? "R-COMMON-ALL-BOTH" : "R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "shared-location", format, `card:${card === GEAS ? 16832845 : 72405967}`],
    setup: { format, ...setup },
    steps: card === GEAS
      ? [activate(HOLE, "p0"), expectOffered("activate", GEAS, "p0"), activate(GEAS, "p0"),
        expectPrompt({ by: "p0", context: "action" }), expectBoard(board)]
      : [expectOffered("activate", ROYAL, "p0"), activate(ROYAL, "p0"), zone("p0", "s0", "p0"),
        expectPrompt({ by: "p0", context: "action" }), expectBoard(board)],
  });
}

function finalGeas(format: Format): Scenario {
  const setup: Scenario["setup"] = {};
  const board: BoardExpect = {};
  for (const [index, seat] of seats(format).entries()) {
    // Each seat has a monster in the GY before the event and a Level 8 monster
    // destroyed by Dark Hole. No banished monster is a Spellcaster.
    setup[seat] = { hand: [SPARKS, ...(seat === "p0" ? [HOLE] : [])], monsters: [DRAGON],
      grave: [MONSTERS[index], OOKAZI], deck: [SPARKS], ...(seat === "p0" ? { spells: [faceDown(GEAS)] } : {}) };
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [SPARKS],
      monsters: [], spells: [], grave: [OOKAZI, ...(seat === "p0" ? [HOLE, GEAS] : [])],
      banished: [MONSTERS[index], DRAGON], extra: [], deckCount: 20 };
  }
  return proof(format, GEAS, setup, board);
}

function royalTribute(format: Format): Scenario {
  const setup: Scenario["setup"] = {};
  const board: BoardExpect = {};
  for (const [index, seat] of seats(format).entries()) {
    setup[seat] = { hand: [MONSTERS[index], SPARKS, ...(seat === "p0" ? [ROYAL] : [])],
      grave: [OOKAZI], deck: [SPARKS], ...(seat === "p0" ? { field: NECRO } : {}) };
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [SPARKS],
      monsters: [], spells: seat === "p0" ? [NECRO] : [],
      grave: [OOKAZI, MONSTERS[index], ...(seat === "p0" ? [ROYAL] : [])], banished: [], extra: [],
      deckCount: 20 };
  }
  return proof(format, ROYAL, setup, board);
}

export const SHARED_LOCATION_PROOF_SCENARIOS = FORMATS.flatMap(format => [finalGeas(format), royalTribute(format)]);

// These are true Domain duels, with a Deck Master at every seat. The untouched
// Deck Masters stay in their zones while the hands, GYs and fields are checked.
export const SHARED_LOCATION_DOMAIN_PROOF_SCENARIOS: Scenario[] = SHARED_LOCATION_PROOF_SCENARIOS.map(s => domainProof(s, SPARKS));
