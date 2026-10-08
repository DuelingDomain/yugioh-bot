import { activate, defineScenario, expectNotOffered, expectPrompt, normalSummon, pass, pickOpponent, position, yes, zone, type Scenario, type Step } from "../../support/dsl.js";
import { everySeat, turnsBefore, type Seat } from "./seat-kit.js";

const ELF = "Mystical Elf", LOW = "Watapon", MUSKET = "Magical Musketeer Calamity";
const IMP = "Infinite Impermanence", YAJIRO = "Yajiro Invader", SCUFFLE = "Small Scuffle", CROWN = "Magical Musket - Crooked Crown";
const across = (seat: Seat): Seat => `p${Number(seat[1]) ^ 1}` as Seat;
const side = (seat: Seat): Seat => `p${Number(seat[1]) ^ 3}` as Seat;
const slots = (seq: number, card: string) => Array.from({ length: seq + 1 }, (_, i) => i === seq ? card : null);
function scenario(card: string, actor: Seat, facing: boolean, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `df-shared-zones-tag-review-${card === IMP ? "impermanence" : card === YAJIRO ? "yajiro" : card === SCUFFLE ? "small-scuffle" : "crooked-crown"}-${actor}-${facing ? "facing" : "non-facing"}`,
    title: `Tag: ${card} of ${actor} with a ${facing ? "facing" : "non-facing"} opponent`,
    source: "ADR 0002 [R-TAG-FACING], owner decision 2026-10-07", rules: ["R-TAG-FACING"], tags: ["multiplayer", "tag", "column"],
    setup: { ...setup, format: "tag" }, steps });
}
// Live Traps get a response window on the intervening turns. Decline those
// windows explicitly so the card is still available on its owner's turn.
function turnsWithTrap(actor: Seat, windows: number): Step[] {
  return turnsBefore("tag", actor).flatMap((step) => [step, ...Array.from({ length: windows }, () => pass())]);
}
function impermanence(actor: Seat, facing: boolean): Scenario {
  const other = facing ? across(actor) : side(actor), TENKI = "Fire Formation - Tenki", WOLF = "Gene-Warped Warwolf", RAT = "Giant Rat";
  const mate = `p${Number(actor[1]) ^ 2}` as Seat;
  return scenario(IMP, actor, facing, { [actor]: { spells: [null, { card: IMP, pos: "set" }] },
    [other]: { monsters: [RAT, null, null, null, WOLF], spells: [null, null, null, TENKI] },
    [mate]: { monsters: slots(4, WOLF), spells: [null, TENKI] } },
    [...turnsWithTrap(actor, 5), activate(IMP, actor), expectPrompt({ by: actor, context: "action" }),
      everySeat("tag", { [actor]: { grave: [IMP] }, [other]: { monsters: [RAT, WOLF], spells: [TENKI], zones: { m4: { card: WOLF, attack: facing ? 2000 : 2100 } } },
        [mate]: { monsters: [WOLF], spells: [TENKI], zones: { m4: { card: WOLF, attack: 2100 }, s1: TENKI } } })]);
}
function yajiro(actor: Seat, facing: boolean): Scenario {
  const other = facing ? across(actor) : side(actor);
  return scenario(YAJIRO, actor, facing, { [actor]: { monsters: slots(2, YAJIRO) }, [other]: { hand: [ELF] } },
    [...turnsBefore("tag", other), normalSummon(ELF, other), zone(other, "m4", other), expectPrompt({ by: other, context: "action" }),
      everySeat("tag", { [actor]: { monsters: [YAJIRO], zones: { m1: facing ? YAJIRO : null, m2: facing ? null : YAJIRO } }, [other]: { monsters: [ELF], zones: { m4: ELF } } })]);
}
function scuffle(actor: Seat, facing: boolean): Scenario {
  const front = across(actor), nonFacing = side(actor);
  const setup: Scenario["setup"] = { [actor]: { spells: [{ card: SCUFFLE, pos: "set" }], hand: [LOW] },
    [front]: { hand: [LOW], ...(!facing ? { monsters: Array(5).fill(ELF) } : {}) }, [nonFacing]: { hand: [LOW] } };
  return scenario(SCUFFLE, actor, facing, setup, [...turnsWithTrap(actor, facing ? 5 : 0),
    ...(facing ? [activate(SCUFFLE, actor), zone(actor, "m1", actor), position("atk", actor), yes(front), position("atk", front), expectPrompt({ by: actor, context: "action" })] : [expectNotOffered("activate", SCUFFLE, actor)]),
    everySeat("tag", { [actor]: { monsters: facing ? [LOW] : [], spells: facing ? [] : [SCUFFLE], grave: facing ? [SCUFFLE] : [], zones: { m1: facing ? LOW : null } },
      [front]: { monsters: facing ? [LOW] : Array(5).fill(ELF), zones: facing ? { m3: LOW } : {} }, [nonFacing]: { hand: { include: [LOW] } } })]);
}
function crown(actor: Seat, facing: boolean): Scenario {
  const proof = facing ? 95200158 : 95200159;
  return scenario(CROWN, actor, facing, { [actor]: { spells: [null, CROWN], hand: [MUSKET, proof] } },
    [...turnsWithTrap(actor, 1), activate(CROWN, actor), zone(actor, "m1", actor), pickOpponent(facing ? across(actor) : side(actor), actor), activate(proof, actor),
      expectPrompt({ by: actor, context: "action" }), everySeat("tag", { [actor]: { monsters: [MUSKET], spells: [CROWN], grave: [proof], zones: { m1: MUSKET }, hand: { count: 2 } } })]);
}
const TAG_COLUMN_REVIEW_SCENARIOS = (["p2", "p3"] as const).flatMap(actor => [true, false].flatMap(facing => [
  impermanence(actor, facing), yajiro(actor, facing), scuffle(actor, facing), crown(actor, facing),
]));
for (const actor of ["p2", "p3"] as const) TAG_COLUMN_REVIEW_SCENARIOS.push(defineScenario({
  id: `df-shared-zones-tag-review-field-move-${actor}`, title: `Tag: move ${actor}'s partner Field Spell into the own Field Zone`,
  source: "ADR 0002 [R-TAG-FIELD], owner decision 2026-10-07", rules: ["R-TAG-FIELD"], tags: ["multiplayer", "tag", "field"],
  setup: { format: "tag", [actor]: { hand: [95200160] }, [`p${Number(actor[1]) ^ 2}`]: { field: "Mountain" } },
  steps: [...turnsBefore("tag", actor), activate(95200160, actor), expectPrompt({ by: actor, context: "action" }),
    everySeat("tag", { [actor]: { spells: ["Mountain"], grave: [95200160], zones: { f: "Mountain" }, hand: { count: 2 } } })],
}));

// The aggregate in df-shared-zones owns registration and the Standard/Domain
// runner. Export a factory so coverage does not register this helper list again.
export function tagColumnReviewScenarios(): Scenario[] {
  return TAG_COLUMN_REVIEW_SCENARIOS;
}
