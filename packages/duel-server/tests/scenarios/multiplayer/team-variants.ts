import type { Scenario, Step } from "../../support/dsl.js";
import { endTurn } from "../../support/dsl.js";

/**
 * Team 1 variants of the Tag scenarios (review B, test proof quality: the Tag scenarios were played by team 0 only, and a bug that only
 * a team 1 seat shows, as the one that 5dba811 fixed, could not be found).
 *
 * `teamOneVariant(s)` swaps the two teams of a Tag scenario: p0 and p1 trade places and p2 and p3 trade places in the setup, in every step
 * and in every expected state, and the team numbers flip. Team 0 plays the first turn, so the variant starts with an empty turn of the new p0
 * (the old p1): the old actor (now p1) acts in turn 2, where it also draws a card, which turn 1 of the first duelist does not. A scenario that
 * is not symmetric in that draw or in the turn count needs a hand-made team 1 scenario instead of this transform.
 */
const SWAP: Record<string, string> = { p0: "p1", p1: "p0", p2: "p3", p3: "p2" };

function swapDeep(value: unknown, key?: string): unknown {
  if (typeof value === "string") return SWAP[value] ?? value;
  if (Array.isArray(value)) return value.map((item) => swapDeep(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[SWAP[k] ?? k] = k === "team" && typeof v === "number" ? 1 - v : swapDeep(v, k);
    }
    return out;
  }
  void key;
  return value;
}

const FILLER = "Mystical Elf";

/** p1 (the old actor) draws the top card of its Deck at the start of turn 2: every expected hand and Deck count of p1 includes that card. */
function withDraw(steps: Step[], drawn: string): Step[] {
  return steps.map((step) => {
    if (step.op !== "expectBoard" || !step.board.p1) return step;
    const p1 = { ...step.board.p1 };
    if (Array.isArray(p1.hand)) p1.hand = [...p1.hand, drawn];
    else if (p1.hand && typeof p1.hand.count === "number") p1.hand = { ...p1.hand, count: p1.hand.count + 1 };
    if (typeof p1.deckCount === "number") p1.deckCount -= 1;
    return { ...step, board: { ...step.board, p1 } };
  });
}

export function teamOneVariant(scenario: Scenario): Scenario {
  if (scenario.setup.format !== "tag") throw new Error(`${scenario.id}: a team 1 variant needs a Tag scenario`);
  const setup = swapDeep(scenario.setup) as Scenario["setup"];
  const deck = (setup.p1 as { deck?: string[] } | undefined)?.deck;
  const base = scenario.id.replace(/-tag-/, "-tag-team1-");
  return {
    ...scenario,
    id: base === scenario.id ? `${scenario.id}-team1` : base,
    title: `${scenario.title} (team 1 plays: p0 and p1, p2 and p3 trade places)`,
    tags: [...scenario.tags, "team1"],
    setup,
    steps: [endTurn("p0"), ...withDraw(swapDeep(scenario.steps) as Step[], deck?.[0] ?? FILLER)],
  };
}
