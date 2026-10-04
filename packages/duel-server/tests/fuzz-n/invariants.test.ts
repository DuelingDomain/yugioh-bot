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

function firstAttackChecks(format: DuelFormat, turns: number[], attackTurn: number, eliminated: number[] = []) {
  const checker = new NChecker(format);
  const n = format === "ffa3" ? 3 : 4;
  return turns.flatMap((seat, i) => {
    const snapshot = view([], []);
    snapshot.format = format;
    snapshot.turn = i + 1;
    snapshot.turnSeat = seat;
    snapshot.revision = i + 1;
    snapshot.seats = snapshot.seats.slice(0, n).map((row) => ({ ...row, eliminated: eliminated.includes(row.seat) }));
    snapshot.events = i + 1 === attackTurn ? [{ id: 1, kind: "attack", text: "A real attack was reported", seat }] : [];
    return checker.check(i, { seats: Array.from({ length: n }, () => snapshot), spectator: snapshot })
      .filter((row) => row.invariant === CHECKS.firstAttack);
  });
}

describe("first attack check", () => {
  it("allows the last living FFA seat to attack on its first turn", () => {
    expect(firstAttackChecks("ffa3", [0, 1, 2], 3)).toEqual([]);
    expect(firstAttackChecks("ffa4", [0, 1, 2, 3], 4)).toEqual([]);
  });

  it("does not wait for an eliminated FFA seat to have a turn", () => {
    expect(firstAttackChecks("ffa3", [0, 1], 2, [2])).toEqual([]);
    expect(firstAttackChecks("ffa4", [0, 2, 3], 3, [1])).toEqual([]);
  });

  it("rejects an FFA attack while a living seat still needs its first turn", () => {
    expect(firstAttackChecks("ffa3", [0, 1], 2)).toHaveLength(1);
    expect(firstAttackChecks("ffa4", [0, 1, 2], 3)).toHaveLength(1);
  });

  it("keeps the Tag turn-four rule", () => {
    expect(firstAttackChecks("tag", [0, 1, 2], 3)).toHaveLength(1);
    expect(firstAttackChecks("tag", [0, 1, 2, 3], 4)).toEqual([]);
  });
});
