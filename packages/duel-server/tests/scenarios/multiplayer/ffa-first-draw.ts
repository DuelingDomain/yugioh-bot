// Add an explicit first-draw fixture to multiplayer Domain and Standard MR1/MR2 card scenarios. A filler goes before
// a custom Deck so its effect targets and later draws stay in the Deck. Exact snapshots
// include the added card and the smaller Deck. Deck and hand replacement tests use the DSL directly.
import { defineScenario, type CardRef, type Scenario } from "../../support/dsl.js";
import { firstTurnDrawFor } from "../../../src/first-turn-draw.js";

type FirstDrawFixture = { card?: CardRef; destination?: "hand" | "grave" | "banished" };
const firstDrawFixtures = new WeakMap<Scenario, FirstDrawFixture>();
const firstDrawSources = new WeakMap<Scenario, Scenario>();

/** The scenario as written, before the wrapper added the Domain first draw. A Standard run needs it, because Standard MR3-5 skips that draw. */
export function firstDrawSourceFor(scenario: Scenario): Scenario {
  return firstDrawSources.get(scenario) ?? scenario;
}

/** Keep the requested draw fixture until a Standard source becomes a Domain variant. */
export function firstDrawFixtureFor(scenario: Scenario): FirstDrawFixture | undefined {
  return firstDrawFixtures.get(scenario);
}

export function defineScenarioWithFfaFirstDraw(
  scenario: Scenario,
  firstDraw: FirstDrawFixture = {},
): Scenario {
  firstDrawFixtures.set(scenario, firstDraw);
  if (!firstTurnDrawFor(scenario.setup.mode ?? "normal", scenario.setup.masterRule, scenario.setup.format)
    || scenario.setup.skipOpeningDraw || scenario.setup.turn === "p1"
    || scenario.tags?.includes("ffa-first-draw-included")) return defineScenario(scenario);
  const updated = structuredClone(scenario);
  firstDrawSources.set(updated, scenario);
  updated.tags = [...(updated.tags ?? []), "ffa-first-draw-included"];
  const deck = updated.setup.p0?.deck ?? [];
  const separateFirstDraw = deck.length > 0 && updated.setup.deckSize === undefined;
  if (separateFirstDraw) updated.setup.p0 = { ...updated.setup.p0, deck: [firstDraw.card ?? "Mystical Elf", ...deck] };
  const card = deck[0] ?? "Mystical Elf";
  let eliminated = false;
  for (const step of updated.steps) {
    if (step.op === "expectEliminated" && step.seats.includes("p0")) eliminated = true;
    if (step.op !== "expectBoard") continue;
    if (!step.board.p0 || eliminated || step.board.p0.lp === 0) continue;
    const p0 = { ...step.board.p0 };
    step.board = { ...step.board, p0 };
    let consumed = (updated.setup.deckSize ?? 20) - (p0.deckCount ?? updated.setup.deckSize ?? 20);
    if (p0.deckCount === undefined && Array.isArray(p0.hand)) {
      const remaining = [...p0.hand];
      for (const original of updated.setup.p0?.hand ?? []) {
        const at = remaining.indexOf(typeof original === "object" ? original.card : original);
        if (at >= 0) remaining.splice(at, 1);
      }
      for (const top of deck) {
        const at = remaining.indexOf(top);
        if (at < 0) break;
        remaining.splice(at, 1);
        consumed++;
      }
    }
    const drawn = firstDraw.card ?? (separateFirstDraw ? "Mystical Elf" : consumed > 0 ? deck[consumed] ?? "Mystical Elf" : card);
    const cards = p0[firstDraw.destination ?? "hand"];
    if (Array.isArray(cards)) p0[firstDraw.destination ?? "hand"] = [...cards, drawn];
    else if (cards?.count !== undefined) p0[firstDraw.destination ?? "hand"] = { ...cards, count: cards.count + 1 };
    if (p0.deckCount !== undefined && p0.deckCount > 0) p0.deckCount--;
  }
  firstDrawFixtures.set(updated, firstDraw);
  return defineScenario(updated);
}
