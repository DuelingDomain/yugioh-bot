import { newSeat, putMonster, putSpell, skeletonFixtureSet, TABLE_CARDS as C, type TableFixtureSet } from "./common";

/**
 * 3-way free-for-all, "3way-final" mock: Ren Arata (you, Violet), Ryo Sato (Ice, 5400 LP), Mika Hana (Verdant, 2100 LP).
 * Scaffold skeleton: one board, the nine states derived from it. Step 3w-1 hand-makes the states as the stage lands.
 */
const NAMES = ["Ren Arata", "Ryo Sato", "Mika Hana"] as const;

function makeSeats() {
  const ren = newSeat(0, { lp: 8000, hand: [C.raigeki, C.potOfGreed, C.celtic, C.solemn, C.heavyStorm], deck: 29, extra: [C.darkPaladin, C.stardust] });
  putMonster(ren, 0, C.darkMagician);
  putMonster(ren, 1, C.celtic);
  putSpell(ren, 0, null);
  const ryo = newSeat(1, { lp: 5400, hand: [null, null, null, null], deck: 30, extra: [null, null] });
  putMonster(ryo, 1, C.blueEyes);
  putSpell(ryo, 0, null);
  putSpell(ryo, 1, C.mirrorForce);
  const mika = newSeat(2, { lp: 2100, hand: [null, null, null], deck: 27, extra: [null] });
  putMonster(mika, 0, C.redEyes);
  putMonster(mika, 2, C.gaia);
  putSpell(mika, 0, C.callOfTheHaunted);
  putSpell(mika, 1, null);
  return [ren, ryo, mika];
}

export const FFA3_FIXTURES: TableFixtureSet = skeletonFixtureSet({
  format: "ffa3",
  title: "3-way free-for-all",
  names: NAMES,
  makeSeats,
  turn: 5,
  clockMs: [192_000, 240_000, 205_000],
});
