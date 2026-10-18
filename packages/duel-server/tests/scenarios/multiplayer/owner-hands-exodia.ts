import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated, expectNotOffered,
  expectEvents, expectPrompt, expectResult, normalSummon, surrender, type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const FORMATS = ["ffa3", "ffa4", "tag"] as const;
const HAND = ["Battle Ox", "Silver Fang", "Axe Raider", "Giant Soldier of Stone"];
const FILLER = "Mystical Elf";
const PIECES = [33396948, 8124921, 44519536, 70903634, 7902349];
const SOURCE = "docs/adr/0002-multiplayer-duel-rules.md; owner 2026-10-18";

function setupFor(format: typeof FORMATS[number], domain: boolean): Scenario["setup"] {
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true, deckSize: 12, ...(domain ? { mode: "domain" } : {}) };
  for (const seat of SEATS.slice(0, format === "ffa3" ? 3 : 4)) {
    setup[seat] = { ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
  }
  return setup;
}

function handScenario(format: typeof FORMATS[number], domain: boolean, code: 72892473 | 74519184, actor: number): Scenario {
  const card = code === 72892473 ? "Card Destruction" : "Hand Destruction";
  const setup = setupFor(format, domain);
  const count = format === "ffa3" ? 3 : 4;
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    const hand = code === 72892473 ? Array(i + 1).fill(HAND[i]) : [HAND[i], HAND[i], "Beaver Warrior"];
    setup[SEATS[i]]!.hand = [...hand, ...(i === actor ? [card] : [])];
    const drew = i > 0 && i <= actor ? 1 : 0;
    const sent = code === 72892473 ? hand.length + drew : 2;
    board[SEATS[i]] = {
      hand: code === 72892473 ? Array(sent).fill(FILLER) : ["Beaver Warrior", ...Array(2 + drew).fill(FILLER)],
      grave: [...(i === actor ? [card] : []), ...Array(code === 72892473 ? hand.length : 2).fill(HAND[i]), ...Array(code === 72892473 ? drew : 0).fill(FILLER)],
      deckCount: 12 - drew - sent,
    };
  }
  const steps: Step[] = SEATS.slice(0, actor).map(seat => endTurn(seat));
  steps.push(activate(card, SEATS[actor]));
  if (code === 74519184) {
    for (let offset = 0; offset < count; offset++) {
      const i = (actor + offset) % count;
      steps.push(expectPrompt({ by: SEATS[i], kind: "cards" }), { op: "select", sels: [HAND[i], HAND[i]], by: SEATS[i] });
    }
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `owner-hands-${code}-${format}-p${actor}${domain ? "-domain" : ""}`,
    title: `${card}: every player uses their own hand, starting with p${actor}`,
    source: SOURCE, rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", format, `card:${code}`], setup, steps,
  });
}

function exodiaScenario(format: typeof FORMATS[number], domain: boolean, actor: number): Scenario {
  const setup = setupFor(format, domain);
  setup[SEATS[actor]]!.hand = [...PIECES.slice(0, 4), "Pot of Greed"];
  // The first card is the normal draw at seats 1..3. The fifth piece is drawn by Pot of Greed.
  setup[SEATS[actor]]!.deck = [FILLER, PIECES[4]];
  const count = format === "ffa3" ? 3 : 4;
  const losers = SEATS.slice(0, count).filter((_, i) => format === "tag" ? i % 2 !== actor % 2 : i !== actor);
  return defineScenario({
    id: `owner-exodia-${format}-p${actor}${domain ? "-domain" : ""}`,
    title: `Exodia: p${actor} completes one hand and ends the whole duel`,
    source: SOURCE, rules: ["R-COMMON-EXODIA"], tags: ["multiplayer", format, "card:33396948"], setup,
    steps: [
      ...SEATS.slice(0, actor).map(seat => endTurn(seat)),
      expectPrompt({ by: SEATS[actor], context: "action" }), activate("Pot of Greed", SEATS[actor]),
      expectResult(format === "tag" ? { team: actor % 2, reason: "Exodia the Forbidden One" } : { seat: SEATS[actor], reason: "Exodia the Forbidden One" }),
      expectEliminated(...losers),
    ],
  });
}

function splitExodiaScenario(format: typeof FORMATS[number], domain: boolean): Scenario {
  const setup = setupFor(format, domain);
  setup.p0!.hand = [33396948, 8124921, "Pot of Greed"];
  setup.p2!.hand = PIECES.slice(2);
  // The opponents together have five pieces, but no opponent has a complete hand.
  setup.p1!.hand = [33396948, 8124921];
  if (format === "tag") setup.p3!.hand = PIECES.slice(2);
  return defineScenario({
    id: `owner-exodia-split-${format}${domain ? "-domain" : ""}`, title: "Exodia: pieces in separate hands give no win",
    source: SOURCE, rules: ["R-COMMON-EXODIA"], tags: ["multiplayer", format, "card:33396948"], setup,
    steps: [activate("Pot of Greed", "p0"), expectBoard({ p0: { hand: [33396948, 8124921, FILLER, FILLER] } }), expectPrompt({ by: "p0", context: "action" })],
  });
}

