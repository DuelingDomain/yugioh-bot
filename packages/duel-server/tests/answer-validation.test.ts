import { describe, expect, it } from "vitest";
import { OcgHintTiming, OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, type OcgMessage } from "ocgcore-wasm";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { validateAnswer } from "../src/answer-validation.js";
import { mapPrompt, resolveAnswer } from "../src/prompts.js";
import { mergeAttackTargetPick } from "../src/attack-target-pick.js";
import type { CardDatabase } from "../src/cards.js";
import * as legacy from "../src/legacy/prompts.js";
import { choosePracticeBotAnswer, chooseSurrenderedAnswer } from "../src/practice-bot.js";

const cards = { get: () => undefined, resolveLabel: () => "", system: () => undefined, counter: () => undefined } as unknown as CardDatabase;

describe("existing answer formats", () => {
  it("accepts seat 2 passing the chain while seat 1's time-limit loss is pending", () => {
    // host-clock-pending.test.ts: p1 left; p2 still has its Dust Tornado window.
    const pending = mapPrompt({ type: OcgMessageType.SELECT_CHAIN, player: 2, forced: false, spe_count: 1,
      selects: [{ code: 60082869, controller: 2, location: OcgLocation.SZONE, sequence: 0, description: 0n }],
    } as never, cards, "p2");
    expect(pending.prompt).toMatchObject({ seat: 2, kind: "choice", min: 0, max: 1,
      cancelable: true, context: { type: "chain", forced: false }, options: [{ id: "card:0" }] });
    const answer = { selected: [] };
    expect(resolveAnswer(pending, 2, "p2", answer, cards)).toEqual({ type: OcgResponseType.SELECT_CHAIN, index: null });
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
  });

  it("accepts an at-least sum satisfied by required cards alone", () => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_SUM, player: 0, select_max: true, amount: 4, min: 1, max: 1,
      selects_must: [{ code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, amount: 4 }],
      selects: [{ code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, amount: 2 }],
    } as never, cards, "p1");
    const answer = { selected: [] };
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_SUM, indicies: [] });
  });

  it.each([{ selected: ["card:0"] }, { selected: ["must:0", "card:0"] }])("accepts a sum with implicit or explicit required cards: %j", (answer) => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_SUM, player: 0, select_max: false, amount: 4, min: 1, max: 1,
      selects_must: [{ code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, amount: 2 }],
      selects: [{ code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, amount: 2 }],
    } as never, cards, "p1");
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_SUM, indicies: [0] });
  });

  it.each([{ selected: ["card:0"] }, { selected: ["card:0"], choice: "direct:1" }])("accepts a combined target selection %j", (answer) => {
    const pending = mergeAttackTargetPick(mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 0n } as never, cards, "p1"), {
      targets: [{ code: 1, controller: 1, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }], directSeats: [1],
    }, cards);
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_YESNO, yes: false });
  });
});

