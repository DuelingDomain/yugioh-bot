import { activate, expectBoard, expectChain, expectEliminated, expectPrompt, expectResolved, expectResponseOrder,
  pass, surrender, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";
import { everySeat, SEATS } from "./seat-kit.js";

const source = FFA_SCENARIOS.find((s) => s.id === "nseat-ffa4-four-way-chain-order")!;
if (!source) throw new Error("The FFA chain source is missing");
const standard: Scenario[] = (["ffa3", "ffa4"] as const).map((format) => {
  const setup = structuredClone(source.setup);
  setup.format = format;
  if (format === "ffa3") delete setup.p3;
  const steps: Step[] = source.steps.filter((step) => !(format === "ffa3" && (("by" in step && step.by === "p3") || (step.op === "expectPrompt" && step.prompt.by === "p3"))))
    .map((step) => {
      if (format === "ffa3" && step.op === "expectBoard") { const board = { ...step.board }; delete board.p3; return { ...step, board }; }
      if (format === "ffa3" && step.op === "expectResponseOrder") return { ...step, seats: step.seats.filter((seat) => seat !== "p3") };
      return step;
    });
  steps.push(everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
    hand: [], deckCount: 20, grave: seat === "p0" ? ["Heavy Storm", "Swords of Revealing Light", "Swords of Revealing Light", "Dust Tornado"] : seat === "p2" ? ["Dust Tornado", "Dust Tornado"] : ["Dust Tornado"],
  }]))));
  return defineScenario({ ...source, id: `rule-proof-${format}-next-seat-responds-first`,
    title: `${format}: a later seat chains, then the next living seat responds first and all seats pass in order`, setup, steps });
});

function responseRound(kind: "eliminated-before-activator" | "eliminated-after-activator" | "leaving-cursor" | "third-link"): Scenario {
  const dead = kind === "eliminated-before-activator" ? "p1" : "p3";
  const eliminated = kind.startsWith("eliminated");
  const steps: Step[] = eliminated ? [surrender(dead), expectEliminated(dead)] : [];
  steps.push(activate("Pot of Greed", "p0"));
  if (dead !== "p1" || !eliminated) steps.push(expectPrompt({ by: "p1", context: "chain" }), pass("p1"));
  steps.push(activate("Waboku", "p2"), expectChain("Pot of Greed", "Waboku"));
  if (kind === "leaving-cursor") {
    steps.push(expectPrompt({ by: "p3", context: "chain" }), expectResponseOrder("p1", "p2", "p3"), surrender("p3"));
  } else if (kind === "third-link") {
    steps.push(activate("Waboku", "p3"), expectChain("Pot of Greed", "Waboku", "Waboku"));
  } else if (dead !== "p3") {
    steps.push(expectPrompt({ by: "p3", context: "chain" }), pass("p3"));
  }
  const remaining = kind === "eliminated-before-activator" ? ["p0", "p2"] as const : ["p0", "p1", "p2"] as const;
  const links = kind === "third-link" ? ["Pot of Greed", "Waboku", "Waboku"] : ["Pot of Greed", "Waboku"];
  for (const by of remaining) steps.push(expectChain(...links), expectPrompt({ by, context: "chain" }), pass(by));
  if (kind === "third-link") steps.push(expectPrompt({ by: "p3", context: "chain" }), pass("p3"));
  // Count the final open response before passing; resolution can open a separate free-chain window.
  const finalPass = steps.pop()!;
  steps.push(expectResponseOrder(...(kind === "eliminated-before-activator" ? ["p2", "p3", "p0", "p2"] as const
    : kind === "eliminated-after-activator" ? ["p1", "p2", "p0", "p1", "p2"] as const
    : kind === "third-link" ? ["p1", "p2", "p3", "p0", "p1", "p2", "p3"] as const
    : ["p0", "p1", "p2"] as const)), finalPass,
    expectResolved(...(kind === "third-link" ? ["Waboku", "Waboku", "Pot of Greed"] : ["Waboku", "Pot of Greed"])),
    ...(kind === "leaving-cursor" ? [expectEliminated("p3")] : []),
    expectBoard({ p0: { hand: { count: 2 }, deckCount: 18, grave: ["Pot of Greed"] }, p2: { grave: ["Waboku"], spells: ["Waboku"] } }));
  return defineScenario({ id: `rule-proof-ffa4-chain-${kind}`, title: `FFA4: response order and consecutive passes with ${kind}`,
    source: `${source.source} (owner, 2026-10-04)`, rules: ["R-FFA-CHAIN", ...(kind === "third-link" ? [] : ["R-FFA-ELIMINATION"])],
    tags: ["multiplayer", "ffa4", "chain"], setup: { format: "ffa4", p0: { hand: ["Pot of Greed"], spells: [{ card: "Waboku", pos: "set" }] },
      p1: { spells: [{ card: "Waboku", pos: "set" }] }, p2: { spells: [0, 1].map(() => ({ card: "Waboku", pos: "set" as const })) },
      p3: { spells: [0, 1].map(() => ({ card: "Waboku", pos: "set" as const })) } }, steps });
}
standard.push(...(["eliminated-before-activator", "eliminated-after-activator", "leaving-cursor", "third-link"] as const).map(responseRound));

