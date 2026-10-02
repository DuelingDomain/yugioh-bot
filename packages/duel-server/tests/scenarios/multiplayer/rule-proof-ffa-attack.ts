import { domainVariant } from "./domain-variants.js";
import { ATTACK_DIRECT_SCENARIOS } from "./attack-direct.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";
import { everySeat } from "./seat-kit.js";

const mixed = FFA_SCENARIOS.find((scenario) => scenario.id === "nseat-ffa4-direct-attack-mixed-fields");
if (!mixed) throw new Error("The mixed-field attack proof is missing");

export const FFA_ATTACK_DOMAIN_PROOF_SCENARIOS = [
  domainVariant({ ...mixed, id: `rule-proof-${mixed.id}`,
    steps: [...mixed.steps, everySeat("ffa4", {
      p0: { hand: ["Mystical Elf", "Mystical Elf"], deckCount: 18, monsters: ["Mystical Elf"], grave: ["Mystical Elf"] },
      p1: { hand: ["Mystical Elf"], deckCount: 19, grave: ["Mystical Elf"] },
      p2: { hand: ["Mystical Elf"], deckCount: 19 },
      p3: { lp: 7200, hand: ["Mystical Elf"], deckCount: 19 },
    })],
  }),
  ...ATTACK_DIRECT_SCENARIOS.filter((scenario) => scenario.setup.format === "ffa4" && scenario.id.includes("counter-gate"))
    .map((scenario) => domainVariant({ ...scenario, id: `rule-proof-${scenario.id}` })),
];
