import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcgHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame } from "../src/engine.js";
import { createEngineGame as createLegacyEngineGame } from "../src/legacy/engine.js";
import { choosePracticeBotAnswer } from "../src/practice-bot.js";

const fake = vi.hoisted(() => ({ batches: [] as OcgMessage[][], messages: [] as OcgMessage[], chain: [] as object[] }));
// Only replace the core and missing card bundle. Use the real answer mapping, processing loops and views.
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async () => ({
    createDuel: () => ({}), destroyDuel: () => undefined, startDuel: () => undefined,
    duelNewCard: () => undefined, loadScript: () => true, duelSetResponse: () => undefined,
    duelProcess: () => {
      const messages = fake.batches.shift();
      if (!messages) throw new Error("Unexpected core processing step");
      fake.messages = messages;
      for (const message of messages) {
        if (message.type === actual.OcgMessageType.CHAINING) fake.chain[message.chain_size - 1] = message;
        if (message.type === actual.OcgMessageType.CHAIN_END) fake.chain = [];
      }
      return actual.OcgProcessResult.WAITING;
    },
    duelGetMessage: () => fake.messages,
    duelQueryField: () => ({ players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }], chain: fake.chain }),
    duelQueryCount: () => 30, duelQueryLocation: () => [],
  }) };
});
vi.mock("../src/cards.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cards.js")>(),
  loadCardDatabase: () => ({
    readScript: () => "-- test resource", cardData: () => null,
    get: (code: number) => code === 4014 || code === 5000 ? undefined : ({ code, canonicalPasscode: code === 10000002 ? 10000001 : code, name: "Effect card", description: "Printed text", type: 2 }),
    system: () => undefined,
    resolveLabel: (description: bigint) => ({
      1: 'Add 1 "Mitsurugi" monster from your Deck to your hand', 2: "Take 800 damage",
      3: 'Apply the effect of "%ls"', 4014: "Take 800 damage",
    })[Number(description & 0xfffffn) as 1 | 2 | 3 | 4014] ?? "",
  }),
}));

const CODE = 10000001;
const description = (index: number) => (BigInt(CODE) << 20n) | BigInt(index);
const chain = (index = 1, code = CODE, effectDescription = 0n) => ({
  type: OcgMessageType.CHAINING, chain_size: index, code, controller: 0,
  location: OcgLocation.SZONE, sequence: index - 1, description: effectDescription,
} as OcgMessage);
const chained = (index = 1) => ({ type: OcgMessageType.CHAINED, chain_size: index } as OcgMessage);
const solving = (index = 1) => ({ type: OcgMessageType.CHAIN_SOLVING, chain_size: index } as OcgMessage);
const option = (options = [description(1), description(2)], player = 1) => ({ type: OcgMessageType.SELECT_OPTION, player, options } as OcgMessage);
const followUp = () => ({
  type: OcgMessageType.SELECT_CARD, player: 1, min: 1, max: 1, can_cancel: false,
  selects: [0, 1].map((sequence) => ({ code: CODE + sequence, controller: 1, location: OcgLocation.HAND, sequence, position: OcgPosition.FACEDOWN_DEFENSE })),
} as OcgMessage);
const hint = (index: number, player = 0) => ({ type: OcgMessageType.HINT, hint_type: OcgHintType.OPSELECTED, hint: description(index), player } as OcgMessage);
const idle = () => ({
  type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], special_summons: [], pos_changes: [],
  monster_sets: [], spell_sets: [], activates: [], to_bp: false, to_ep: true, shuffle: false,
} as OcgMessage);

beforeEach(() => { fake.batches = []; fake.messages = []; fake.chain = []; });