// Worker protocol answers carry DuelAnswer; both engines map these 21 native
// waiting messages. Include choice aliases and empty/default answers accepted by
// resolveAnswer, rather than deriving legality from the displayed prompt bounds.
const card = { code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK } as const;
const nativeCases: Array<{ name: string; message: OcgMessage; answers: DuelAnswer[] }> = [
  { name: "idle", message: { type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [card], special_summons: [card],
    pos_changes: [card], monster_sets: [card], spell_sets: [card], activates: [{ ...card, description: 0n, client_mode: 0 }], to_bp: true, to_ep: true, shuffle: true },
    answers: ["summon:0", "spsummon:0", "pos:0", "mset:0", "sset:0", "activate:0", "to_bp", "to_ep", "shuffle"].map(choice => ({ choice })) },
  { name: "battle", message: { type: OcgMessageType.SELECT_BATTLECMD, player: 0, chains: [{ ...card, description: 0n, client_mode: 0 }],
    attacks: [{ ...card, can_direct: true }], to_m2: true, to_ep: true },
    answers: ["activate:0", "attack:0", "to_m2", "to_ep"].map(choice => ({ choice })) },
  { name: "yes/no", message: { type: OcgMessageType.SELECT_YESNO, player: 0, description: 0n }, answers: [{ choice: "yes" }, { choice: "no" }] },
  { name: "effect yes/no", message: { type: OcgMessageType.SELECT_EFFECTYN, player: 0, ...card, description: 0n }, answers: [{ choice: "yes" }, { choice: "no" }] },
  { name: "option", message: { type: OcgMessageType.SELECT_OPTION, player: 0, options: [0n, 1n] }, answers: [{ choice: "opt:0" }, { choice: "opt:1" }] },
  { name: "cards", message: { type: OcgMessageType.SELECT_CARD, player: 0, min: 0, max: 1, can_cancel: true, selects: [card] },
    answers: [{ selected: ["card:0"] }, { choice: "card:0" }, { selected: [] }, {}, { cancel: true }] },
  { name: "tribute", message: { type: OcgMessageType.SELECT_TRIBUTE, player: 0, min: 2, max: 1, can_cancel: true, selects: [{ ...card, release_param: 2 }] },
    answers: [{ selected: ["card:0"] }, { choice: "card:0" }, { cancel: true }] },
  { name: "chain", message: { type: OcgMessageType.SELECT_CHAIN, player: 0, forced: false, spe_count: 1, hint_timing: OcgHintTiming.DRAW_PHASE, hint_timing_other: OcgHintTiming.DRAW_PHASE,
    selects: [{ ...card, description: 0n, client_mode: 0 }] },
    answers: [{ choice: "card:0" }, { selected: [] }, {}, { choice: "" }, { cancel: true }] },
  { name: "place", message: { type: OcgMessageType.SELECT_PLACE, player: 0, count: 1, field_mask: 0xfffffffe },
    answers: [{ selected: ["place:0"] }, { choice: "place:0" }] },
  { name: "disable field", message: { type: OcgMessageType.SELECT_DISFIELD, player: 0, count: 1, field_mask: 0xfffeffff },
    answers: [{ selected: ["place:0"] }, { choice: "place:0" }] },
  { name: "position", message: { type: OcgMessageType.SELECT_POSITION, player: 0, code: 1, positions: (OcgPosition.FACEUP_ATTACK | OcgPosition.FACEDOWN_DEFENSE) as OcgPosition },
    answers: [{ choice: "pos:1" }, { choice: "pos:8" }] },
  { name: "counters", message: { type: OcgMessageType.SELECT_COUNTER, player: 0, counter_type: 1, count: 1, cards: [{ ...card, count: 2 }, { ...card, sequence: 1, count: 0 }] },
    answers: [{ counts: { "card:0": 1 } }, { counts: { "card:0": 1, "card:1": 0 } }] },
  { name: "sum", message: { type: OcgMessageType.SELECT_SUM, player: 0, select_max: 0, amount: 4, min: 1, max: 1,
    selects_must: [{ ...card, amount: 2 }], selects: [{ ...card, sequence: 1, amount: 2 }] },
    answers: [{ selected: ["card:0"] }, { selected: ["must:0", "card:0"] }, { choice: "card:0" }] },
  { name: "at-least sum", message: { type: OcgMessageType.SELECT_SUM, player: 0, select_max: 1, amount: 4, min: 1, max: 1,
    selects_must: [{ ...card, amount: 4 }], selects: [{ ...card, sequence: 1, amount: 2 }] }, answers: [{ selected: [] }, {}] },
  { name: "select/unselect", message: { type: OcgMessageType.SELECT_UNSELECT_CARD, player: 0, min: 1, max: 2, can_cancel: true, can_finish: true,
    select_cards: [card], unselect_cards: [{ ...card, sequence: 1 }] },
    answers: [{ choice: "select:0" }, { choice: "unselect:0" }, { finish: true }, { cancel: true }, { cancel: true, finish: true }] },
  { name: "sort cards", message: { type: OcgMessageType.SORT_CARD, player: 0, cards: [card, { ...card, sequence: 1 }] }, answers: [{ selected: ["card:1", "card:0"] }] },
  { name: "sort chain", message: { type: OcgMessageType.SORT_CHAIN, player: 0, cards: [card, { ...card, sequence: 1 }] }, answers: [{ selected: ["card:1", "card:0"] }] },
  { name: "announce race", message: { type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 1, available: 1n as never }, answers: [{ selected: ["race:1"] }, { choice: "race:1" }] },
  { name: "announce attribute", message: { type: OcgMessageType.ANNOUNCE_ATTRIB, player: 0, count: 1, available: 1 as never }, answers: [{ selected: ["attr:1"] }, { choice: "attr:1" }] },
  { name: "announce card/search", message: { type: OcgMessageType.ANNOUNCE_CARD, player: 0, opcodes: [] }, answers: [{ cardCode: 70781052 }] },
  { name: "announce number", message: { type: OcgMessageType.ANNOUNCE_NUMBER, player: 0, options: [1n, 2n] }, answers: [{ choice: "num:0" }, { value: 1 }] },
  { name: "RPS", message: { type: OcgMessageType.ROCK_PAPER_SCISSORS, player: 0 }, answers: ["rps:rock", "rps:paper", "rps:scissors"].map(choice => ({ choice })) },
];

