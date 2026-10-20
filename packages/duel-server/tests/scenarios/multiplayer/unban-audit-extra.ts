import {
  activate, attack, changePhase, changePosition, choose, defineScenario, endTurn, expectBoard,
  expectNotOffered, expectOffered, expectPickSeats, expectPrompt, expectSeatNotOffered, expectTurn, faceDown,
  no, normalSummon, pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step,
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
      setup[seat]!.grave = ["Beaver Warrior", HAND[index + 1]];
      board[seat] = { monsters: [], grave: ["Beaver Warrior"], hand: [ELF, HAND[index + 1]], deckCount: 19 };
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
          [seat]: { grave: ["Beaver Warrior", HAND[Number(seat[1])]], hand: [ELF] },
          [chosen]: { grave: ["Beaver Warrior"], hand: [HAND[Number(chosen[1])]] },
        }));
      }
      steps.push(endTurn(seat));
    }
    if (format === "tag") board.p2 = { monsters: [], grave: ["Beaver Warrior", HAND[2]], hand: [ELF], deckCount: 19 };
    steps.push(expectTurn("p0"));
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `unban-audit-extra-world-${format}-${heads ? "heads-one-skip" : "tails-draw-subject"}${domain ? "-domain" : ""}`,
    title: heads ? "The World skips one opposing turn, then that opponent returns" : "The World chooses a GY during each opposing Draw Phase, including a non-turn opponent",
    source: SOURCE, rules: ["R-FFA-OPP-ONE"],
    tags: ["multiplayer", "unban-audit", format, "card:23846921"], setup, steps, seed: heads ? HEADS : TAILS });
}

function worldHeadsFromPartner(domain: boolean): Scenario {
  const { setup } = fixture("tag", domain);
  const card = "Arcana Force XXI - The World";
  setup.p2!.hand = [card]; setup.p2!.monsters = HAND;
  return defineScenario({ id: `unban-audit-extra-world-tag-heads-p2-skips-p1${domain ? "-domain" : ""}`,
    title: "The World controlled by p2 skips p1 once while p3 and p0 take their turns",
    source: SOURCE, rules: ["R-FFA-OPP-ONE"], tags: ["multiplayer", "unban-audit", "tag", "card:23846921"], setup, seed: HEADS,
    steps: [endTurn("p0"), endTurn("p1"), normalSummon(card, "p2"),
      select({ card: HAND[0], owner: "p2" }, { card: HAND[1], owner: "p2" }), endTurn("p2"), yes("p2"),
      expectPickSeats(["p1", "p3"], "p2"), pickOpponent("p1", "p2"),
      select({ card: HAND[2], owner: "p2" }, { card: HAND[3], owner: "p2" }),
      expectTurn("p3"), endTurn("p3"), expectTurn("p0"), endTurn("p0"), expectTurn("p2"), endTurn("p2"),
      expectTurn("p3"), endTurn("p3"), expectTurn("p0"), endTurn("p0"), expectTurn("p1"),
      expectBoard({ p0: { hand: [ELF, ELF], deckCount: 18 }, p1: { hand: [ELF, ELF], deckCount: 18 },
        p2: { monsters: [card], grave: HAND, hand: [ELF, ELF], deckCount: 18 }, p3: { hand: [ELF, ELF], deckCount: 18 } })] });
}

function worldPartnerEnd(domain: boolean): Scenario {
  const { setup } = fixture("tag", domain);
  const card = "Arcana Force XXI - The World";
  setup.p0!.hand = [card]; setup.p0!.monsters = HAND;
  return defineScenario({ id: `unban-audit-extra-world-tag-partner-end-not-offered${domain ? "-domain" : ""}`,
    title: "Heads World remains payable but cannot activate during its Tag partner's End Phase",
    source: SOURCE, rules: ["R-COMMON-CONTROLLER-TURN"], tags: ["multiplayer", "unban-audit", "tag", "card:23846921"], setup, seed: HEADS,
    steps: [normalSummon(card, "p0"), select({ card: HAND[0], owner: "p0" }, { card: HAND[1], owner: "p0" }),
      endTurn("p0"), expectPrompt({ by: "p0", kind: "choice", title: card }), no("p0"), endTurn("p1"), expectTurn("p2"),
      endTurn("p2"), expectSeatNotOffered("activate", card, "p0"), expectTurn("p3"),
      expectPrompt({ by: "p3", context: "action", offers: ["to_bp"] }),
      expectBoard({ p0: { monsters: [card, HAND[2], HAND[3]], grave: HAND.slice(0, 2) },
        p1: { hand: [ELF], deckCount: 19 }, p2: { hand: [ELF], deckCount: 19 }, p3: { hand: [ELF], deckCount: 19 } })] });
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
  for (const seat of seats.slice(0, -1)) steps.push(expectTurn(seat),
    expectPrompt({ by: seat, context: "action", offers: ["to_bp"] }), endTurn(seat));
  steps.push(expectTurn(actor));
  if (!current) {
    steps.push(expectPrompt({ by: actor, kind: "choice", title: "Select an option" }), choose("Entering the Battle Phase", actor),
      expectPrompt({ by: actor, context: "action", offers: ["to_m2"], notOffers: ["to_bp"] }), changePhase("main2", actor), endTurn(actor));
    for (const seat of seats.slice(0, -1)) steps.push(expectTurn(seat),
      expectPrompt({ by: seat, context: "action", offers: ["to_bp"] }), endTurn(seat));
    steps.push(expectTurn(actor));
  }
  steps.push(expectPrompt({ by: actor, context: "action", offers: ["to_bp"] }),
    expectBoard({ p0: { hand: { include: [ELF] }, monsters: [], spells: [], grave: [card] }, [actor]: { monsters: ["Penguin Soldier"], grave: [] } }));
  return defineScenario({ id: `unban-audit-extra-ice-${format}-${current ? "current-phase" : "next-main1"}${domain ? "-domain" : ""}`,
    title: "Million-Century Ice Prison skips only the responsible opponent's phase and then expires",
    source: SOURCE, rules: ["R-FFA-OPP-RESPONSE"], tags: ["multiplayer", "unban-audit", format, "card:23746827"], setup, steps });
}

