import { type Scenario, type Step } from "../../support/dsl.js";
import { EACH_DUELIST_REVIVAL_SCENARIOS } from "./each-duelist-revival.js";

// The battle belongs to p1 for actor p0, and p0 for actor p1.
const orderProofs = EACH_DUELIST_REVIVAL_SCENARIOS.filter((s) => s.id.endsWith("84136000")).map((source) => {
  const proof = structuredClone(source);
  const first = proof.steps.findIndex((step) => step.op === "expectPickOptions");
  const groups: Step[][] = [];
  let at = first;
  while (proof.steps[at]?.op === "expectPickOptions") { groups.push(proof.steps.slice(at, at + 2)); at += 2; }
  const turn = proof.id.includes("-p0-") ? 1 : 0;
  const count = proof.setup.format === "ffa3" ? 3 : 4;
  groups.sort((a, b) => ((Number((a[0] as Step & { by: string }).by[1]) - turn + count) % count) - ((Number((b[0] as Step & { by: string }).by[1]) - turn + count) % count));
  proof.steps = [...proof.steps.slice(0, first), ...groups.flat(), ...proof.steps.slice(at)];
  proof.id = `leftover-${proof.id}-turn-first`;
  proof.title = `${proof.setup.format}: Grave of Enkindling choices start with the attacking turn player`;
  return proof;
});
export const LEFTOVER_REVIVAL_ORDER_SCENARIOS: Scenario[] = orderProofs;