function replacedExodiaScenario(format: typeof FORMATS[number], domain: boolean, winners: number[]): Scenario {
  const setup = setupFor(format, domain);
  const count = format === "ffa3" ? 3 : 4;
  for (let i = 0; i < count; i++) {
    setup[SEATS[i]]!.hand = [...Array(winners.includes(i) ? 5 : 1).fill(HAND[i]), ...(i === 0 ? ["Card Destruction"] : [])];
    if (winners.includes(i)) setup[SEATS[i]]!.deck = PIECES;
  }
  const draw = winners.length > 1;
  const losers = SEATS.slice(0, count).filter((_, i) => !draw && (format === "tag" ? i % 2 !== winners[0] % 2 : i !== winners[0]));
  return defineScenario({ id: `owner-exodia-${draw ? "draw" : "off-turn"}-${format}-${winners.join("-")}${domain ? "-domain" : ""}`,
    title: `Card Destruction: ${draw ? "two complete Exodia hands give a draw for everyone" : "p2 completes Exodia during p0's turn"}`,
    source: SOURCE, rules: ["R-COMMON-EXODIA", "R-COMMON-HAND-DESTRUCTION"],
    tags: ["multiplayer", format, "card:33396948", "card:72892473", ...(draw ? ["exodia-draw"] : ["exodia-off-turn"])], setup,
    steps: [activate("Card Destruction", "p0"),
      expectBoard(Object.fromEntries(winners.map(i => [SEATS[i], { hand: PIECES, deckCount: 7 }]))),
      expectResult(draw ? { seat: null, ...(format === "tag" ? { team: null } : {}), reason: "Exodia the Forbidden One" }
        : format === "tag" ? { team: winners[0] % 2, reason: "Exodia the Forbidden One" } : { seat: SEATS[winners[0]], reason: "Exodia the Forbidden One" }),
      ...(draw ? [] : [expectEliminated(...losers)])] });
}

function shortHandScenario(format: typeof FORMATS[number], domain: boolean): Scenario {
  const setup = setupFor(format, domain);
  for (const [i, seat] of SEATS.slice(0, format === "ffa3" ? 3 : 4).entries()) setup[seat]!.hand = [HAND[i], HAND[i]];
  setup.p0!.hand!.push("Hand Destruction");
  setup.p2!.hand = [HAND[2]];
  return defineScenario({
    id: `owner-hands-short-${format}${domain ? "-domain" : ""}`, title: "Hand Destruction: a player with fewer than two cards prevents activation",
    source: SOURCE, rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", format, "card:74519184"], setup,
    steps: [expectNotOffered("activate", "Hand Destruction", "p0"), expectBoard({ p2: { hand: [HAND[2]], grave: [], deckCount: 12 } })],
  });
}

function offTurnHandScenario(format: typeof FORMATS[number], domain: boolean): Scenario {
  const setup = setupFor(format, domain);
  const count = format === "ffa3" ? 3 : 4;
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    setup[SEATS[i]]!.hand = [HAND[i], HAND[i], "Beaver Warrior", ...(i === 0 ? ["Pot of Greed"] : [])];
    board[SEATS[i]] = { hand: ["Beaver Warrior", ...Array(i === 0 ? 4 : 2).fill(FILLER)],
      grave: [...Array(2).fill(HAND[i]), ...(i === 0 ? ["Pot of Greed"] : i === 1 ? ["Hand Destruction"] : [])], deckCount: i === 0 ? 8 : 10 };
  }
  setup.p1!.spells = [{ card: "Hand Destruction", pos: "set" }];
  const steps: Step[] = [activate("Pot of Greed", "p0"), activate("Hand Destruction", "p1")];
  for (let i = 0; i < count; i++) {
    steps.push(expectPrompt({ by: SEATS[i], kind: "cards" }), { op: "select", sels: [HAND[i], HAND[i]], by: SEATS[i] });
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `owner-hands-off-turn-${format}${domain ? "-domain" : ""}`,
    title: "Hand Destruction: p0 starts the choice order during p0's turn", source: SOURCE,
    rules: ["R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", format, "card:74519184"], setup, steps });
}

function emptyHandScenario(format: typeof FORMATS[number], domain: boolean): Scenario {
  const setup = setupFor(format, domain);
  setup.p0!.hand = ["Card Destruction", "Battle Ox"];
  setup.p1!.hand = ["Silver Fang", "Silver Fang"];
  const board: BoardExpect = { p0: { hand: [FILLER], grave: ["Card Destruction", "Battle Ox"], deckCount: 11 },
    p1: { hand: [FILLER, FILLER], grave: ["Silver Fang", "Silver Fang"], deckCount: 10 },
    p2: { hand: [], grave: [], deckCount: 12 } };
  if (format !== "ffa3") board.p3 = { hand: [], grave: [], deckCount: 12 };
  return defineScenario({ id: `owner-hands-empty-${format}${domain ? "-domain" : ""}`,
    title: "Card Destruction: an empty hand draws no cards", source: SOURCE,
    rules: ["R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", format, "card:72892473"], setup,
    steps: [activate("Card Destruction", "p0"), expectBoard(board)] });
}