function mischief(format: Format, domain: boolean, actor: DuelistId = "p0"): Scenario {
  const { seats, setup } = fixture(format, domain);
  const card = "Mischief of the Time Goddess", target = actor === "p0" ? "p1" : "p3";
  const actorIndex = seats.indexOf(actor);
  const initialDraw = (seat: DuelistId) => seats.indexOf(seat) > 0 && seats.indexOf(seat) <= actorIndex ? 1 : 0;
  setup[actor]!.hand = [card, card]; setup[actor]!.monsters = ["Valkyrie Dritte"];
  for (const seat of seats.filter(seat => seat !== actor)) setup[seat]!.hand = [HAND[Number(seat[1])]];
  const attackSteps: Step[] = [attack("Valkyrie Dritte", "direct", actor), pickOpponent(target, actor)];
  const board: BoardExpect = { [actor]: { hand: [card, ...Array(initialDraw(actor)).fill(ELF)],
    grave: [card], monsters: ["Valkyrie Dritte"], deckCount: 20 - initialDraw(actor) },
    ...Object.fromEntries(seats.filter(seat => seat !== actor).map(seat => [seat, {
      hand: [HAND[Number(seat[1])], ...Array(initialDraw(seat)).fill(ELF)],
      deckCount: 20 - initialDraw(seat), grave: [], monsters: [] }])) };
  const nextSeats = [...seats.slice(actorIndex + 1), ...seats.slice(0, actorIndex)];
  return defineScenario({ id: `unban-audit-extra-mischief-${format}-next-own-battle${actor === "p0" ? "" : `-${actor}`}${domain ? "-domain" : ""}`,
    title: "Mischief skips every intervening duelist, repeats the own Battle Phase and expires after that own turn",
    source: SOURCE, rules: ["R-TAG-ORDER"], tags: ["multiplayer", "unban-audit", format, "card:92182447"], setup,
    steps: [...seats.slice(0, actorIndex).map(seat => endTurn(seat)), ...attackSteps,
      changePhase("main2", actor), activate({ card, nth: 0 }, actor),
      expectTurn(actor), expectPrompt({ by: actor, context: "action", offers: ["to_m2"], notOffers: ["to_bp"] }),
      expectBoard(board), ...attackSteps, expectBoard({ [target]: { lp: format === "tag" ? 14000 : 6000 } }),
      changePhase("main2", actor), expectPrompt({ by: actor, context: "action", offers: ["to_ep"] }),
      expectBoard({ [actor]: { hand: [card, ...Array(initialDraw(actor)).fill(ELF)], grave: [card] } }),
      endTurn(actor), ...nextSeats.flatMap(seat => [expectTurn(seat),
        expectPrompt({ by: seat, context: "action", offers: ["to_bp"] }), endTurn(seat)]),
      expectTurn(actor), expectPrompt({ by: actor, context: "action", offers: ["to_bp"] }),
      expectBoard(Object.fromEntries(seats.map(seat => [seat, {
        hand: [...Array(initialDraw(seat) + 1).fill(ELF), ...(seat === actor ? [card] : [HAND[Number(seat[1])]])],
        deckCount: 19 - initialDraw(seat) }]))),
      changePhase("battle", actor), changePhase("main2", actor), expectOffered("activate", card, actor) ] });
}

function mischiefPartnerTurn(domain: boolean): Scenario {
  const { setup } = fixture("tag", domain);
  const card = "Mischief of the Time Goddess";
  setup.p0!.monsters = ["Valkyrie Dritte"];
  setup.p2!.spells = [faceDown(card)];
  return defineScenario({ id: `unban-audit-extra-mischief-tag-partner-battle-not-offered${domain ? "-domain" : ""}`,
    title: "The Tag partner cannot activate its Set Mischief during another member's Battle Phase",
    source: SOURCE, rules: ["R-TAG-ORDER"], tags: ["multiplayer", "unban-audit", "tag", "card:92182447"], setup,
    steps: [changePhase("battle", "p0"), changePhase("main2", "p0"), expectSeatNotOffered("activate", card, "p2"),
      expectTurn("p0"), expectPrompt({ by: "p0", context: "action", offers: ["to_ep"] }),
      expectBoard({ p0: { monsters: ["Valkyrie Dritte"], hand: [], deckCount: 20 },
        p2: { spells: [card], grave: [], hand: [], deckCount: 20 } }), endTurn("p0"), expectTurn("p1"),
      expectPrompt({ by: "p1", context: "action", offers: ["to_bp"] }),
      expectBoard({ p1: { hand: [ELF], deckCount: 19 }, p2: { spells: [card], grave: [] } })] });
}

export const UNBAN_AUDIT_EXTRA_SCENARIOS = (["ffa3", "ffa4", "tag"] as const).flatMap(format => [false, true].flatMap(domain => [
  world(format, domain, true), world(format, domain, false), avatar(format, domain),
  ice(format, domain, false), ice(format, domain, true), mischief(format, domain),
]));
UNBAN_AUDIT_EXTRA_SCENARIOS.push(...[false, true].flatMap(domain => [mischief("tag", domain, "p2"), worldHeadsFromPartner(domain), mischiefPartnerTurn(domain), worldPartnerEnd(domain)]));
