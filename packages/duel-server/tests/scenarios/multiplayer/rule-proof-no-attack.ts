import { DF_FIRST_BATTLE_FFA_SCENARIOS } from "./df-first-battle-phase.js";

export const NO_ATTACK_PROOF_SCENARIOS = DF_FIRST_BATTLE_FFA_SCENARIOS.map((scenario) => ({
  ...scenario,
  id: scenario.id.replace("df-first-battle-phase-", "rule-proof-").replace(/-(all-live|early-loss)/, "-first-round-$1"),
}));