describe.each([["merged", createEngineGame], ["legacy", createLegacyEngineGame]] as const)("%s chain option answers", (_name, create) => {
  const open = () => create({
    mode: "normal", decks: [0, 1].map(() => ({ main: [], extra: [], side: [] })),
    dataDirectory: "/tmp/chain-options-no-bundle", seed: ["1", "2", "3", "4"], standardWasmBinary: new ArrayBuffer(0),
  });

  it.each(["before chaining", "activation", "resolution"])("ignores an effect-description hint with no option prompt during %s", async (window) => {
    const activation = chain(1, CODE, description(1));
    fake.batches = [window === "before chaining"
      ? [hint(1), activation, chained(), followUp()]
      : window === "activation"
        ? [activation, hint(1), chained(), followUp()]
        : [activation, chained(), solving(), hint(1), followUp()]];
    const game = await open();
    try {
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
    } finally { game.close(); }
  });

  it("keeps a selected option that equals the effect description", async () => {
    fake.batches = [[chain(1, CODE, description(1)), chained(), solving(), option()], [hint(1), followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([
        { index: 0, text: 'Add 1 "Mitsurugi" monster from your Deck to your hand' },
      ]);
    } finally { game.close(); }
  });

  it("records the resolving link's opponent choice, with the exact button text", async () => {
    fake.batches = [[chain(), chained(), chain(2), chained(2), solving(), option()], [followUp()]];
    const game = await open();
    try {
      const prompt = game.view(1).prompt!;
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
      expect(() => game.answer(1, prompt.id, { choice: "invalid" })).toThrow("Invalid answer");
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
      game.answer(1, prompt.id, { choice: "opt:1" });
      for (const viewer of [0, 1, null]) {
        expect(game.view(viewer).chain[0].chosenOptions).toEqual([{ index: 1, text: prompt.options[1].label }]);
        expect(game.view(viewer).chain[1].chosenOptions).toBeUndefined();
      }
    } finally { game.close(); }
  });

  it.each(["answer", "hint"])("drops a resolving %s from a different real card", async (source) => {
    const foreign = (BigInt(CODE + 2) << 20n) | 2n;
    fake.batches = source === "answer"
      ? [[chain(), chained(), solving(), option([foreign, description(1)])], [followUp()]]
      : [[chain(), chained(), solving(), { ...hint(2), hint: foreign } as OcgMessage, followUp()]];
    const game = await open();
    try {
      if (source === "answer") game.answer(1, game.view(1).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
    } finally { game.close(); }
  });

  it.each([
    ["answer", 4014n], ["hint", 4014n],
    ["answer", (5000n << 20n) | 2n], ["hint", (5000n << 20n) | 2n],
  ])("keeps a resolving %s from helper string %s", async (source, helper) => {
    fake.batches = source === "answer"
      ? [[chain(), chained(), solving(), option([helper, description(1)])], [followUp()]]
      : [[chain(), chained(), solving(), { ...hint(2), hint: helper } as OcgMessage, followUp()]];
    const game = await open();
    try {
      if (source === "answer") game.answer(1, game.view(1).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([
        { ...(source === "answer" ? { index: 0 } : {}), text: "Take 800 damage" },
      ]);
    } finally { game.close(); }
  });

  it("keeps a resolving choice from alternate artwork of the same card", async () => {
    fake.batches = [[chain(1, CODE + 1), chained(), solving(), option()], [followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 1, text: "Take 800 damage" }]);
    } finally { game.close(); }
  });

  it("attaches an activation choice to the new link even when the earlier link has the same card code", async () => {
    fake.batches = [[chain(), chained(), option(undefined, 0)], [chain(2), chained(2), followUp()]];
    const game = await open();
    try {
      game.answer(0, game.view(0).prompt!.id, { choice: "opt:1" });
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
      expect(game.view(null).chain[1].chosenOptions).toEqual([{ index: 1, text: "Take 800 damage" }]);
      expect(game.view(null).events.filter((event) => event.kind === "activate").at(-1)).toHaveProperty("chosenOptions", [{ index: 1, text: "Take 800 damage" }]);
    } finally { game.close(); }
  });

  it("records a choice between CHAINING and CHAINED", async () => {
    fake.batches = [[chain(), option(undefined, 0)], [chained(), followUp()]];
    const game = await open();
    try {
      game.answer(0, game.view(0).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 0, text: 'Add 1 "Mitsurugi" monster from your Deck to your hand' }]);
    } finally { game.close(); }
  });

  it.each([true, false])("matches activation choices to alternate artwork (before CHAINING: %s)", async (before) => {
    const activation = chain(1, CODE + 1);
    fake.batches = before
      ? [[option(undefined, 0)], [activation, chained(), followUp()]]
      : [[activation, option(undefined, 0)], [chained(), followUp()]];
    const game = await open();
    try {
      game.answer(0, game.view(0).prompt!.id, { choice: "opt:1" });
      expect(game.view(null).chain[0]).toMatchObject({ code: CODE + 1, chosenOptions: [{ index: 1, text: "Take 800 damage" }] });
    } finally { game.close(); }
  });

  it("keeps two choices and removes duplicate hints sent to different recipients", async () => {
    fake.batches = [[chain(), chained(), solving(), option()],
      [hint(2), hint(2, 1), option([description(1), description(3)])],
      [hint(3), followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([
        { index: 1, text: "Take 800 damage" }, { index: 1, text: 'Apply the effect of "Effect card"' },
      ]);
    } finally { game.close(); }
  });

  it("uses public hints for script choices with no prompt and no known option index", async () => {
    fake.batches = [[chain(), chained(), solving(), hint(1), hint(1, 1), hint(2), followUp()]];
    const game = await open();
    try {
      for (const viewer of [0, 1, null]) expect(game.view(viewer).chain[0].chosenOptions).toEqual([
        { text: 'Add 1 "Mitsurugi" monster from your Deck to your hand' }, { text: "Take 800 damage" },
      ]);
    } finally { game.close(); }
  });

  it("does not give a hint-only operation the index of an unselected candidate", async () => {
    fake.batches = [[chain(), chained(), solving(), option()], [hint(1), hint(2), followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([
        { index: 0, text: 'Add 1 "Mitsurugi" monster from your Deck to your hand' }, { text: "Take 800 damage" },
      ]);
    } finally { game.close(); }
  });

  it("keeps repeated real selections of the same operation in distinct prompts", async () => {
    fake.batches = [[chain(), chained(), solving(), option()],
      [hint(2), hint(2, 1), option([description(2), description(1)])], [hint(2), hint(2, 1), followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([
        { index: 1, text: "Take 800 damage" }, { index: 0, text: "Take 800 damage" },
      ]);
    } finally { game.close(); }
  });

  it("deduplicates an operation hint sent after a card follow-up answer", async () => {
    fake.batches = [[chain(), chained(), solving(), option()], [followUp()], [hint(2), followUp()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      game.answer(1, game.view(1).prompt!.id, { selected: ["card:0"] });
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 1, text: "Take 800 damage" }]);
    } finally { game.close(); }
  });

  it("retains choices when the answer completes the whole chain before the next view", async () => {
    fake.batches = [[chain(), chained(), solving(), option()],
      [hint(2), { type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }, { type: OcgMessageType.CHAIN_END }, idle()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.chain).toEqual([]);
        expect(view.events.find((event) => event.kind === "chain-resolved")).toHaveProperty("chosenOptions", [{ index: 1, text: "Take 800 damage" }]);
        // The events from before the choice must not gain future information.
        expect(view.events.find((event) => event.kind === "chain-resolving")).not.toHaveProperty("chosenOptions");
        expect(view.events.find((event) => event.kind === "activate")).not.toHaveProperty("chosenOptions");
      }
    } finally { game.close(); }
  });

  it("records automatic single-option answers", async () => {
    fake.batches = [[chain(), chained(), solving(), option([description(2)])], [followUp()]];
    const game = await open();
    try {
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 0, text: "Take 800 damage" }]);
    } finally { game.close(); }
  });

  it("records practice bot answers through the same answer path", async () => {
    fake.batches = [[chain(), chained(), solving(), option()], [followUp()]];
    const game = await open();
    try {
      const prompt = game.view(1).prompt!;
      game.answer(1, prompt.id, choosePracticeBotAnswer(prompt));
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 0, text: prompt.options[0].label }]);
    } finally { game.close(); }
  });

  it("does not retain a choice refused by the core", async () => {
    fake.batches = [[chain(), chained(), solving(), option()], [{ type: OcgMessageType.RETRY }], [followUp()]];
    const game = await open();
    try {
      const prompt = game.view(1).prompt!;
      expect(() => game.answer(1, prompt.id, { choice: "opt:1" })).toThrow("Invalid answer");
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
      game.answer(1, prompt.id, { choice: "opt:0" });
      expect(game.view(null).chain[0].chosenOptions).toEqual([{ index: 0, text: prompt.options[0].label }]);
    } finally { game.close(); }
  });

  it("discards a non-chain choice before the next action", async () => {
    fake.batches = [[option()], [idle()]];
    const game = await open();
    try {
      game.answer(1, game.view(1).prompt!.id, { choice: "opt:1" });
      fake.batches.push([chain(), chained(), followUp()]);
      game.answer(0, game.view(0).prompt!.id, { choice: "to_ep" });
      expect(game.view(null).chain[0].chosenOptions).toBeUndefined();
    } finally { game.close(); }
  });
});
