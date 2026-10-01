// Live scenarios of cards that the R2 triage lists as working without a change, and that nobody had run yet (Raging Cloudian
// 23639291, Ancient Gear Castle 92001300, War Rock Skyler 72554862). Plain data (scripts/rule-coverage.ts reads it); r2-checks.test.ts runs it on a
// live core (NSEAT_LIVE=1) with the real card scripts and the overlay. Every scenario ends with the state of EVERY seat.

import {
  activate, changePosition, defineScenario, endTurn, expectBoard, expectOffered, expectPrompt, faceDown,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const ELF = "Mystical Elf"; // 800 ATK
const ALTUS = "Cloudian - Altus"; // destroys itself in face-up Defense Position
const RAGING = "Raging Cloudian";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER]`;

/**
 * Raging Cloudian (a global watcher, registered with Duel.RegisterEffect(e,0)): the Cloudian monster of a duelist is destroyed by its own effect
 * (Cloudian - Altus destroys itself in face-up Defense Position). Only the Raging Cloudian of THAT duelist is offered; it Special Summons the
 * monster back. The other two duelists each hold a Raging Cloudian, and none is asked.
 */
const raging = (format: "ffa3" | "ffa4", holder: Seat): Scenario => {
  const seats = seatsOf(format);
  const before: Step[] = seats.slice(0, seats.indexOf(holder)).map((seat) => endTurn(seat));
  const setup: Record<string, unknown> = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    setup[seat] = { monsters: seat === holder ? [ALTUS] : [], spells: [faceDown(RAGING)], deck: [ELF] };
    spec[seat] = seat === holder ? { grave: [RAGING], monsters: [ALTUS] } : { spells: [RAGING] };
  }
  return defineScenario({
    id: `r2-checks-${format}-raging-cloudian-only-the-seat-of-the-destroyed-cloudian-is-offered-${holder}`,
    title: `${format.toUpperCase()}: Cloudian - Altus of ${holder} destroys itself in Defense Position: Raging Cloudian of ${holder} is offered and Special Summons it in Attack Position, the Raging Cloudian of every other seat stays Set and is not asked`,
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2-checks", format, "card:23639291"],
    setup: setup as unknown as Scenario["setup"],
    steps: [
      ...before,
      changePosition(ALTUS, holder),
      // expectOffered also checks that the open prompt is for the holder, so no other seat was asked first
      expectOffered("activate", RAGING, holder),
      activate(RAGING, holder),
      expectPrompt({ by: holder, context: "action" }),
      everySeat(format, spec),
    ],
  });
};

export const R2_CHECK_SCENARIOS: Scenario[] = [raging("ffa3", "p0"), raging("ffa3", "p1"), raging("ffa3", "p2"), raging("ffa4", "p3")];
