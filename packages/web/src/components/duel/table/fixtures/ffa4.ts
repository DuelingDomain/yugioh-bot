import { newSeat, putMonster, putSpell, skeletonFixtureSet, TABLE_CARDS as C, type TableFixtureSet } from "./common";

/**
 * 4-way free-for-all, "Battle Royal at the Plaza" (BRIEF-MODES 5.1): Aster (you, Violet), Rook (Ice, west), Juniper
 * (Verdant, north), Mirelle (Rose, east). Scaffold skeleton: step 4w hand-makes the states.
 */
const NAMES = ["Aster", "Rook", "Juniper", "Mirelle"] as const;

function makeSeats() {
  const aster = newSeat(0, { lp: 8000, hand: [C.raigeki, C.potOfGreed, C.celtic, C.solemn, C.heavyStorm], deck: 29, extra: [C.darkPaladin] });
  putMonster(aster, 0, C.darkMagician);
  putMonster(aster, 1, C.celtic);
  putSpell(aster, 0, null);
  const rook = newSeat(1, { lp: 5400, hand: [null, null, null, null], deck: 30, extra: [null] });
  putMonster(rook, 1, C.blueEyes);
  putSpell(rook, 0, null);
  putSpell(rook, 1, null);
  const juniper = newSeat(2, { lp: 3100, hand: [null, null, null], deck: 27, extra: [null] });
  putMonster(juniper, 0, C.redEyes);
  putMonster(juniper, 2, C.gaia);
  putSpell(juniper, 0, C.sakuretsu);
  putSpell(juniper, 1, null);
  const mirelle = newSeat(3, { lp: 6600, hand: [null, null, null, null], deck: 28, extra: [null] });
  putMonster(mirelle, 0, C.summonedSkull);
  putMonster(mirelle, 1, C.sangan, 0x4);
  putSpell(mirelle, 0, C.mst);
  putSpell(mirelle, 1, null);
  return [aster, rook, juniper, mirelle];
}

export const FFA4_FIXTURES: TableFixtureSet = skeletonFixtureSet({
  format: "ffa4",
  title: "4-way free-for-all",
  names: NAMES,
  makeSeats,
  turn: 5,
  clockMs: [192_000, 240_000, 205_000, 230_000],
});
