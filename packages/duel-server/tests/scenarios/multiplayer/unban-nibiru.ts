import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectPrompt, faceDown, normalSummon,
  pass, pickOpponent, position, zone, type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";

export const NIBIRU = "Nibiru, the Primal Being";
export const NIBIRU_TOKEN = 27204312;
export const KURIBOH = "Kuriboh";
const KURIBOH_TOKEN = 40703223;
export const MULTIPLY = "Multiply";
export const ELF = "Mystical Elf";
export const OX = "Battle Ox";
export const NIBIRU_SOURCE = "Owner 2026-10-18: Nibiru counts summons by the real turn player; tribute only its controller and that opponent in FFA, or their two full sides in Tag; summon Nibiru to its controller and the Token to the turn player. docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-RESPONSE] [R-COMMON-SEAT-STATE] [R-TAG-SHARED-CARDS]";
export const NIBIRU_FORMATS = ["ffa3", "ffa4", "tag"] as const;
export type NibiruFormat = typeof NIBIRU_FORMATS[number];
export const nibiruSeats = (format: NibiruFormat): DuelistId[] => format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
export const nibiruOpponent = (format: NibiruFormat, a: DuelistId, b: DuelistId): boolean =>
  format === "tag" ? Number(a[1]) % 2 !== Number(b[1]) % 2 : a !== b;

// A real Normal Summon followed by four real token summons reaches exactly five.
// The set Elf keeps one zone occupied and proves that face-down monsters stay.
export function nibiruSummons(actor: DuelistId, format: NibiruFormat): Step[] {
  return [normalSummon(KURIBOH, actor), zone(actor, "m0", actor),
    activate(MULTIPLY, actor),
    ...(format !== "tag" ? [pickOpponent(nibiruSeats(format).find(seat => seat !== actor)!, actor)] : []),
    zone(actor, "s0", actor)];
}

const resolutions = NIBIRU_FORMATS.flatMap(format => nibiruSeats(format).flatMap(actor => nibiruSeats(format)
  .filter(holder => nibiruOpponent(format, actor, holder)).map(holder => {
    const seats = nibiruSeats(format);
    const setup: Scenario["setup"] = { format, skipOpeningDraw: true };
    const board: BoardExpect = {};
    for (const seat of seats) {
      const isActor = seat === actor;
      const isHolder = seat === holder;
      const affected = isActor || isHolder || format === "tag";
      setup[seat] = { hand: isActor ? [KURIBOH, MULTIPLY] : isHolder ? [NIBIRU] : [],
        monsters: isActor ? [null, faceDown(ELF)] : [isHolder ? ELF : OX, faceDown(ELF)] };
      board[seat] = {
        lp: format === "tag" ? 16000 : 8000,
        hand: seat !== "p0" && Number(seat[1]) <= Number(actor[1]) ? [ELF] : [],
        monsters: isActor ? [NIBIRU_TOKEN, ELF] : isHolder ? [NIBIRU, ELF] : affected ? [ELF] : [OX, ELF],
        spells: [], grave: isActor ? [KURIBOH, MULTIPLY] : affected ? [isHolder ? ELF : OX] : [],
        banished: [], extra: [], deckCount: 20 - (seat !== "p0" && Number(seat[1]) <= Number(actor[1]) ? 1 : 0),
        zones: { m1: { card: ELF, pos: "facedown" } },
      };
    }
    board[actor]!.zones!.m0 = { card: NIBIRU_TOKEN, attack: format === "tag" ? 5400 : 2000, defense: format === "tag" ? 4800 : 2800 };
    board[holder]!.zones!.m0 = { card: NIBIRU, pos: "atk" };
    return defineScenario({
      id: `unban-nibiru-${format}-turn-${actor}-holder-${holder}`,
      title: `${format}: ${holder} tributes only the allowed fields after ${actor}'s fifth summon`,
      source: NIBIRU_SOURCE, rules: ["R-FFA-OPP-RESPONSE", "R-COMMON-SEAT-STATE", ...(format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])],
      tags: ["multiplayer", format, "card:27204311"], setup,
      steps: [...seats.slice(0, seats.indexOf(actor)).map(seat => endTurn(seat)), ...nibiruSummons(actor, format),
        activate(NIBIRU, holder), zone(holder, "m0", holder), position("atk", holder),
        zone(actor, "m0", holder), position("atk", holder), expectPrompt({ by: actor, context: "action" }), expectBoard(board)],
    });
  })));

const noNibiru = (holder: DuelistId): Step => ({ op: "expectSeatNotOffered", action: "activate", sel: NIBIRU, by: holder });

const countControls = NIBIRU_FORMATS.flatMap(format => nibiruSeats(format).flatMap(actor => nibiruSeats(format).map(holder => {
  const seats = nibiruSeats(format);
  const opponent = nibiruOpponent(format, actor, holder);
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true };
  for (const seat of seats) setup[seat] = { hand: seat === holder ? [NIBIRU] : [], monsters: [] };
  setup[actor] = { hand: [...(actor === holder ? [NIBIRU] : []), MULTIPLY, ...(opponent ? [] : [KURIBOH])],
    monsters: opponent ? [KURIBOH, faceDown(ELF)] : [null, faceDown(ELF)] };
  const steps = opponent
    ? [activate(MULTIPLY, actor), ...(format !== "tag" ? [pickOpponent(seats.find(seat => seat !== actor)!, actor)] : []), zone(actor, "s0", actor)]
    : nibiruSummons(actor, format);
  const board: BoardExpect = { [actor]: { monsters: { count: 5, include: [ELF, KURIBOH_TOKEN] }, grave: [KURIBOH, MULTIPLY] } };
  board[holder] = { ...board[holder], hand: { include: [NIBIRU] } };
  return defineScenario({
    id: `unban-nibiru-${format}-${opponent ? "four-summons" : "own-side"}-turn-${actor}-holder-${holder}`,
    title: `${format}: ${holder} cannot use Nibiru after ${opponent ? "only four summons" : "its own side summons five"}`,
    source: NIBIRU_SOURCE, rules: ["R-FFA-OPP-RESPONSE", "R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", format, "card:27204311"], setup,
    steps: [...seats.slice(0, seats.indexOf(actor)).map(seat => endTurn(seat)), ...steps,
      noNibiru(holder), expectPrompt({ by: actor, context: "action" }),
      expectBoard(board)],
  });
})));

