// Live scenarios of the R1 cards that the Table test listed as known gaps (Grapha, Dangerous Machine Type-6) and of the R1 stock parts that
// were checked against the owner rules (Q3 each duelist, R-COMMON-OPP-PICK). Plain data, also read by scripts/rule-coverage.ts;
// gaps-r1.test.ts runs it on a live core (NSEAT_LIVE=1), on the Standard multi core and again on the Domain multi core. Every scenario uses
// the real card scripts plus the overlay, and ends with the state of EVERY seat (LP, field, hand, GY, banished zone).

import {
  activate, defineScenario, expectBoard,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const ELF = "Mystical Elf";
const HOLE = "Dark Hole";
const GRAPHA = "Grapha, Dragon Overlord of Dark World";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);
const labelOf = (format: Format) => (format === "tag" ? "Tag" : format.toUpperCase());

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, hand, Graveyard and banished zone are exact unless the spec names them. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>, lp = format === "tag" ? 16000 : 8000): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], hand: [], ...spec[seat] };
  return expectBoard(board);
}

// --- Grapha, Dragon Overlord of Dark World -----------------------------------------------------------------------------------------
// The first effect changes the chain link of another duelist into "the controller of Grapha discards 1 card". The new operation runs as the
// link of the duelist that activated Dark Hole (no bound opponent there), so the overlay binds the seat of the controller of Grapha again.
// Only that seat discards: the activator, the third seat and in Tag the partners keep their hands and fields (Dark Hole is not applied).
const GRAPHA_SOURCE = `${SOURCE} [R-FFA-CHAIN], card decisions 2026-10-01: Grapha (the changed link makes the controller of Grapha discard 1 card, nobody else)`;

function grapha(format: Format): Scenario {
  const tag = format === "tag";
  const setup: Scenario["setup"] = {
    format,
    p0: { hand: [HOLE], monsters: [RAT] },
    p1: { hand: [OX], monsters: [GRAPHA] },
    p2: { hand: [AXE], monsters: [ELF] },
    ...(tag ? { p3: { hand: [FANG] } } : {}),
  };
  return defineScenario({
    id: `gaps-r1-${format}-grapha-changed-link-makes-its-controller-discard`,
    title: `${labelOf(format)}: p0 activates Dark Hole, p1 answers with Grapha: Dark Hole is changed, only p1 (the controller of Grapha) discards 1 card, every monster stays`,
    source: GRAPHA_SOURCE,
    rules: tag ? ["R-TAG-PARTNER"] : ["R-FFA-CHAIN"],
    tags: ["multiplayer", "gaps-r1", "r1", "chain", format, "card:39552584", "card:53129443"],
    setup,
    steps: [
      activate(HOLE, "p0"),
      activate(GRAPHA, "p1"),
      everySeat(format, {
        p0: { monsters: [RAT], grave: [HOLE] },
        p1: { monsters: [GRAPHA], grave: [OX] },
        p2: { monsters: [ELF], hand: [AXE] },
        ...(tag ? { p3: { hand: [FANG] } } : {}),
      }),
    ],
  });
}

export const GAPS_R1_SCENARIOS: Scenario[] = [grapha("ffa3"), grapha("tag")];
