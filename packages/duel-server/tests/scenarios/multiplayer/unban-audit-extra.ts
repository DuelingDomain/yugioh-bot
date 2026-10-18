import {
  activate, changePhase, changePosition, choose, defineScenario, endTurn, expectBoard,
  expectNotOffered, expectOffered, expectPickSeats, expectPrompt, expectTurn, faceDown,
  normalSummon, pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag";
const ALL: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HAND = ["Silver Fang", "Battle Ox", "Celtic Guardian", "Axe Raider"];
const ELF = "Mystical Elf";
const SOURCE = "Owner 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md";
const HEADS = ["5", "144115188075855872", "7", "8"];
const TAILS = ["5", "6", "7", "8"];

function fixture(format: Format, domain: boolean): { seats: DuelistId[]; setup: Scenario["setup"] } {
  const seats = ALL.slice(0, format === "ffa3" ? 3 : 4);
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true, attackFirstTurn: true, deckSize: 20,
    ...(domain ? { mode: "domain" } : {}) };
  for (const seat of seats) setup[seat] = { ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
  return { seats, setup };
}

function world(format: Format, domain: boolean, heads: boolean): Scenario {
  const { seats, setup } = fixture(format, domain);
  const card = "Arcana Force XXI - The World";
  const picked = seats.at(-1)!;
  setup.p0!.hand = [card]; setup.p0!.monsters = [...HAND];
  const steps: Step[] = [normalSummon(card, "p0"), select({ card: HAND[0], owner: "p0" }, { card: HAND[1], owner: "p0" })];
  const board: BoardExpect = { p0: { monsters: [card], grave: heads ? HAND : HAND.slice(0, 2) } };
  if (heads) {
    const opponents = format === "tag" ? ["p1", "p3"] as DuelistId[] : seats.slice(1);
    steps.push(endTurn("p0"), yes("p0"), expectPickSeats(opponents, "p0"), pickOpponent(picked, "p0"),
      select({ card: HAND[2], owner: "p0" }, { card: HAND[3], owner: "p0" }));
    const skipped = picked;
    for (const seat of seats.slice(1).filter(seat => seat !== skipped)) steps.push(expectTurn(seat), endTurn(seat));
    steps.push(expectTurn("p0"), endTurn("p0"));
    for (const seat of seats.slice(1)) steps.push(expectTurn(seat), endTurn(seat));
    steps.push(expectTurn("p0"));
    for (const seat of seats.slice(1)) board[seat] = { monsters: [], grave: [],
      hand: Array(seat === skipped ? 1 : 2).fill(ELF), deckCount: seat === skipped ? 19 : 18 };
  } else {
    setup.p0!.monsters = HAND.slice(0, 2);
    for (const [index, seat] of seats.slice(1).entries()) {
      setup[seat]!.grave = [HAND[index + 1]];
      board[seat] = { monsters: [], grave: [], hand: [ELF, HAND[index + 1]], deckCount: 19 };
    }
    steps.push(endTurn("p0"));
    const recipients: DuelistId[] = format === "tag" ? ["p1", "p3"] : seats.slice(1);
    for (const seat of seats.slice(1)) {
      steps.push(expectTurn(seat));
      if (recipients.includes(seat)) {
        const index = recipients.indexOf(seat);
        const chosen = recipients[(index + recipients.length - 1) % recipients.length];
        steps.push(expectPickSeats(recipients, "p0"), pickOpponent(chosen, "p0"));
        if (index === 0) steps.push(expectBoard({
          [seat]: { grave: [HAND[Number(seat[1])]], hand: [ELF] },
          [chosen]: { grave: [], hand: [HAND[Number(chosen[1])]] },
        }));
      }
      steps.push(endTurn(seat));
    }
    if (format === "tag") board.p2 = { monsters: [], grave: [HAND[2]], hand: [ELF], deckCount: 19 };
    steps.push(expectTurn("p0"));
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `unban-audit-extra-world-${format}-${heads ? "heads-one-skip" : "tails-draw-subject"}${domain ? "-domain" : ""}`,
    title: heads ? "The World skips one opposing turn, then that opponent returns" : "The World chooses a GY during each opposing Draw Phase, including a non-turn opponent",
    source: SOURCE, rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "unban-audit", format, "card:23846921"], setup, steps, seed: heads ? HEADS : TAILS });
}

