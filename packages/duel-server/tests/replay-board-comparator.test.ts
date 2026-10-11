import { expect, it } from "vitest";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { sameReplayBoard } from "../src/replay-board-comparator.js";

function board(): DuelEngineView {
  const card = { controller: 0, location: 4, sequence: 0, code: 100, position: 1,
    attack: 1500, defense: 1000, counters: [{ type: 2, count: 1 }, { type: 1, count: 3 }] };
  return { revision: 3, turn: 2, turnSeat: 0, phase: "main1", battleStep: null,
    seats: [0, 1].map(seat => ({ seat, lp: 8000, hand: [{ ...card, location: 2 }], extra: [{ ...card, location: 64 }],
      deckCount: 35, extraCount: 1, monsters: [{ ...card, materials: [{ ...card, location: 128 }] }, null],
      spells: [{ ...card, location: 8 }], graveyard: [{ ...card, location: 16 }], banished: [{ ...card, location: 32 }],
      deckMaster: { card: { ...card, name: "Master", description: "Text", type: 1, level: 4, attribute: 1, race: "1" },
        inZone: true, returns: 0, nextCost: 1000 } })),
    chain: [{ index: 1, seat: 0, code: 100, zone: { controller: 0, location: 4, sequence: 0 },
      targets: [{ controller: 1, location: 4, sequence: 0 }], chosenOptions: [{ index: 0, text: "Choice" }] }],
    prompt: null, log: [], events: [], result: { winnerSeat: 0, reason: "Surrender" } };
}

it("compares equal game states without mutation", () => {
  const saved = board(), rebuilt = structuredClone(saved);
  expect(sameReplayBoard(saved, rebuilt)).toBe(true);
  expect(saved).toEqual(rebuilt);
});

const changes: Array<[string, (view: DuelEngineView) => void]> = [
  ["LP", v => { v.seats[0]!.lp--; }],
  ["turn", v => { v.turn++; }], ["turn seat", v => { v.turnSeat++; }],
  ["phase", v => { v.phase = "end"; }], ["battle step", v => { v.battleStep = "damage"; }],
  ["format", v => { v.format = "tag"; }], ["seat order", v => { v.seats.reverse(); }],
  ["deck count", v => { v.seats[0]!.deckCount--; }], ["extra count", v => { v.seats[0]!.extraCount++; }],
  ...(["hand", "extra", "graveyard", "banished", "monsters", "spells"] as const).map(zone =>
    [`${zone} code`, (v: DuelEngineView) => { v.seats[0]![zone][0]!.code!++; }] as [string, (v: DuelEngineView) => void]),
  ["hidden identity", v => { delete v.seats[0]!.hand[0]!.code; }],
  ["position and face", v => { v.seats[0]!.monsters[0]!.position = 8; }],
  ["controller", v => { v.seats[0]!.monsters[0]!.controller = 1; }],
  ["location", v => { v.seats[0]!.monsters[0]!.location = 8; }],
  ["sequence", v => { v.seats[0]!.monsters[0]!.sequence = 2; }],
  ["counters", v => { v.seats[0]!.monsters[0]!.counters![0]!.count++; }],
  ["counter type", v => { v.seats[0]!.monsters[0]!.counters![0]!.type++; }],
  ["empty zone", v => { v.seats[0]!.monsters[0] = null; }],
  ["hand count", v => { v.seats[0]!.hand.pop(); }],
  ["materials", v => { v.seats[0]!.monsters[0]!.materials![0]!.code!++; }],
  ["attack", v => { v.seats[0]!.monsters[0]!.attack!++; }],
  ["defense", v => { v.seats[0]!.monsters[0]!.defense!++; }],
  ["equipped zone", v => { v.seats[0]!.spells[0]!.equippedTo = { controller: 0, location: 4, sequence: 0 }; }],
  ["eliminated", v => { v.seats[0]!.eliminated = true; }],
  ["pending loss", v => { v.seats[0]!.pendingElimination = true; }],
  ["disabled zones", v => { v.seats[0]!.disabledZones = 2; }],
  ["loss order", v => { v.eliminationOrder = [[1]]; }],
  ["team", v => { v.seats[0]!.team = 1; }],
  ["shared zones", v => { v.seats[0]!.sharedExtraWith = 1; }],
  ["master code", v => { v.seats[0]!.deckMaster!.card.code++; }],
  ["master zone", v => { v.seats[0]!.deckMaster!.inZone = false; }],
  ["master returns", v => { v.seats[0]!.deckMaster!.returns++; }],
  ["master cost", v => { v.seats[0]!.deckMaster!.nextCost++; }],
  ["result presence", v => { v.result = null; }],
  ["winner", v => { v.result!.winnerSeat = 1; }],
  ["winner team", v => { v.result!.winnerTeam = 1; }],
  ["result reason", v => { v.result!.reason = "Deck out"; }],
  ["chain presence", v => { v.chain = []; }],
  ["chain code", v => { v.chain[0]!.code!++; }],
  ["chain seat", v => { v.chain[0]!.seat++; }],
  ["chain order", v => { v.chain[0]!.index++; }],
  ["chain zone", v => { v.chain[0]!.zone!.sequence++; }],
  ["chain target", v => { v.chain[0]!.targets![0]!.sequence++; }],
  ["chain choice", v => { v.chain[0]!.chosenOptions![0]!.index!++; }],
];
it.each(changes)("detects a difference in %s", (_name, change) => {
  const rebuilt = board(); change(rebuilt);
  expect(sameReplayBoard(board(), rebuilt)).toBe(false);
});

it("ignores logs, events, revisions, clock, timestamps, prompts, animation IDs and printed text", () => {
  const rebuilt = board();
  Object.assign(rebuilt, { revision: 99, log: [{ id: 50, text: "Changed log" }], events: [{ id: 5 }],
    clock: { remaining: 500 }, checkedAt: "later", prioritySeat: 1, chainMode: "off", prompt: { id: "new" } });
  Object.assign(rebuilt.seats[0]!.hand[0]!, { handId: "new", name: "New name", description: "New text", canonicalPasscode: 999 });
  Object.assign(rebuilt.chain[0]!, { name: "New", text: "New", description: "New" });
  rebuilt.chain[0]!.chosenOptions![0]!.text = "New wording";
  expect(sameReplayBoard(board(), rebuilt)).toBe(true);
});
it("normalizes absent default fields and counter order", () => {
  const rebuilt = board(); rebuilt.format = "1v1";
  rebuilt.seats[0]!.monsters[0]!.counters!.reverse();
  rebuilt.seats[0]!.eliminated = false; rebuilt.seats[0]!.disabledZones = 0;
  rebuilt.result!.reason = "Surrendered";
  expect(sameReplayBoard(board(), rebuilt)).toBe(true);
});
it("fails closed for an invalid saved board", () => {
  expect(sameReplayBoard({ seats: [] } as unknown as DuelEngineView, board())).toBe(false);
});