describe.each([["pinned/multi", { mapPrompt, resolveAnswer }], ["legacy", legacy]] as const)("%s worker prompt answers", (_name, mapping) => {
  it.each(nativeCases.flatMap(({ name, message, answers }) => answers.map(answer => ({ name, message, answer }))))("accepts $name $answer", ({ message, answer }) => {
    const pending = mapping.mapPrompt(message, cards, "p1");
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    // Announce-card legality needs the card database; the host search returns a
    // permitted cardCode. Other rows also exercise the existing engine checks.
    if (message.type !== OcgMessageType.ANNOUNCE_CARD) expect(() => mapping.resolveAnswer(pending, 0, "p1", answer, cards)).not.toThrow();
  });
});

// Host suites use literal choices or IDs taken from the current prompt, and
// choosePracticeBotAnswer/chooseSurrenderedAnswer for the remaining prompts.
// The entries below preserve every distinct answer shape used by those callers.
const hostCases: Array<{ source: string; prompt: DuelPrompt; answer: DuelAnswer }> = [];
function hostAnswers(source: string, kind: DuelPrompt["kind"], answers: DuelAnswer[], extra: Partial<DuelPrompt> = {}) {
  const prompt: DuelPrompt = { id: "p1", seat: 0, kind, title: "Prompt", options: [{ id: "card:0", label: "Card", max: 2, values: [2] }], min: 1, max: 1, target: 1, ...extra };
  hostCases.push(...answers.map(answer => ({ source, prompt, answer })));
}
hostAnswers("host/chain-mode/report-replay", "choice", [{ choice: "pass" }]);
hostAnswers("host-nseat/ffa4/dice/first-turn/eliminate/multiplayer-stack/bot-pacing", "choice", [{ choice: "to_ep" }]);
hostAnswers("host-script-autoblock", "choice", [{ choice: "continue" }]);
hostAnswers("host-surrender/seat-left/opponent-pick", "choice", [{ choice: "opt:0" }, { choice: "opt:1" }], { context: { type: "opponent" } });
hostAnswers("host-hand-effects/script-errors/chain-mode-real", "choice", [{ choice: "yes" }, { choice: "no" }, { choice: "activate:0" }, { choice: "summon:0" }, { choice: "spsummon:0" }, { choice: "card:0" }]);
hostAnswers("host-clock-pending", "choice", [{ selected: [] }], { seat: 2, min: 0, cancelable: true, context: { type: "chain", forced: false } });
hostAnswers("host validation cards/domain-card-restriction", "cards", [{ selected: ["card:0"] }]);
hostAnswers("host validation tribute", "tribute", [{ selected: ["card:0"] }]);
hostAnswers("host validation places/domain-card-restriction", "places", [{ selected: ["card:0"] }]);
hostAnswers("host validation order", "order", [{ selected: ["card:0"] }]);
hostAnswers("host validation counters", "counters", [{ counts: { "card:0": 1 } }]);
hostAnswers("host validation number", "number", [{ value: 1 }]);
hostAnswers("host validation announce-card", "announce-card", [{ cardCode: 1 }]);
hostAnswers("host validation sum", "sum", [{ selected: ["card:0"] }]);
hostAnswers("host validation toggle", "toggle", [{ choice: "card:0" }]);
hostAnswers("host opening RPS/dice/series first-choice", "choice", [{ choice: "first" }, { choice: "second" }]);
// Opening moves and dice rolls are separate host operations, not worker answers.
// The in-engine RPS answers are covered in the native table above.
for (const { name, message } of nativeCases) {
  // This required-only at-least sum uses explicit answers in the native table;
  // the practice bot's exact-sum search cannot answer it.
  if (name === "at-least sum") continue;
  const prompt = mapPrompt(message, cards, "p1").prompt;
  const options = { permittedCards: [{ code: 70781052 } as never] };
  hostCases.push({ source: `host-domain/coin-clock practice bot: ${name}`, prompt, answer: choosePracticeBotAnswer(prompt, options) });
  hostCases.push({ source: `host-surrender/multiplayer/script-errors surrendered seat: ${name}`, prompt, answer: chooseSurrenderedAnswer(prompt, options) });
}
describe("existing host answer corpus", () => {
  it.each(hostCases)("accepts $source $answer", ({ prompt, answer }) => {
    expect(() => validateAnswer(prompt, answer)).not.toThrow();
  });
});

