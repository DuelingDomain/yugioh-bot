// Chaos Archfiend (13076804, +2000 ATK) and Chaos Beast (49565413, +1000 ATK): "Gains ATK the turn a card is banished". The global check of
// each card registers a flag for the literal seat 0 (the overlay wrapper of initial_effect registers it for every living duelist) and the
// ATK condition reads the flag of the literal seat 0. A holder at ANY seat has the bonus in the turn in which any seat banished a card (here:
// the holder pays 1000 LP and banishes a Set card with Cosmic Cyclone), and has no bonus in a turn with no banish. With the bonus the
// monster of the holder wins the battle against a monster that is stronger than its printed ATK; without it the holder loses the battle.
//
// Chaos Archfiend banishes a monster that it destroys by battle (its own e3), Chaos Beast sends it to the Graveyard.
//
// FFA with p0 out: p0 gives up first. The flag is still read for the literal seat 0 and the holder of a later seat has the bonus.

import { activate, attack, auto, defineScenario, expectEliminated, faceDown, surrender, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const CYCLONE = "Cosmic Cyclone"; // pay 1000 LP: banish 1 Spell/Trap
const TRAP = "Dark Hole"; // a Set card that has no reaction to an attack

interface Card { code: number; name: string; atk: number; bonus: number; victim: string; victimAtk: number; redirect: boolean }
const ARCHFIEND: Card = { code: 13076804, name: "Chaos Archfiend", atk: 2500, bonus: 2000, victim: "Blue-Eyes White Dragon", victimAtk: 3000, redirect: true };
const BEAST: Card = { code: 49565413, name: "Chaos Beast", atk: 2000, bonus: 1000, victim: "Dark Magician", victimAtk: 2500, redirect: false };

function bonusScenario(card: Card, format: Format, holder: Seat, banish: boolean, p0Out: boolean): Scenario {
  const seats = SEATS[format];
  const base = baseLp(format);
  const victim = p0Out ? seats.find((seat) => seat !== "p0" && seat !== holder)! : seats[(seats.indexOf(holder) + 1) % seats.length]!;
  const ownLp = base - (banish ? 1000 : 0);
  const win = banish;
  const dueling = win ? card.atk + card.bonus : card.atk;
  const diff = Math.abs(dueling - card.victimAtk);
  const state = win
    ? { [holder]: { lp: ownLp, monsters: [card.name], grave: [CYCLONE] }, [victim]: { lp: base - diff, banished: card.redirect ? [TRAP, card.victim] : [TRAP], grave: card.redirect ? [] : [card.victim] } }
    : { [holder]: { lp: ownLp - diff, grave: [card.name] }, [victim]: { monsters: [card.victim], spells: [TRAP] } };
  const steps: Step[] = [
    ...(p0Out ? [surrender("p0"), expectEliminated("p0")] : []),
    ...turnsBefore(format, holder, p0Out ? "p1" : "p0"),
    ...(banish ? [activate(CYCLONE, holder), auto(holder)] : []),
    attack(card.name, card.victim, holder),
  ];
  return defineScenario({
    id: `${card.name.toLowerCase().replace(/ /g, "-")}-${format}-${holder}${p0Out ? "-p0-out" : ""}-${banish ? `banish-gives-${card.bonus}-atk` : `no-banish-keeps-${card.atk}-atk`}`,
    title: `${label(format)}${p0Out ? " (p0 gave up)" : ""}: ${holder} attacks the ${card.victim} (${card.victimAtk} ATK) of ${victim} with ${card.name} (${card.atk} ATK) ${banish ? `after it banished a card this turn: ${card.atk + card.bonus} ATK, it wins` : "in a turn with no banish: printed ATK, it loses"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the flag of a global check is set for the seats that read it`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, `card:${card.code}`],
    setup: baseSetup(format, {
      [holder]: { monsters: [card.name], ...(banish ? { hand: [CYCLONE] } : {}) },
      [victim]: { monsters: [card.victim], spells: [faceDown(TRAP)] },
    }),
    steps: [...steps, everySeat(format, state as never)],
  });
}

export const FLAG_ATK_SCENARIOS: Scenario[] = [];
for (const card of [ARCHFIEND, BEAST]) {
  for (const banish of [true, false]) {
    FLAG_ATK_SCENARIOS.push(bonusScenario(card, "ffa3", "p1", banish, false), bonusScenario(card, "ffa3", "p2", banish, false), bonusScenario(card, "ffa4", "p3", banish, false), bonusScenario(card, "tag", "p1", banish, false), bonusScenario(card, "tag", "p3", banish, false));
  }
  FLAG_ATK_SCENARIOS.push(bonusScenario(card, "ffa3", "p2", true, true), bonusScenario(card, "ffa4", "p3", true, true));
}
