// Swiftwind Panther Warrior of a later seat cannot attack before a Tribute. Its real Quick Effect Tributes a monster,
// sends Dark Time Wizard from the Deck to the Graveyard, and enables an attack through the global Tribute flag.

import { activate, attack, changePhase, defineScenario, expectNotOffered, pass, select, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const PANTHER = 77482666;
const WIZARD = 40235813;
const AXE = "Axe Raider";
const ELF = "Mystical Elf";

function swiftwindPantherWarrior(format: Format, tribute: boolean): Scenario {
  const holder: Seat = format === "ffa3" ? "p2" : "p3";
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { hand: seat === "p0" ? [] : [ELF], extra: [] };
  state.p0 = tribute ? { ...state.p0, lp: baseLp(format) - 300, grave: [AXE] } : { ...state.p0, monsters: [AXE] };
  state[holder] = { ...state[holder], monsters: tribute ? [PANTHER] : [PANTHER, ELF], grave: tribute ? [ELF, WIZARD] : [] };
  const action: Step[] = tribute
    ? [
      activate(PANTHER, holder),
      select({ card: ELF, owner: holder, from: "mzone" }),
      select({ card: WIZARD, owner: holder, from: "deck", nth: 0 }),
      attack(PANTHER, { card: AXE, owner: "p0" }, holder),
    ]
    : [changePhase("battle", holder), expectNotOffered("attack", PANTHER, holder)];
  return defineScenario({
    id: `swiftwind-panther-warrior-${format}-late-seat-${tribute ? "attacks-after-tribute" : "cannot-attack-without-tribute"}`,
    title: `${label(format)}: Swiftwind Panther Warrior of ${holder} ${tribute ? "Tributes a monster and can attack" : "cannot attack when no monster was Tributed"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global Tribute flag reaches every living seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:77482666"],
    setup: baseSetup(format, {
      p0: { monsters: [AXE] },
      [holder]: { monsters: [PANTHER, ELF], deck: [ELF, WIZARD, WIZARD] },
    }),
    steps: [...turnsBefore(format, holder).flatMap((step) => [step, pass(holder)]), ...action, everySeat(format, state)],
  });
}

export const SWIFTWIND_PANTHER_WARRIOR_SCENARIOS: Scenario[] = ["ffa3", "ffa4", "tag"].flatMap((format) => [
  swiftwindPantherWarrior(format as Format, false),
  swiftwindPantherWarrior(format as Format, true),
]);
