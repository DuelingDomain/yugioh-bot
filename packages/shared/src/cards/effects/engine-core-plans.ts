import type { CoreCard } from "./engine-core.js";

type Slot = [name: string, copies: number, role: CoreCard["role"]];
export interface ReviewedCorePlan {
  cards: Slot[];
  caption: string;
  /** Printed procedures whose loss invalidates this particular plan. */
  procedures: Array<[name: string, printed: RegExp]>;
}

/** Small reviewed constraints for coherent plans; identities, membership, legality,
 * roles and dependencies are still checked against the current graph/catalog.
 * Other groups use the conservative graph role selector. These are starting ratios,
 * not tournament statistics or a claim that the bridge judges reviewed the core. */
export const REVIEWED_CORE_PLANS: Record<string, ReviewedCorePlan> = {
  Argostars: {
    cards: [["Argostars - Glorious Adra", 3, "starter"], ["Argostars - Giantslaying", 2, "searcher"], ["Argostars - Lightning Tydeu", 2, "searcher"],
      ["Argostars - Slayer Eteo", 1, "payoff"], ["Argostars - Swift Capane", 1, "extender"], ["Argostars - Home Stadium", 1, "support"],
      ["Argostars - Fierce Parthe", 1, "extender"], ["Argostars - Adventurous Arion", 1, "payoff"]],
    caption: "Adra places the Continuous Traps; Tydeu and Giantslaying search. Arion uses one Argostars monster.",
    procedures: [["Argostars - Glorious Adra", /place up to 2 "Argostars" Continuous Traps with different names from your hand and\/or Deck face-up/i],
      ["Argostars - Adventurous Arion", /Xyz Summon[^.]*by using 1 "Argostars" monster/i]],
  },
  Ashtra: {
    cards: [["Yoa the Plague Deity Ashtra", 3, "starter"], ["Mikumari the Sealing Deity Ashtra", 2, "searcher"], ["Ashtra Divine Domain", 2, "material"],
      ["Ashtra Insect Poison", 1, "material"], ["Akasuna the Battle Ashtra", 1, "extender"], ["Ashtrashen - Gateway to the Worlds Beyond", 1, "extender"],
      ["Ashtraya Mikumari-no-Mikoto", 1, "payoff"], ["Ashtraja Susanoo", 1, "payoff"]],
    caption: "Yoa Sets Ashtra Spell/Traps; Divine Domain supplies a Level 1 Tuner. Requires face-down setup for the bodies.",
    procedures: [["Yoa the Plague Deity Ashtra", /Set 1 "Ashtra" Spell\/Trap from your Deck/i],
      ["Ashtra Divine Domain", /Tuner\/WATER\/Level 1/i], ["Ashtra Insect Poison", /Tuner/i],
      ["Ashtraya Mikumari-no-Mikoto", /^1 Tuner \+ 1\+ non-Tuners(?:\r?\n|$)/i],
      ["Ashtraja Susanoo", /^1 Tuner \+ 1\+ non-Tuners(?:\r?\n|$)/i]],
  },
  Tearlaments: {
    cards: [["Tearlaments Reinoheart", 3, "starter"], ["Tearlaments Scheiren", 1, "extender"], ["Tearlaments Havnis", 1, "extender"],
      ["Tearlaments Merrli", 1, "extender"], ["Tearlaments Kashtira", 1, "extender"], ["Tearlaments Scream", 1, "support"],
      ["Tearlaments Sulliek", 1, "payoff"], ["Tearlaments Cryme", 1, "payoff"], ["Tearlaments Kaleido-Heart", 1, "payoff"]],
    caption: "Reinoheart sends a Tearlaments monster; effect mills enable Fusion triggers. Kaleido-Heart needs Reinoheart and two Aquas.",
    procedures: [["Tearlaments Reinoheart", /send 1 "Tearlaments" monster from your Deck to the GY/i],
      ["Tearlaments Kaleido-Heart", /"Tearlaments Reinoheart" \+ 2 Aqua monsters/i], ["Tearlaments Scheiren", /Fusion Summon/i]],
  },
  Azamina: {
    cards: [["Deception of the Sinful Spoils", 3, "starter"], ["The Hallowed Azamina", 1, "extender"], ["Azamina Debtors", 1, "extender"],
      ["Azamina Determination", 1, "support"], ["Azamina Mu Rcielago", 1, "searcher"], ["Azamina Sol Erysichthon", 1, "payoff"], ["Azamina Moa Regina", 1, "payoff"]],
    caption: "Deception searches Azamina access; Hallowed and Debtors use the printed Fusion procedure. Requires monster fodder and Sinful Spoils resources.",
    procedures: [["Deception of the Sinful Spoils", /add 1 "Azamina" card from your Deck to your hand/i],
      ["The Hallowed Azamina", /Reveal 1 "Azamina" Fusion Monster in your Extra Deck/i], ["Azamina Debtors", /treated as a Fusion Summon/i]],
  },
  Regenesis: {
    cards: [["Regenesis", 3, "starter"], ["Regenesis Archfiend", 3, "searcher"], ["Regenesis Sage", 1, "payoff"], ["Regenesis Warrior", 1, "payoff"],
      ["Regenesis Dragon", 1, "payoff"], ["Regenesis Lord", 1, "extender"], ["Regenesis Birth", 1, "support"]],
    caption: "Regenesis and Archfiend search the 2500-stat bodies; Lord Sets Birth. Requires the printed reveal and banish setup.",
    procedures: [["Regenesis Lord", /banishing 1 face-up monster you control with 2500 original ATK and DEF/i], ["Regenesis Lord", /Set 1 "Regenesis" Spell\/Trap from your Deck/i]],
  },
  "Blue-Eyes": {
    cards: [["Sage with Eyes of Blue", 3, "starter"], ["Wishes for Eyes of Blue", 2, "searcher"], ["Maiden of White", 1, "extender"],
      ["Roar of the Blue-Eyed Dragons", 1, "extender"], ["Blue-Eyes White Dragon", 1, "material"], ["True Light", 1, "support"],
      ["Spirit with Eyes of Blue", 1, "searcher"], ["Blue-Eyes Spirit Dragon", 1, "payoff"], ["Blue-Eyes Ultimate Spirit Dragon", 1, "payoff"]],
    caption: "Sage finds the Tuner; Maiden places True Light and Roar supplies White Dragon. Spirit Dragon reaches the Synchro payoff.",
    procedures: [["Maiden of White", /place 1 "True Light" from your hand, Deck, or GY/i],
      ["Roar of the Blue-Eyed Dragons", /Special Summon in Defense Position, 1 "Blue-Eyes" monster from your Deck/i],
      ["Blue-Eyes Spirit Dragon", /^1 Tuner \+ 1 or more non-Tuner "Blue-Eyes" monsters(?:\r?\n|$)/i],
      ["Blue-Eyes Spirit Dragon", /Special Summon 1 LIGHT Dragon-Type Synchro Monster from your Extra Deck/i]],
  },
};