function chainAfterB(format: "ffa3" | "1v1"): Scenario {
  const round = format === "ffa3" ? ["p2", "p0", "p1"] as const : ["p0", "p1"] as const;
  return defineScenario({ id: `rule-proof-${format}-chain-after-b`, title: `${format}: B chains, then the next seat responds and every seat passes`,
    source: `${source.source} (owner, 2026-10-04)`, ...(format === "ffa3" ? { rules: ["R-FFA-CHAIN"] } : {}),
    tags: ["chain", format], setup: { format, p0: { hand: ["Pot of Greed"], spells: [{ card: "Waboku", pos: "set" }] },
      p1: { spells: [0, 1].map(() => ({ card: "Waboku", pos: "set" as const })) },
      ...(format === "ffa3" ? { p2: { spells: [{ card: "Waboku", pos: "set" as const }] } } : {}) },
    steps: [activate("Pot of Greed", "p0"), activate("Waboku", "p1"), expectChain("Pot of Greed", "Waboku"),
      ...round.flatMap((by, index) => [expectChain("Pot of Greed", "Waboku"), expectPrompt({ by, context: "chain" }),
        ...(index === round.length - 1 ? [expectResponseOrder("p1", ...round)] : []), pass(by)]),
      expectResolved("Waboku", "Pot of Greed"),
      expectBoard({ p0: { hand: { count: 2 }, deckCount: 18, grave: ["Pot of Greed"] }, p1: { grave: ["Waboku"], spells: ["Waboku"] } })] });
}
standard.push(chainAfterB("ffa3"));
export const FFA_CHAIN_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];

const tag = defineScenario({ id: "rule-proof-tag-chain-response-order-control", title: "Tag: opposing team responds before partner after a new link",
  source: "docs/adr/0002-multiplayer-duel-rules.md [R-TAG-RESPONSE]", rules: ["R-TAG-RESPONSE"], tags: ["multiplayer", "tag", "chain"],
  setup: { format: "tag", p0: { hand: ["Pot of Greed"], spells: [{ card: "Waboku", pos: "set" }] },
    p1: { spells: [{ card: "Waboku", pos: "set" }] }, p2: { spells: [0, 1].map(() => ({ card: "Waboku", pos: "set" as const })) },
    p3: { spells: [{ card: "Waboku", pos: "set" }] } },
  steps: [activate("Pot of Greed", "p0"), pass("p1"), pass("p3"), activate("Waboku", "p2"),
    expectChain("Pot of Greed", "Waboku"), expectPrompt({ by: "p3", context: "chain" }), pass("p3"),
    expectPrompt({ by: "p1", context: "chain" }), pass("p1"), expectPrompt({ by: "p0", context: "chain" }), pass("p0"),
    expectChain("Pot of Greed", "Waboku"), expectPrompt({ by: "p2", context: "chain" }),
    expectResponseOrder("p1", "p3", "p2", "p3", "p1", "p0", "p2"), pass("p2"), expectResolved("Waboku", "Pot of Greed"),
    expectBoard({ p0: { hand: { count: 2 }, deckCount: 18, grave: ["Pot of Greed"] }, p2: { grave: ["Waboku"], spells: ["Waboku"] } })] });
const twoPlayer = chainAfterB("1v1");
export const CHAIN_ORDER_CONTROL_SCENARIOS = [tag, domainVariant(tag), twoPlayer, domainVariant(twoPlayer)];
