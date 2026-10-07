import assert from "node:assert/strict";
import test from "node:test";

function permutations(seats) {
  if (!seats.length) return [[]];
  return seats.flatMap((seat, index) => permutations(seats.filter((_, i) => i !== index)).map(rest => [seat, ...rest]));
}

// map[engine position] = unchanged public seat. The engine cycles 0..n-1.
function preservesFacingPairs(map) {
  return map.every((publicSeat, engineSeat) => map[engineSeat ^ 1] === (publicSeat ^ 1));
}

function preservesClockwiseCycle(map) {
  return map.every((seat, index) => map[(index + 1) % map.length] === (seat + 1) % map.length);
}

test("FFA3 can map all six roll orders into its fixed engine cycle", () => {
  const maps = permutations([0, 1, 2]);
  assert.equal(maps.length, 6);
  for (const map of maps) {
    const inverse = [0, 1, 2].map(publicSeat => map.indexOf(publicSeat));
    assert.deepEqual(inverse.map(position => map[position]), [0, 1, 2]);
  }
});

test("only eight of the 24 FFA4 roll orders preserve the existing facing pairs", () => {
  const maps = permutations([0, 1, 2, 3]);
  assert.equal(maps.length, 24);
  assert.equal(maps.filter(preservesFacingPairs).length, 8);
});

test("roll order 2,0,3,1 changes public facing partners to 2/0 and 3/1", () => {
  const map = [2, 0, 3, 1];
  assert.equal(preservesFacingPairs(map), false);
  assert.deepEqual(map.map((seat, index) => [seat, map[index ^ 1]]), [[2, 0], [0, 2], [3, 1], [1, 3]]);
});

test("a clockwise first-player rotation preserves FFA4 facing pairs only for first seat 0 or 2", () => {
  const maps = permutations([0, 1, 2, 3]).filter(preservesClockwiseCycle);
  assert.equal(maps.length, 4);
  assert.deepEqual(maps.filter(preservesFacingPairs).map(map => map[0]), [0, 2]);
  // A map can preserve pairs and start with seat 1, but changes the later clockwise turns.
  assert.equal(preservesFacingPairs([1, 0, 2, 3]), true);
  assert.equal(preservesClockwiseCycle([1, 0, 2, 3]), false);
});
