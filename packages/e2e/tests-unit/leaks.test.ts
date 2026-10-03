import assert from "node:assert/strict";
import { test } from "node:test";
import { findLeaks, knownSinceFromSteps, leakMessage, NumberCapture, scanNumbers, secretCodes, stripOwnDeck, type LeakTruth } from "../helpers/leaks.ts";

// Seat 0 deck: 11111111 (drawn), 22222222. Seat 1 deck: 33333333, 44444444 (played face-up), 11111111.
const truth: LeakTruth = {
  decks: [[11111111, 22222222], [33333333, 44444444, 11111111]],
  deckMasters: [],
  known: { "0": [11111111, 44444444], "1": [33333333, 44444444, 11111111], spectator: [44444444] },
};

test("scanNumbers finds codes, not short numbers, decimals or longer ids", () => {
  const found = scanNumbers('{"a":12345678,"rev":42,"t":1759230000000,"x":"1.23456","c":"n 5053103 z"}').map((hit) => hit.code);
  assert.deepEqual(found, [12345678, 5053103]);
});

test("a viewer's secret codes are other seats' deck codes it never saw", () => {
  assert.deepEqual([...secretCodes(truth, 0)].sort(), [33333333]);
  assert.deepEqual([...secretCodes(truth, 1)].sort(), [22222222]);
  assert.deepEqual([...secretCodes(truth, "spectator")].sort(), [11111111, 22222222, 33333333]);
});

test("a code that reached the viewer is a leak, a known one is not", () => {
  const capture = new NumberCapture();
  capture.add('42["e",{"card":44444444,"mine":11111111}]', "ws", "2026-09-30T10:00:00.000Z", 10);
  assert.equal(findLeaks("p1", 0, capture, truth).length, 0);
  capture.add('42["e",{"card":33333333}]', "ws", "2026-09-30T10:00:01.000Z", 1010);
  const leaks = findLeaks("p1", 0, capture, truth);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0]!.code, 33333333);
  assert.deepEqual(leaks[0]!.ownerSeats, [1]);
  assert.match(leakMessage(leaks[0]!), /p1 \(seat 0\) received code 33333333.*seat 1/);
});

test("myDeck and deckMaster keys of the room JSON are not scanned", () => {
  const capture = new NumberCapture();
  capture.addRoom({ myDeck: { main: [33333333] }, session: { seats: [{ deckMaster: 33333333 }] }, engine: { revision: 3 } }, "t", 0);
  assert.equal(capture.hits.size, 0);
  assert.deepEqual(stripOwnDeck({ a: { myDeck: 1, b: [{ deckMaster: 2, c: 3 }] } }), { a: { b: [{ c: 3 }] } });
});

test("works for four seats: the spectator and each seat see only what was public", () => {
  const four: LeakTruth = {
    decks: [[10000001], [20000002], [30000003], [40000004]],
    known: { "0": [], "1": [20000002], "2": [], "3": [40000004, 10000001], spectator: [] },
  };
  assert.deepEqual([...secretCodes(four, 3)].sort(), [20000002, 30000003]);
  const capture = new NumberCapture();
  capture.add("hand 30000003", "room", "t", 5);
  const leaks = findLeaks("p4", 3, capture, four);
  assert.equal(leaks.length, 1);
  assert.deepEqual(leaks[0]!.ownerSeats, [2]);
});

test("a code that became public later is a leak when it arrived before the reveal", () => {
  const t0 = Date.parse("2026-09-30T10:00:00.000Z");
  // Seat 1 card 33333333 became public to seat 0 after answer 2 (step 2), answered at t0 + 20 s.
  const timed: LeakTruth = {
    ...truth,
    known: { ...truth.known, "0": [11111111, 44444444, 33333333] },
    knownSince: knownSinceFromSteps({ "0": { "11111111": 0, "44444444": 1, "33333333": 2 } }, [t0 + 10_000, t0 + 20_000]),
  };
  const early = new NumberCapture();
  early.add("x 33333333", "ws", "2026-09-30T10:00:05.000Z", 5000);
  const leaks = findLeaks("p1", 0, early, timed);
  assert.equal(leaks.length, 1);
  assert.match(leakMessage(leaks[0]!), /became public to this viewer only at 2026-09-30T10:00:20/);
  const late = new NumberCapture();
  late.add("x 33333333", "ws", "2026-09-30T10:00:20.500Z", 20500);
  assert.equal(findLeaks("p1", 0, late, timed).length, 0);
  // Less than the 2 s tolerance before the journal time is not reported.
  const close = new NumberCapture();
  close.add("x 33333333", "ws", "2026-09-30T10:00:18.500Z", 18500);
  assert.equal(findLeaks("p1", 0, close, timed).length, 0);
});
