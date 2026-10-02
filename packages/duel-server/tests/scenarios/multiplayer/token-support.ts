// Two Tokens are destroyed in p0's Battle Phase. Token Support of a later opposing seat makes exactly two new Tokens.
// The count flag reaches that seat in FFA and its team in Tag.

import { attack, changePhase, defense, defineScenario, number, pickOpponent, yes, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, SEATS, type Format, type Seat } from "./seat-kit.js";

const SUPPORT = "Token Support";
const TOKEN = 53545927; // The stock script calls it Alliance Token; installed cards.cdb names it Support Token.
const DRAGON = "Blue-Eyes White Dragon";
const MAGICIAN = "Dark Magician";

function tokenSupport(format: Format): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { hand: [], extra: [] };
  state.p0 = { ...state.p0, monsters: [DRAGON, MAGICIAN] };
  state[holder] = { ...state[holder], monsters: [TOKEN, TOKEN], spells: [SUPPORT] };
  return defineScenario({
    id: `token-support-${format}-late-seat-replaces-two-battle-destroyed-tokens`,
    title: `${label(format)}: Token Support of ${holder} summons two Tokens after p0 destroys two Tokens in battle`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global Token destruction count reaches every living seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:53545926"],
    setup: baseSetup(format, {
      p0: { monsters: [DRAGON, MAGICIAN] },
      [holder]: { monsters: [defense(TOKEN), defense(TOKEN)], spells: [SUPPORT] },
    }),
    steps: [
      attack(DRAGON, { card: TOKEN, owner: holder, seq: 0 }, "p0"),
      attack(MAGICIAN, { card: TOKEN, owner: holder, seq: 1 }, "p0"),
      changePhase("main2", "p0"),
      yes(holder),
      ...(format === "tag" ? [pickOpponent("p0", holder)] : []),
      number(2, holder),
      everySeat(format, state),
    ],
  });
}

export const TOKEN_SUPPORT_SCENARIOS: Scenario[] = ["ffa3", "ffa4", "tag"].map((format) => tokenSupport(format as Format));