function deckOutScenario(domain: boolean, losses: number): Scenario {
  const setup = setupFor("ffa4", domain);
  setup.deckSize = 1;
  const board: BoardExpect = {};
  const losers = SEATS.slice(1, losses + 1);
  for (const [i, seat] of SEATS.entries()) {
    const lost = losers.includes(seat);
    setup[seat]!.hand = [...Array(lost ? 3 : 1).fill(HAND[i]), ...(i === 0 ? ["Card Destruction"] : [])];
    board[seat] = { hand: lost ? [] : [FILLER], grave: lost ? [] : [HAND[i], ...(i === 0 ? ["Card Destruction"] : [])], deckCount: 0 };
  }
  return defineScenario({ id: `owner-hands-deck-out-${losses}-ffa4${domain ? "-domain" : ""}`,
    title: `Card Destruction: ${losses} opponent(s) lose by deck-out and the other players continue`, source: SOURCE,
    rules: ["R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", "ffa4", "card:72892473", "deck-out"], setup,
    steps: [expectBoard(Object.fromEntries(losers.map(seat => [seat, { hand: setup[seat]!.hand, deckCount: 1 }]))),
      activate("Card Destruction", "p0"), expectEvents(...losers.map(by => ({ kind: "move" as const, by, card: FILLER }))),
      expectEliminated(...losers), expectBoard(board), expectPrompt({ by: "p0", context: "action" }),
      normalSummon(FILLER, "p0"), expectBoard({ p0: { hand: [], monsters: [FILLER] } })] });
}

function shortDeckScenario(domain: boolean): Scenario {
  const setup = setupFor("ffa4", domain);
  setup.deckSize = 1;
  setup.p0!.hand = ["Card Destruction", "Battle Ox", "Silver Fang"];
  return defineScenario({ id: `owner-hands-short-deck-ffa4${domain ? "-domain" : ""}`,
    title: "Card Destruction: the activator must have enough cards in the Deck", source: SOURCE,
    rules: ["R-COMMON-HAND-DESTRUCTION"], tags: ["multiplayer", "ffa4", "card:72892473"], setup,
    steps: [expectNotOffered("activate", "Card Destruction", "p0")] });
}

function afterLossScenario(format: "ffa3" | "ffa4", domain: boolean, code: 72892473 | 74519184 | 33396948): Scenario {
  const scenario = code === 33396948 ? exodiaScenario(format, domain, format === "ffa3" ? 2 : 3) : handScenario(format, domain, code, 0);
  scenario.id = `owner-${code === 33396948 ? "exodia" : `hands-${code}`}-prior-loss-${format}${domain ? "-domain" : ""}`;
  scenario.title += "; p1 has already lost";
  scenario.tags.push("prior-loss");
  // The lost seat has no hand. Hand Destruction must skip it at resolution.
  scenario.setup.p1!.hand = ["Silver Fang", "Silver Fang"];
  scenario.steps = scenario.steps.filter(step => !(step.op === "phase" && step.by === "p1")
    && !(step.op === "expectPrompt" && step.prompt.by === "p1") && !(step.op === "select" && step.by === "p1"));
  for (const step of scenario.steps) if (step.op === "expectBoard") step.board.p1 = { hand: [], grave: [], deckCount: 0 };
  scenario.steps.unshift(surrender("p1"), expectEliminated("p1"));
  return scenario;
}

export const OWNER_HANDS_EXODIA_SCENARIOS: Scenario[] = FORMATS.flatMap(format => [false, true].flatMap(domain => [
  ...([72892473, 74519184] as const).flatMap(code => [0, 1].map(actor => handScenario(format, domain, code, actor))),
  ...SEATS.slice(0, format === "ffa3" ? 3 : 4).map((_, actor) => exodiaScenario(format, domain, actor)),
  splitExodiaScenario(format, domain), shortHandScenario(format, domain), offTurnHandScenario(format, domain), emptyHandScenario(format, domain),
  replacedExodiaScenario(format, domain, [2]), replacedExodiaScenario(format, domain, [1, 2]),
  ...(format === "tag" ? [replacedExodiaScenario(format, domain, [0, 2])] : []),
  ...(format === "tag" ? [] : ([72892473, 74519184, 33396948] as const).map(code => afterLossScenario(format, domain, code))),
  ...(format === "ffa4" ? [deckOutScenario(domain, 1), deckOutScenario(domain, 2), shortDeckScenario(domain)] : []),
]));
