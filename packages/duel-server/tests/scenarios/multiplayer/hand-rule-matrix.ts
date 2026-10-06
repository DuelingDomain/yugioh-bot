import { opponentSeatsOf, seatCountFor, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import { activate, attack, choose, defineScenario, endTurn, expectBoard, expectNoEvent, expectOffered, expectPrompt, pickOpponent, select, yes, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const WHITE = "Blue-Eyes White Dragon";
const ABYSS = "Deep-Eyes White Dragon, the Blue Abyss";
const ASH = "Ash Blossom & Joyous Spring";
const ELF = "Mystical Elf";

function board(format: DuelFormat, mode: DuelMode): Scenario["setup"] {
  const setup: Scenario["setup"] = { format, mode, attackFirstTurn: true, skipOpeningDraw: true };
  for (let seat = 0; seat < seatCountFor(format); seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: ELF } : {};
  return setup;
}

function abyss(format: DuelFormat, mode: DuelMode, owner: number, from: "hand" | "grave", battle: boolean): Scenario {
  const count = seatCountFor(format);
  const holder = SEATS[owner]!;
  const attacker = opponentSeatsOf(format, owner)[0]!;
  const acting = SEATS[attacker]!;
  const setup = board(format, mode);
  setup[holder] = { ...setup[holder], monsters: [WHITE], [from]: [ABYSS] };
  setup[acting] = { ...setup[acting], ...(battle ? { monsters: ["Blue-Eyes Ultimate Dragon"] } : { hand: ["Dark Hole"] }) };
  const steps: Step[] = Array.from({ length: (battle ? count : 0) + attacker }, (_, turn) => endTurn(SEATS[turn % count]!));
  steps.push(battle ? attack("Blue-Eyes Ultimate Dragon", { card: WHITE, owner: holder }, acting) : activate("Dark Hole", acting));
  if (battle) {
    steps.push(expectPrompt({ by: acting, context: "action" }), expectNoEvent({ kind: "activate", card: ABYSS, by: holder }),
      expectBoard({ [holder]: { monsters: { exclude: [WHITE, ABYSS] }, grave: { include: [WHITE, ...(from === "grave" ? [ABYSS] : [])] },
        hand: { include: from === "hand" ? [ABYSS] : [] }, lp: (format === "tag" ? 16000 : 8000) - 1500 } }));
  } else {
    steps.push(from === "hand" ? expectOffered("activate", ABYSS, holder) : expectPrompt({ by: holder, kind: "choice", title: ABYSS }), from === "hand" ? activate(ABYSS, holder) : yes(holder),
      expectBoard({ [holder]: { monsters: { include: [ABYSS] }, hand: { exclude: [ABYSS] }, grave: { include: [WHITE], exclude: [ABYSS] },
        zones: { m0: { card: ABYSS, attack: 3000 } } } }));
  }
  return defineScenario({ id: `blue-abyss-${mode}-${format}-p${owner}-${from}-${battle ? "damage-step-negative" : "effect-positive"}`,
    title: `${format} ${mode}: p${owner} Blue Abyss in ${from} ${battle ? "cannot activate in the Damage Step" : "summons after White Dragon enters its GY"}`,
    source: "https://www.db.yugioh-card.com/yugiohdb/faq_search.action?cid=22717&ope=4&request_locale=ja",
    tags: ["hand-effects", "multiplayer", "card:67886895", format, mode], setup, steps });
}

function ash(format: DuelFormat, mode: DuelMode, owner: number): Scenario {
  const holder = SEATS[owner]!;
  const turn = opponentSeatsOf(format, owner)[0]!;
  const acting = SEATS[turn]!;
  const setup = board(format, mode);
  setup[holder]!.hand = [ASH]; setup[acting]!.hand = ["Pot of Greed"];
  const steps: Step[] = Array.from({ length: turn }, (_, seat) => endTurn(SEATS[seat]!));
  steps.push(activate("Pot of Greed", acting), expectOffered("activate", { card: ASH, from: "hand" }, holder), activate(ASH, holder),
    expectBoard({ [holder]: { hand: { exclude: [ASH] }, grave: { include: [ASH] } },
      [acting]: { hand: turn > 0 ? [ELF] : [], grave: { include: ["Pot of Greed"] } } }));
  return defineScenario({ id: `ash-hand-${mode}-${format}-p${owner}`, title: `${format} ${mode}: p${owner} negates the opponent's draw from hand`,
    source: "card-scripts/official/c14558127.lua", tags: ["hand-effects", "multiplayer", "card:14558127", format, mode], setup, steps });
}

function oneAgainstOne(mode: DuelMode, card: "Honest" | "Gorz the Emissary of Darkness" | "Effect Veiler" | 'Maxx "C"'): Scenario {
  const setup = board("1v1", mode); setup.p1!.hand = [card];
  let steps: Step[];
  if (card === "Honest") {
    setup.p0!.monsters = ["Axe Raider"]; setup.p1!.monsters = [ELF];
    steps = [attack("Axe Raider", { card: ELF, owner: "p1" }, "p0"), expectOffered("activate", card, "p1"), activate(card, "p1"),
      expectBoard({ p0: { grave: { include: ["Axe Raider"] }, lp: 7200 }, p1: { grave: { include: [card] }, monsters: [ELF], lp: 8000 } })];
  } else if (card === "Gorz the Emissary of Darkness") {
    setup.p0!.monsters = ["Axe Raider"];
    steps = [attack("Axe Raider", "direct", "p0"), expectOffered("activate", card, "p1"), activate(card, "p1"),
      expectBoard({ p1: { hand: [], monsters: [card, "Emissary of Darkness Token"], lp: 6300 } })];
  } else if (card === "Effect Veiler") {
    setup.p0!.monsters = ["Card Trooper"];
    steps = [activate("Card Trooper", "p0"), choose("3", "p0"), expectOffered("activate", card, "p1"), activate(card, "p1"),
      expectBoard({ p0: { zones: { m0: { card: "Card Trooper", attack: 400 } } }, p1: { hand: [], grave: [card] } })];
  } else {
    setup.p0!.hand = ["Monster Reborn"]; setup.p0!.grave = [ELF];
    steps = [activate("Monster Reborn", "p0"), expectOffered("activate", card, "p1"), activate(card, "p1"),
      expectBoard({ p0: { monsters: [ELF], grave: ["Monster Reborn"] }, p1: { hand: [ELF], grave: [card] } })];
  }
  const code = { Honest: 37742478, "Gorz the Emissary of Darkness": 44330098, "Effect Veiler": 97268402, 'Maxx "C"': 23434538 }[card];
  return defineScenario({ id: `hand-staple-${mode}-1v1-${code}`, title: `1v1 ${mode}: non-turn p1 uses ${card} from hand`,
    source: `card-scripts/official/c${code}.lua`, tags: ["hand-effects", "1v1", mode, `card:${code}`], setup, steps });
}

function trapLock(format: DuelFormat, mode: DuelMode, owner: number, songs: boolean): Scenario {
  const holder = SEATS[owner]!;
  const attacker = opponentSeatsOf(format, owner)[0]!;
  const acting = SEATS[attacker]!;
  const trap = songs ? "Songs of the Dominators" : "Dominus Purge";
  const setup = board(format, mode);
  setup[holder] = { ...setup[holder], hand: [trap, "Blue-Eyes Jet Dragon"], monsters: [WHITE] };
  setup[acting] = { ...setup[acting], monsters: ["Card Trooper"], hand: ["Dark Hole", ...(!songs ? ["Pot of Greed"] : [])] };
  const steps: Step[] = Array.from({ length: attacker }, (_, seat) => endTurn(SEATS[seat]!));
  steps.push(activate(songs ? "Card Trooper" : "Pot of Greed", acting), ...(songs ? [choose("3", acting)] : []),
    expectOffered("activate", { card: trap, from: "hand" }, holder), activate(trap, holder), activate("Dark Hole", acting));
  if (songs) {
    steps.push(expectPrompt({ by: acting, context: "action" }), expectNoEvent({ kind: "activate", card: "Blue-Eyes Jet Dragon", by: holder }),
      expectBoard({ [holder]: { hand: { include: ["Blue-Eyes Jet Dragon"], exclude: [trap] }, grave: { include: [WHITE, trap] }, monsters: [] } }));
  } else {
    steps.push(expectOffered("activate", "Blue-Eyes Jet Dragon", holder), activate("Blue-Eyes Jet Dragon", holder),
      expectBoard({ [holder]: { hand: { exclude: ["Blue-Eyes Jet Dragon", trap] }, grave: { include: [WHITE, trap] }, monsters: ["Blue-Eyes Jet Dragon"] } }));
  }
  return defineScenario({ id: `jet-trap-lock-${mode}-${format}-p${owner}-${songs ? "songs-blocks" : "purge-allows"}`,
    title: `${format} ${mode}: p${owner} hand ${trap} ${songs ? "blocks Jet" : "allows LIGHT Jet"} after destruction`,
    source: `card-scripts/official/c${songs ? 58053438 : 97045737}.lua`, tags: ["hand-effects", "multiplayer", format, mode], setup, steps });
}

function delayedJet(format: DuelFormat, mode: DuelMode): Scenario {
  const holder: DuelistId = format === "1v1" ? "p1" : format === "tag" ? "p3" : "p2";
  const setup = board(format, mode);
  setup.p0 = { ...setup.p0, monsters: [WHITE], hand: ["Book of Moon"] };
  setup.p1 = { ...setup.p1, monsters: ["Zombino"] };
  setup[holder] = { ...setup[holder], hand: ["Blue-Eyes Jet Dragon", ELF], grave: [WHITE], spells: [{ card: "Raigeki Break", pos: "set" }] };
  return defineScenario({ id: `jet-if-delay-${mode}-${format}`, title: `${format} ${mode}: Jet waits until the chain ends after destruction at Chain Link 2`,
    source: "card-scripts/official/c30576089.lua", tags: ["hand-effects", "multiplayer", "card:30576089", format, mode], setup,
    steps: [activate("Book of Moon", "p0"), select({ card: WHITE, owner: "p0" }), activate("Raigeki Break", holder),
      select({ card: ELF, owner: holder, from: "hand" }), select({ card: "Zombino", owner: "p1" }),
      expectOffered("activate", "Blue-Eyes Jet Dragon", holder), expectBoard({ p0: { zones: { m0: { card: WHITE, pos: "set" } } }, p1: { grave: { include: ["Zombino"] } } }),
      activate("Blue-Eyes Jet Dragon", holder), expectBoard({ [holder]: { monsters: { include: ["Blue-Eyes Jet Dragon"] }, hand: { exclude: ["Blue-Eyes Jet Dragon"] } } })] });
}

export const HAND_RULE_MATRIX: Scenario[] = (["normal", "domain"] as const).flatMap(mode => [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format => Array.from({ length: seatCountFor(format) }, (_, owner) => [
    ash(format, mode, owner), trapLock(format, mode, owner, true), trapLock(format, mode, owner, false),
    ...(["hand", "grave"] as const).flatMap(from => [abyss(format, mode, owner, from, false), abyss(format, mode, owner, from, true)]),
  ]).flat()),
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map(format => delayedJet(format, mode)),
  ...(["Honest", "Gorz the Emissary of Darkness", "Effect Veiler", 'Maxx "C"'] as const).map(card => oneAgainstOne(mode, card)),
]);
