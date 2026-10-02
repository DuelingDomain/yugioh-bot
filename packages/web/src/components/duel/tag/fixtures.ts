import { newSeat, putMonster, putSpell, skeletonFixtureSet, TABLE_CARDS as C, type TableFixtureSet } from "../table/fixtures/common";

/**
 * 2v2 tag, "Starfall vs Thornveil" (BRIEF-MODES 5.2): turn order Aster 1A (seat 0), Mirelle 2A (seat 1), Corvin 1B
 * (seat 2, your partner), Juniper 2B (seat 3). Team LP is shared: both seats of a team hold the same number.
 * Scaffold skeleton: the tag step hand-makes the states.
 */
const NAMES = ["Aster", "Mirelle", "Corvin", "Juniper"] as const;

function makeSeats() {
  const aster = newSeat(0, { lp: 11800, hand: [C.darkHole, C.featherDuster, C.celtic, C.solemn, C.potOfGreed], deck: 30, extra: [C.darkPaladin] });
  putMonster(aster, 0, C.darkMagician);
  putMonster(aster, 1, C.celtic);
  putSpell(aster, 0, C.callOfTheHaunted);
  const mirelle = newSeat(1, { lp: 9400, hand: [null, null, null, null], deck: 28, extra: [null] });
  putMonster(mirelle, 0, C.summonedSkull);
  putSpell(mirelle, 0, null);
  const corvin = newSeat(2, { lp: 11800, hand: [C.jinzo, C.torrential, C.darkMagician, C.potOfGreed], deck: 28, extra: [null] });
  putMonster(corvin, 0, C.blueEyes);
  putSpell(corvin, 0, C.mst);
  putSpell(corvin, 1, null);
  const juniper = newSeat(3, { lp: 9400, hand: [null, null, null], deck: 27, extra: [null] });
  putMonster(juniper, 0, C.redEyes);
  putMonster(juniper, 2, C.gaia);
  putSpell(juniper, 0, null);
  return [aster, mirelle, corvin, juniper];
}

export const TAG_FIXTURES: TableFixtureSet = skeletonFixtureSet({
  format: "tag",
  title: "2v2 tag duel",
  names: NAMES,
  makeSeats,
  turn: 5,
  clockMs: [168_000, 240_000, 205_000, 230_000],
});
