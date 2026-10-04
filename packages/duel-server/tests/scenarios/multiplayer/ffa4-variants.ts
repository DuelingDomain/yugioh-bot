import { endTurn, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

/**
 * FFA4 variants of FFA3 scenarios (review B, cards area: these cards were proven at FFA3 only, and a bug that shows only with a THIRD opponent,
 * such as a pick prompt that offers 2 seats where it must offer 3, or a loop over the seats that stops at p2, could not be found).
 *
 * `ffa4Variant(s)` gives the scenario a 4th duelist, p3, with no cards (or the cards of the options), and every expected board of the scenario now also
 * asserts that p3 is untouched (no monster, no Spell or Trap, no Graveyard card, no banished card; its hand is the kept cards), so the final state of EVERY seat is checked.
 * A scenario where p3 changes the result (it is asked, it draws, it is the picked seat) needs a hand-made FFA4 scenario instead of this transform.
 */
const ELF = "Mystical Elf"; // the Deck filler: p3 draws one in its own turn (a turn that FFA3 does not have)

const FFA3_SEATS: DuelistId[] = ["p0", "p1", "p2"];

/** What p3 holds in a variant: the default is nothing. `keep` lists the cards of p3 that must stay where they are, `pickP3` tells if p3 is a legal pick. */
export interface FfaFourOptions {
  p3?: Scenario["setup"]["p3"];
  keep?: { hand?: string[] };
  pickP3?: boolean;
}

/** The board of p3: untouched, and after its own turn it holds the card of its Draw Phase. */
const boardOfP3 = (drew: boolean, options: FfaFourOptions) => ({
  monsters: [], spells: [], grave: [], banished: [], hand: [...(options.keep?.hand ?? []), ...(drew ? [ELF] : [])],
});

/**
 * - the turn order is p0, p1, p2, p3: p3 plays an empty turn after every turn of p2 (and draws a card in it);
 * - a pick prompt that offered every opponent of the activator now offers p3 too (unless p3 is not a legal pick, `pickP3: false`);
 * - every expected board also asserts p3.
 */
function withP3(steps: Step[], options: FfaFourOptions): Step[] {
  const out: Step[] = [];
  let drew = false;
  for (const step of steps) {
    if (step.op === "expectBoard") {
      out.push(step.board.p3 ? step : { ...step, board: { ...step.board, p3: boardOfP3(drew, options) } });
    } else if (step.op === "expectTurn" && step.turn !== undefined) {
      // An FFA4 round has the extra turn of p3 after p2.
      out.push({ ...step, turn: step.turn + Math.floor((step.turn - 1) / 3) });
    } else if (step.op === "expectPickSeats") {
      const by = step.by ?? "p0";
      const all = FFA3_SEATS.filter((seat) => seat !== by);
      const everyOpponent = step.seats.length === all.length && all.every((seat) => step.seats.includes(seat));
      out.push(everyOpponent && options.pickP3 !== false ? { ...step, seats: [...step.seats, "p3"] } : step);
    } else {
      out.push(step);
      if (step.op === "phase" && step.to === "end" && step.by === "p2") {
        out.push(endTurn("p3"));
        drew = true;
      }
    }
  }
  return out;
}

export function ffa4Variant(scenario: Scenario, options: FfaFourOptions = {}): Scenario {
  if (scenario.setup.format !== "ffa3") throw new Error(`${scenario.id}: an FFA4 variant needs an FFA3 scenario`);
  const id = scenario.id.replace(/-ffa3-/, "-ffa4-");
  return {
    ...scenario,
    id: id === scenario.id ? `${scenario.id}-ffa4` : id,
    title: `${scenario.title.replace(/^FFA3/, "FFA4")} (FFA4: p3 ${options.p3 ? "keeps its cards" : "has no cards"} and stays untouched)`,
    tags: [...scenario.tags.filter((tag) => tag !== "ffa3"), "ffa4"],
    setup: { ...scenario.setup, format: "ffa4", p3: options.p3 ?? {} } as Scenario["setup"],
    steps: withP3(scenario.steps, options),
  };
}