// The non-turn duelist summons five while answering the turn player's Spell.
// Those summons must not enable Nibiru now or carry over to that duelist's next turn.
const otherTurn = NIBIRU_FORMATS.flatMap(format => nibiruSeats(format).slice(1).map(summoner => {
  const seats = nibiruSeats(format);
  const actor = "p0";
  const holder = seats.find(seat => seat !== summoner && nibiruOpponent(format, summoner, seat))!;
  const setup: Scenario["setup"] = { format, skipOpeningDraw: true };
  for (const seat of seats) setup[seat] = { hand: seat === holder ? [NIBIRU] : [] };
  setup[actor]!.hand = [...(actor === holder ? [NIBIRU] : []), "Dian Keto the Cure Master"];
  setup[summoner] = { monsters: [KURIBOH], spells: [faceDown(MULTIPLY)] };
  return defineScenario({
    id: `unban-nibiru-${format}-nonturn-${summoner}-turn-${actor}-reset`,
    title: `${format}: five summons by ${summoner} outside its turn do not enable Nibiru or carry to its next turn`,
    source: NIBIRU_SOURCE, rules: ["R-FFA-OPP-RESPONSE", "R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", format, "card:27204311"], setup,
    steps: [activate("Dian Keto the Cure Master", actor), zone(actor, "s0", actor), activate(MULTIPLY, summoner),
      ...(format !== "tag" ? [pickOpponent(seats.find(seat => seat !== summoner)!, summoner)] : []),
      noNibiru(holder), expectPrompt({ by: actor, context: "action" }),
      expectBoard({ [summoner]: { monsters: { count: 5, include: [KURIBOH_TOKEN] }, grave: [KURIBOH, MULTIPLY] }, [holder]: { hand: { include: [NIBIRU] } } }),
      ...seats.slice(0, seats.indexOf(summoner)).map(seat => endTurn(seat)),
      noNibiru(holder), expectPrompt({ by: summoner, context: "action" }), noNibiru(holder),
      expectBoard({ [holder]: { hand: { include: [NIBIRU] } }, [summoner]: { monsters: { count: 5, include: [KURIBOH_TOKEN] } } })],
  });
}));

const battleControls = resolutions.map(scenario => {
  const actor = scenario.id.match(/turn-(p\d)/)![1] as DuelistId;
  const holder = scenario.id.match(/holder-(p\d)/)![1] as DuelistId;
  const end = scenario.steps.findIndex(step => step.op === "activate" && step.sel === NIBIRU);
  return defineScenario({ ...scenario, id: `${scenario.id}-main-phase-only`,
    title: `${scenario.setup.format}: Nibiru cannot activate in the Battle Phase after five summons`,
    setup: { ...scenario.setup, attackFirstTurn: true },
    steps: [...scenario.steps.slice(0, end), pass(holder), expectPrompt({ by: actor, context: "action" }),
      changePhase("battle", actor), pass(holder), expectPrompt({ by: actor, context: "action" }),
      noNibiru(holder), expectBoard({ [holder]: { hand: { include: [NIBIRU] }, monsters: [ELF, ELF] }, [actor]: { monsters: { count: 5 }, grave: [KURIBOH, MULTIPLY] } })],
  });
});

const tagSeparateCounts = (["p0"] as const).flatMap(actor => nibiruSeats("tag")
  .filter(holder => nibiruOpponent("tag", actor, holder)).map(holder => {
    const partner = `p${(Number(actor[1]) + 2) % 4}` as DuelistId;
    const setup: Scenario["setup"] = { format: "tag", skipOpeningDraw: true,
      [actor]: { hand: [ELF] }, [holder]: { hand: [NIBIRU] },
      [partner]: { monsters: [KURIBOH, faceDown(ELF)], spells: [faceDown(MULTIPLY)] } };
    return defineScenario({ id: `unban-nibiru-tag-separate-counts-turn-${actor}-partner-${partner}-holder-${holder}`,
      title: `Tag: one summon by ${actor} and four by ${partner} do not enable Nibiru`,
      source: NIBIRU_SOURCE, rules: ["R-COMMON-SEAT-STATE", "R-TAG-SHARED-CARDS"],
      tags: ["multiplayer", "tag", "card:27204311"], setup,
      steps: [normalSummon(ELF, actor), zone(actor, "m0", actor), activate(MULTIPLY, partner),
        noNibiru(holder), expectPrompt({ by: actor, context: "action" }),
        expectBoard({ [holder]: { hand: { include: [NIBIRU] } }, [actor]: { monsters: [ELF] },
          [partner]: { monsters: { count: 5, include: [ELF, KURIBOH_TOKEN] }, grave: [KURIBOH, MULTIPLY] } })],
    });
  }));

const standard = [...resolutions, ...countControls, ...otherTurn, ...battleControls, ...tagSeparateCounts];
export const UNBAN_NIBIRU_SCENARIOS = [...standard, ...standard.map(domainVariant)];
