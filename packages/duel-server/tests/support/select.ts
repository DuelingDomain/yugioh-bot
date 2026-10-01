import { resolveCard } from "./card-catalog.js";
import type { Scenario } from "./dsl.js";

const REF_KEYS = new Set([
  "card", "attacker", "target", "sel", "sels", "order", "links", "include", "exclude", "hand", "grave",
  "banished", "extra", "deck", "deckMaster", "field", "materials", "monsters", "spells", "pendulum", "zones",
]);

/** Every card named by a scenario, in its setup and its steps, as passcodes. */
export function scenarioCodes(scenario: Scenario): number[] {
  const codes = new Set<number>();
  const visit = (value: unknown, isRef: boolean): void => {
    if (value == null) return;
    if (typeof value === "string") {
      if (isRef && value !== "direct") codes.add(resolveCard(value));
      return;
    }
    if (typeof value === "number") {
      if (isRef) codes.add(resolveCard(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, isRef);
      return;
    }
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(child, REF_KEYS.has(key) || (isRef && key === "zones"));
      }
    }
  };
  visit(scenario.setup, false);
  // Board keys are duelist ids; their children use REF_KEYS.
  visit(scenario.steps, false);
  return [...codes].sort((a, b) => a - b);
}

/** Tags of a scenario plus `card:<passcode>` for every card it uses. */
export function allTags(scenario: Scenario): string[] {
  return [...scenario.tags, ...scenarioCodes(scenario).map((code) => `card:${code}`)];
}

function list(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

/**
 * Filters from the environment. All set filters must match.
 *   SCENARIO_ID=raigeki,dark-hole   id contains any of these
 *   SCENARIO_TAG=chain,trap         any tag equals one of these
 *   SCENARIO_CARD="Raigeki,44095762" scenario uses any of these cards (name or code)
 *   SCENARIO_CODES=12580477,...     same, codes only (for changed-script selection)
 */
export function isSelected(scenario: Scenario): boolean {
  const ids = list("SCENARIO_ID");
  if (ids.length > 0 && !ids.some((part) => scenario.id.includes(part))) return false;
  const tags = list("SCENARIO_TAG");
  if (tags.length > 0 && !tags.some((tag) => scenario.tags.includes(tag))) return false;
  const cards = [...list("SCENARIO_CARD"), ...list("SCENARIO_CODES")];
  if (cards.length > 0) {
    const wanted = cards.map((card) => resolveCard(/^\d+$/.test(card) ? Number(card) : card));
    const used = scenarioCodes(scenario);
    if (!wanted.some((code) => used.includes(code))) return false;
  }
  return true;
}