function avatar(format: Format, domain: boolean): Scenario {
  const { seats, setup } = fixture(format, domain);
  const card = "The Wicked Avatar", picked = seats.at(-1)!;
  setup.p0!.hand = [card]; setup.p0!.monsters = HAND.slice(0, 3);
  for (const seat of seats.slice(1)) setup[seat]!.hand = ["Sparks"];
  const steps: Step[] = [normalSummon(card, "p0"), select(...HAND.slice(0, 3).map(card => ({ card, owner: "p0" as const }))),
    ...(format !== "tag" ? [expectPickSeats(seats.slice(1), "p0"), pickOpponent(picked, "p0")] : [])];
  for (let round = 1; round <= 3; round++) {
    steps.push(endTurn("p0"));
    for (const seat of seats.slice(1)) {
      const locked = format === "tag" ? Number(seat[1]) % 2 === 1 && round === 1 : seat === picked && round <= 2;
      steps.push(expectTurn(seat), locked
        ? expectNotOffered("activate", "Sparks", seat) : expectOffered("activate", "Sparks", seat), endTurn(seat));
    }
  }
  steps.push(expectTurn("p0"), expectBoard({ p0: { monsters: [card], grave: HAND.slice(0, 3) },
    ...Object.fromEntries(seats.slice(1).map(seat => [seat, { hand: ["Sparks", ELF, ELF, ELF], deckCount: 17, grave: [], monsters: [] }])) }));
  return defineScenario({ id: `unban-audit-extra-avatar-${format}-${format === "tag" ? "two-opposing-turns" : "two-chosen-turns"}${domain ? "-domain" : ""}`,
    title: format === "tag" ? "The Wicked Avatar locks the opposing team through two opposing duelist turns"
      : "The Wicked Avatar locks only the chosen opponent through two of that opponent's turns",
    source: SOURCE, rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "unban-audit", format, "card:21208154"], setup, steps });
}

function ice(format: Format, domain: boolean, current: boolean): Scenario {
  const { seats, setup } = fixture(format, domain);
  const card = "Million-Century Ice Prison", actor = seats.at(-1)!;
  setup.p0!.spells = [faceDown(card)]; setup.p0!.monsters = [ELF];
  setup[actor]!.monsters = [faceDown("Penguin Soldier")];
  const steps: Step[] = [...seats.slice(0, -1).map(seat => endTurn(seat)), changePosition("Penguin Soldier", actor),
    yes(actor), select({ card: ELF, owner: "p0" }), activate(card, "p0"), choose(current ? "End the Main Phase" : "next turn", "p0")];
  if (current) steps.push(expectPrompt({ by: actor, kind: "choice", title: "Select an option" }), choose("Entering the Battle Phase", actor),
    expectPrompt({ by: actor, context: "action", offers: ["to_m2"], notOffers: ["to_bp"] }), changePhase("main2", actor));
  steps.push(endTurn(actor));
  for (const seat of seats.slice(0, -1)) steps.push(expectTurn(seat), endTurn(seat));
  steps.push(expectTurn(actor));
  if (!current) {
    steps.push(expectPrompt({ by: actor, kind: "choice", title: "Select an option" }), choose("Entering the Battle Phase", actor),
      expectPrompt({ by: actor, context: "action", offers: ["to_m2"], notOffers: ["to_bp"] }), changePhase("main2", actor), endTurn(actor));
    for (const seat of seats.slice(0, -1)) steps.push(expectTurn(seat), endTurn(seat));
    steps.push(expectTurn(actor));
  }
  steps.push(expectPrompt({ by: actor, context: "action", offers: ["to_bp"] }),
    expectBoard({ p0: { hand: { include: [ELF] }, monsters: [], spells: [], grave: [card] }, [actor]: { monsters: ["Penguin Soldier"], grave: [] } }));
  return defineScenario({ id: `unban-audit-extra-ice-${format}-${current ? "current-phase" : "next-main1"}${domain ? "-domain" : ""}`,
    title: "Million-Century Ice Prison skips only the responsible opponent's phase and then expires",
    source: SOURCE, rules: ["R-FFA-OPP-RESPONSE"], tags: ["multiplayer", "unban-audit", format, "card:23746827"], setup, steps });
}

function mischiefGap(format: Format, domain: boolean): Scenario {
  const { seats, setup } = fixture(format, domain);
  const card = "Mischief of the Time Goddess";
  setup.p0!.hand = [card]; setup.p0!.monsters = ["Valkyrie Dritte"];
  for (const seat of seats.slice(1)) setup[seat]!.hand = [HAND[Number(seat[1])]];
  const next: DuelistId = format === "tag" ? "p2" : "p1";
  return defineScenario({ id: `unban-audit-extra-mischief-${format}-unsupported-intervening-turn${domain ? "-domain" : ""}`,
    title: "Native Mischief leaves an intervening duelist's normal turn open",
    source: `${SOURCE}; native gap: the card must skip to the next own Battle Phase`, rules: [],
    tags: ["multiplayer", "unban-audit", "unsupported-turn-jump", format, "card:92182447"], setup,
    steps: [changePhase("battle", "p0"), changePhase("main2", "p0"), activate(card, "p0"),
      ...(format !== "tag" ? [expectPickSeats(seats.slice(1), "p0"), pickOpponent(seats.at(-1)!, "p0")] : []),
      expectTurn(next), expectPrompt({ by: next, context: "action", offers: ["to_bp"] }),
      expectBoard({ p0: { hand: [], grave: [card], monsters: ["Valkyrie Dritte"], deckCount: 20 },
        ...Object.fromEntries(seats.slice(1).map(seat => [seat, { hand: [HAND[Number(seat[1])], ...(seat === next ? [ELF] : [])],
          deckCount: seat === next ? 19 : 20, grave: [], monsters: [] }])) })] });
}

