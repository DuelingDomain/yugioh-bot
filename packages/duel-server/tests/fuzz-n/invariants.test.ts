import { describe, expect, it } from "vitest";
import type { DuelCard, DuelEngineView, DuelFormat } from "@yugidraft/shared/duels";
import { CHECKS, NChecker, type NViews } from "./invariants.js";

// The privacy check is pure over views, so these tests need no engine core.
const FORMAT: DuelFormat = "tag";
const DON_THOUSAND = 56673480;
const SPELL_FACEUP = 5;
const HAND_FACEDOWN = 10;

function card(controller: number, location: number, code: number | undefined, position: number): DuelCard {
  return { controller, location, sequence: 0, position, ...(code !== undefined ? { code, name: `c${code}` } : {}) };
}

function view(handOfSeat3: DuelCard[], fieldOfSeat2: Array<DuelCard | null>): DuelEngineView {
  const seats = Array.from({ length: 4 }, (_, seat) => ({
    seat,
    lp: 8000,
    hand: seat === 3 ? handOfSeat3 : [],
    deckCount: 30,
    extraCount: 0,
    extra: [],
    monsters: [],
    spells: seat === 2 ? fieldOfSeat2 : [],
    graveyard: [],
    banished: [],
    team: seat % 2,
  }));
  return { revision: 1, format: FORMAT, turn: 1, turnSeat: 0, phase: "main1", seats, prompt: null, chain: [], events: [], log: [], result: null };
}

function privacyViolations(fieldOfSeat2: Array<DuelCard | null>) {
  const drawn = card(3, 2, 98239899, HAND_FACEDOWN);
  const spectator = view([drawn], fieldOfSeat2);
  const views: NViews = { seats: [0, 1, 2, 3].map(() => view([drawn], fieldOfSeat2)), spectator };
  return new NChecker(FORMAT).check(0, views).filter((entry) => entry.invariant === CHECKS.privacy);
}

describe("privacy check: hand cards that a field card reveals", () => {
  it("reports a revealed hand card when no card on a field explains it", () => {
    expect(privacyViolations([])).not.toHaveLength(0);
  });

  it("accepts a revealed hand card while a face-up Contract with Don Thousand is on a field", () => {
    expect(privacyViolations([card(2, 8, DON_THOUSAND, SPELL_FACEUP)])).toHaveLength(0);
  });

  it("does not accept the excuse from a face-down copy of the card", () => {
    expect(privacyViolations([card(2, 8, DON_THOUSAND, 8)])).not.toHaveLength(0);
  });
});