describe("structural validation", () => {
  const prompt: DuelPrompt = { id: "p1", seat: 0, kind: "cards", title: "Select", options: [], min: 1, max: 1 };
  it.each([null, [], "answer", 1, true, { selected: "card:0" }, { selected: [null] }, { selected: [1] },
    { choice: null }, { choice: 1 }, { counts: null }, { counts: [] }, { counts: { "card:0": "1" } },
    { counts: { "card:0": NaN } }, { counts: { "card:0": Infinity } }, { value: "1" }, { value: NaN },
    { cardCode: null }, { cardCode: Infinity }, { cancel: "true" }, { finish: 1 }])("rejects malformed input %j", input => {
    expect(() => validateAnswer(prompt, input)).toThrow("Invalid answer");
  });
  it.each([{}, { selected: [] }, { selected: ["removed:0"] }, { selected: ["card:0", "card:0"] },
    { choice: "removed:0" }, { counts: { "removed:0": 3 } }, { counts: { "card:0": -1 } },
    { value: 2 }, { value: 0.5 }, { cardCode: -1 }, { cancel: true }, { finish: true },
    { cancel: true, finish: true }, { choice: "card:0", selected: [], value: 2, extra: "ignored" },
  ])("defers prompt-dependent legality for %j", answer => {
    expect(() => validateAnswer(prompt, answer)).not.toThrow();
  });
  it("accepts a structurally valid answer for an unknown prompt kind", () => {
    expect(() => validateAnswer({ ...prompt, kind: "future-prompt" } as unknown as DuelPrompt, { choice: "future:0", extra: 1 })).not.toThrow();
  });
  it("leaves semantic rejection to the engine", () => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_CARD, player: 0, min: 1, max: 1, can_cancel: false, selects: [card] } as never, cards, "p1");
    for (const answer of [{ selected: [] }, { selected: ["card:99"] }, { selected: ["card:0", "card:0"] }, { cancel: true }]) {
      expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
      expect(() => resolveAnswer(pending, 0, "p1", answer, cards)).toThrow("Invalid answer");
    }
  });
});