function worldTagGap(domain: boolean, heads: boolean): Scenario {
  const base = world("tag", domain, heads);
  const last = heads ? base.steps.findIndex((step, index) => index > 1 && step.op === "select") + 1
    : base.steps.findIndex(step => step.op === "expectBoard");
  const steps = base.steps.slice(0, last);
  if (heads) steps.push(expectTurn("p2"), expectPrompt({ by: "p2", context: "action" }),
    expectBoard({ p1: { hand: [], deckCount: 20 }, p3: { hand: [], deckCount: 20 } }),
    endTurn("p2"), expectTurn("p3"), expectPrompt({ by: "p3", context: "action" }),
    expectBoard({ p3: { hand: [ELF], deckCount: 19 } }), endTurn("p3"), expectTurn("p0"), endTurn("p0"),
    expectTurn("p1"), expectBoard({ p0: { monsters: ["Arcana Force XXI - The World"], grave: HAND }, p1: { hand: [ELF], deckCount: 19 } }));
  else steps.push(expectPrompt({ by: "p1", context: "action" }),
    expectBoard({ p1: { grave: [HAND[1]], hand: [ELF] }, p2: { grave: [HAND[2]] }, p3: { grave: [HAND[3]], hand: [] } }));
  return defineScenario({ ...base,
    id: `unban-audit-extra-world-tag-unsupported-${heads ? "heads-member" : "tails-gy-index"}${domain ? "-domain" : ""}`,
    title: heads ? "Native World skips p1 after p3 was chosen" : "Native World returns no card from the chosen p3 GY",
    source: `${SOURCE}; native Tag gap`, rules: [], tags: [...base.tags, "unsupported-tag-member"], steps });
}

function iceTagGap(domain: boolean): Scenario {
  const base = ice("tag", domain, false);
  const last = base.steps.findIndex(step => step.op === "phase" && step.by === "p3") + 1;
  return defineScenario({ ...base, id: `unban-audit-extra-ice-tag-unsupported-other-member${domain ? "-domain" : ""}`,
    title: "Native Ice Prison skips p1 Main Phase 1 after responsible p3 was bound",
    source: `${SOURCE}; native Tag gap`, rules: [], tags: [...base.tags, "unsupported-tag-member"],
    steps: [...base.steps.slice(0, last), endTurn("p0"), expectTurn("p1"),
      expectPrompt({ by: "p1", kind: "choice", title: "Select an option" }), choose("Entering the Battle Phase", "p1"),
      expectPrompt({ by: "p1", context: "action", offers: ["to_m2"], notOffers: ["to_bp"] }), changePhase("main2", "p1"),
      endTurn("p1"), expectTurn("p2"), endTurn("p2"), expectTurn("p3"), expectPrompt({ by: "p3", context: "action", offers: ["to_bp"] }),
      expectBoard({ p0: { grave: ["Million-Century Ice Prison"], monsters: [], hand: { include: [ELF] } },
        p1: { hand: [ELF, ELF], deckCount: 18 }, p3: { monsters: ["Penguin Soldier"], hand: [ELF, ELF], deckCount: 18 } })] });
}

export const UNBAN_AUDIT_EXTRA_SCENARIOS = (["ffa3", "ffa4"] as const).flatMap(format => [false, true].flatMap(domain => [
  world(format, domain, true), world(format, domain, false), avatar(format, domain),
  ice(format, domain, false), ice(format, domain, true),
]));
UNBAN_AUDIT_EXTRA_SCENARIOS.push(...[false, true].map(domain => avatar("tag", domain)));

export const UNBAN_AUDIT_EXTRA_GAP_SCENARIOS = [
  ...(["ffa3", "ffa4", "tag"] as const).flatMap(format => [false, true].map(domain => mischiefGap(format, domain))),
  ...[false, true].flatMap(domain => [worldTagGap(domain, true), worldTagGap(domain, false), iceTagGap(domain)]),
];
