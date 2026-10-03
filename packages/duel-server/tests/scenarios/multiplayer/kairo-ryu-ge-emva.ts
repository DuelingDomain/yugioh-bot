// Kairo Ryu-Ge Emva (20904475): two monsters sent from hand or Deck to the
// GY enable its GY summon. The global counter must work at later seats too.
import { activate, endTurn, expectNotOffered, expectOffered, expectPrompt, select, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const CARD = "Kairo Ryu-Ge Emva";
const BURIAL = "Foolish Burial";
const ELF = "Mystical Elf";
const MILLED = ["Battle Ox", "Axe Raider"];

function summon(format: Format, actor: Seat, count: 1 | 2): Scenario {
  const actorIndex = SEATS[format].indexOf(actor);
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    const drew = seat !== "p0" && SEATS[format].indexOf(seat) <= actorIndex;
    spec[seat] = { hand: drew ? [ELF] : [], deckCount: drew ? 19 : 20 };
  }
  spec[actor] = {
    hand: count === 2 ? [ELF] : [ELF, BURIAL],
    deckCount: 19 - count,
    grave: [...Array.from({ length: count }, () => BURIAL), ...MILLED.slice(0, count), ...(count === 1 ? [CARD] : [])],
    monsters: count === 2 ? [CARD] : [],
  };
  const steps: Step[] = [...turnsBefore(format, actor)];
  for (const card of MILLED.slice(0, count)) steps.push(activate(BURIAL, actor), select({ card, owner: actor, from: "deck" }));
  steps.push(count === 2 ? activate({ card: CARD, from: "grave" }, actor) : expectNotOffered("activate", { card: CARD, from: "grave" }, actor));
  if (count === 2) steps.push(expectPrompt({ by: actor, context: "action" }));
  return defineScenario({
    id: `kairo-ryu-ge-emva-${format}-${actor}-${count}-monsters-sent-${count === 2 ? "summons" : "cannot-summon"}`,
    title: `${label(format)}: ${actor} sends ${count} monster(s) from its Deck and ${count === 2 ? "summons Kairo Ryu-Ge Emva" : "cannot summon Kairo Ryu-Ge Emva yet"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global turn counter reaches each real seat and Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:20904475"],
    setup: baseSetup(format, { [actor]: { hand: [BURIAL, BURIAL], grave: [CARD], deck: [ELF, ...MILLED] } }),
    steps: [...steps, everySeat(format, spec)],
  });
}

function reset(): Scenario {
  const first = summon("ffa3", "p2", 2);
  return defineScenario({
    ...first, tags: first.tags.filter(tag => tag !== "ffa-first-draw-included"),
    id: "kairo-ryu-ge-emva-ffa3-p2-counter-clears-before-next-own-turn",
    title: "FFA3: Emva is offered after two sends and stays in the GY on its next turn",
    steps: [
      ...first.steps.slice(0, -3), expectOffered("activate", { card: CARD, from: "grave" }, "p2"),
      endTurn("p2"), expectPrompt({ by: "p0", context: "action" }), endTurn("p0"), endTurn("p1"),
      expectPrompt({ by: "p2", context: "action" }), expectNotOffered("activate", { card: CARD, from: "grave" }, "p2"),
      everySeat("ffa3", {
        p0: { hand: [ELF], deckCount: 19 },
        p1: { hand: [ELF, ELF], deckCount: 18 },
        p2: { hand: [ELF, ELF], deckCount: 16, grave: [CARD, BURIAL, BURIAL, ...MILLED] },
      }),
    ],
  });
}

export const KAIRO_RYU_GE_EMVA_SCENARIOS: Scenario[] = [
  summon("ffa3", "p1", 2), summon("ffa3", "p2", 2),
  summon("ffa4", "p2", 2), summon("ffa4", "p3", 2),
  summon("tag", "p1", 2), summon("tag", "p3", 2),
  summon("ffa3", "p2", 1), summon("ffa4", "p3", 1), summon("tag", "p3", 1), reset(),
];
