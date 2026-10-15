import { beforeEach, describe, expect, it, vi } from "vitest";
import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { OcgHintType, OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame, registerDomainCoreFactory, type EngineGame, type EngineGameOptions } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { DESTROY_NOTE_PREFIX } from "../src/views.js";
import { MSG_ATTACK_DUELIST } from "../src/raw-messages.js";
import { TARGET_CARD_NOTE_PREFIX } from "../src/target-names.js";

const fake = vi.hoisted(() => ({
  messages: [] as OcgMessage[],
  buffers: [] as Uint8Array[],
  destroyNote: "",
  hintLabels: new Map<bigint, string>(),
  queries: new Map<string, Array<{ code: number; position: OcgPosition; isPublic?: boolean; isHidden?: boolean }>>(),
  targetNotes: [] as string[],
  locationQueries: [] as string[],
  onProcess: undefined as (() => boolean) | undefined,
  report: (_type: number, _text: string) => undefined,
}));

// Replace only the native core/resources; process messages and filter each viewer's log in the real engine.
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async () => ({
    createDuel: (options: { errorHandler: typeof fake.report }) => { fake.report = options.errorHandler; return {}; },
    destroyDuel: () => undefined, startDuel: () => undefined,
    duelNewCard: () => undefined, loadScript: () => true,
    duelProcess: () => {
      const continuing = fake.onProcess?.();
      if (fake.destroyNote) fake.report(0, fake.destroyNote);
      for (const note of fake.targetNotes) fake.report(0, note);
      return continuing ? actual.OcgProcessResult.CONTINUE : actual.OcgProcessResult.WAITING;
    },
    duelGetMessage: () => fake.messages,
    duelQueryField: () => ({ players: [{ deck_size: 0 }, { deck_size: 0 }], chain: [] }),
    duelQueryLocation: (_handle: unknown, query: { controller: number; location: number }) => {
      const key = `${query.controller}:${query.location}`;
      fake.locationQueries.push(key);
      return fake.queries.get(key) ?? [];
    },
    duelQueryCount: () => 0,
  }) };
});
vi.mock("../src/cards.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cards.js")>(),
  loadCardDatabase: () => ({
    readScript: () => "-- test resource", cardData: () => null,
    get: (code: number) => [1, 2, 70781052].includes(code) ? ({ code, name: code === 1 ? "Dark Magician" : code === 70781052 ? "Summoned Skull" : "Mirror Force", type: 1 }) : undefined,
    resolveLabel: (hint: bigint) => fake.hintLabels.get(hint) ?? "", system: () => undefined,
  }),
}));
vi.mock("../src/multi-scripts.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/multi-scripts.js")>(), loadMultiScriptsFor: () => undefined,
}));
vi.mock("../src/raw-messages.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/raw-messages.js")>(),
  rawMessageCapture: () => ({ take: () => fake.buffers.splice(0) }),
}));

beforeEach(() => { fake.messages = []; fake.buffers = []; fake.destroyNote = ""; fake.hintLabels.clear(); fake.queries.clear(); fake.targetNotes = []; fake.locationQueries = []; fake.onProcess = undefined; });

registerDomainCoreFactory(async (ctx) => {
  const lib = await ctx.createStockCore({ sync: true });
  const handle = lib.createDuel(ctx);
  if (!handle) throw new Error("Failed to create mock Domain duel");
  return { lib, handle, getDomainState: () => ctx.decks.map((deck) => ({ code: deck.deckMaster!, inZone: true, returns: 0, nextCost: 0 })) };
});

const place = (controller: number, location: OcgLocation = OcgLocation.MZONE, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({
  controller, location, sequence: 0, position,
});
const chain = (controller: number, chain_size: number, code = 1) => ({
  type: OcgMessageType.CHAINING, code, ...place(controller), description: 0n, chain_size,
  triggering_controller: controller, triggering_location: OcgLocation.MZONE, triggering_sequence: 0,
} as OcgMessage);

async function open(format: DuelFormat, messages: OcgMessage[], create = createEngineGame, options: Partial<EngineGameOptions> = {}): Promise<EngineGame> {
  fake.messages = [...messages, {
    type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], special_summons: [], pos_changes: [],
    monster_sets: [], spell_sets: [], activates: [], to_bp: false, to_ep: true, shuffle: false,
  }];
  return create({
    format, mode: "normal", decks: Array.from({ length: seatCountFor(format) }, () => ({ main: [], extra: [], side: [] })),
    dataDirectory: "/tmp/text-log-no-engine-resources", seed: ["1", "2", "3", "4"],
    standardWasmBinary: new ArrayBuffer(0), multiWasmBinary: new ArrayBuffer(0),
    ...options,
  });
}

const log = (game: EngineGame, viewer: number | null) => game.view(viewer).log.map((entry) => entry.text);

describe.each<DuelFormat>(["ffa3", "ffa4", "tag"])("%s direct attack log", (format) => {
  const actor = seatCountFor(format) - 1;

  it.each([0, 0xff])("keeps the attacker and a valid defender when MSG_ATTACK_DUELIST names seat %i", async (defender) => {
    // Two decoded attacks, followed by the wrapper-dropped defender of the second one.
    fake.buffers = [new Uint8Array([
      1, 0, 0, 0, OcgMessageType.ATTACK,
      1, 0, 0, 0, OcgMessageType.ATTACK,
      2, 0, 0, 0, MSG_ATTACK_DUELIST, defender,
    ])];
    const game = await open(format, [
      { type: OcgMessageType.ATTACK, card: place(1), target: null } as OcgMessage,
      { type: OcgMessageType.ATTACK, card: place(actor), target: null } as OcgMessage,
    ]);
    try {
      for (const viewer of [...Array.from({ length: seatCountFor(format) }, (_, seat) => seat), null]) {
        expect(log(game, viewer)).toEqual(defender === 0xff ? [
          "Player 2 declares a direct attack", `Player ${actor + 1} declares a direct attack`,
        ] : [
          "Player 2 declares a direct attack", `Player ${actor + 1} attacks Player 1 directly`, "Player 1 is attacked directly",
        ]);
      }
    } finally { game.close(); }
  });
});

describe.each<DuelFormat>(["1v1", "ffa3", "ffa4", "tag"])("%s Text log player labels", (format) => {
  const seats = Array.from({ length: seatCountFor(format) }, (_, seat) => seat);
  const viewers = [...seats, null];
  const actor = seats.at(-1)!;

  it("names activating players and the negated link's player rather than the latest link", async () => {
    const game = await open(format, [chain(actor, 1), chain(0, 2, 2), { type: OcgMessageType.CHAIN_NEGATED, chain_size: 1 }]);
    try {
      for (const viewer of viewers) expect(log(game, viewer)).toEqual([
        `Player ${actor + 1}'s Dark Magician is activating`,
        "Player 1's Mirror Force is activating",
        `Player ${actor + 1}'s chain link was negated`,
      ]);
    } finally { game.close(); }
  });

  it.each([true, false])("names the attacking monster's controller (direct: %s)", async (direct) => {
    const game = await open(format, [{ type: OcgMessageType.ATTACK, card: place(actor), target: direct ? null : place(0) } as OcgMessage]);
    try {
      for (const viewer of viewers) expect(log(game, viewer)).toEqual([`Player ${actor + 1} declares ${direct ? "a direct attack" : "an attack"}`]);
    } finally { game.close(); }
  });

  it("labels a privately confirmed card's controller and keeps the recipient-only audience", async () => {
    const game = await open(format, [{
      type: OcgMessageType.CONFIRM_CARDS, player: 0,
      cards: [{ code: 1, ...place(actor, OcgLocation.HAND, OcgPosition.FACEDOWN_DEFENSE) }],
    } as OcgMessage]);
    try {
      expect(log(game, 0)).toEqual([`Confirmed Player ${actor + 1}'s Dark Magician`]);
      for (const viewer of viewers.filter((seat) => seat !== 0)) expect(log(game, viewer)).toEqual([]);
    } finally { game.close(); }
  });

  it("keeps a search confirmation public and labels the card owner, rather than its recipient", async () => {
    const to = place(actor, OcgLocation.HAND);
    const game = await open(format, [
      { type: OcgMessageType.MOVE, card: 1, from: place(actor, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE), to, reason: 0 } as OcgMessage,
      { type: OcgMessageType.CONFIRM_CARDS, player: 0, cards: [{ code: 1, ...to }] } as OcgMessage,
    ]);
    try {
      for (const viewer of viewers) expect(log(game, viewer)).toContain(`Confirmed Player ${actor + 1}'s Dark Magician`);
    } finally { game.close(); }
  });

  it.each([OcgLocation.GRAVE, OcgLocation.REMOVED, OcgLocation.EXTRA])("retains the previous controller when destruction rewrites a move to %i", async (destination) => {
    fake.destroyNote = `${DESTROY_NOTE_PREFIX}${actor}:${OcgLocation.MZONE}:0`;
    const game = await open(format, [{
      type: OcgMessageType.MOVE, card: 1, from: place(actor), to: place(0, destination), reason: 0,
    } as OcgMessage]);
    try {
      for (const viewer of viewers) expect(log(game, viewer)).toEqual([
        `Player ${actor + 1}'s Dark Magician was destroyed${destination === OcgLocation.REMOVED ? " and banished" : ""}`,
      ]);
    } finally { game.close(); }
  });

  it("keeps a destroyed face-down card's identity hidden when returned to the Deck", async () => {
    fake.destroyNote = `${DESTROY_NOTE_PREFIX}${actor}:${OcgLocation.MZONE}:0`;
    const game = await open(format, [{
      type: OcgMessageType.MOVE, card: 1, from: place(actor, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE),
      to: place(0, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE), reason: 0,
    } as OcgMessage]);
    try {
      for (const viewer of viewers) expect(log(game, viewer)).toEqual([]);
    } finally { game.close(); }
  });
});

it.each([
  { engine: "pinned", create: createEngineGame }, { engine: "legacy", create: createLegacyEngineGame },
])("uses a generic card name in $engine public hint logs when only a private hint names the card", async ({ create }) => {
  fake.hintLabels.set(502n, "Choose an effect for [%ls].");
  const game = await open("1v1", [
    { type: OcgMessageType.HINT, hint_type: OcgHintType.CARD, player: 0, hint: 70781052n },
    { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 502n },
    { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 502n },
  ], create);
  try {
    for (const viewer of [0, 1, null]) expect(log(game, viewer)).toEqual([
      "Choose an effect for [a card].", "Choose an effect for [a card].",
    ]);
  } finally { game.close(); }
});

describe.each([
  { engine: "pinned", create: createEngineGame }, { engine: "legacy", create: createLegacyEngineGame },
])("$engine hint identity privacy", ({ create }) => {
  it.each([OcgHintType.EVENT, OcgHintType.MESSAGE])("redacts a direct card-name hint (%i), without relying on placeholders", async (hint_type) => {
    // CardDatabase.resolveLabel resolves a passcode straight to the card name.
    fake.hintLabels.set(70781052n, "Summoned Skull");
    const game = await open("1v1", [
      { type: OcgMessageType.SET, code: 70781052, ...place(0, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE) } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type, player: 0, hint: 70781052n },
    ], create);
    try {
      expect(log(game, 0)).toEqual(["Player 1 Sets a card", "Summoned Skull"]);
      for (const viewer of [1, null]) expect(log(game, viewer)).toEqual(["Player 1 Sets a card", "a card"]);
    } finally { game.close(); }
  });

  it("retains public names in direct hints and placeholders after a public summon", async () => {
    fake.hintLabels.set(70781052n, "Summoned Skull");
    fake.hintLabels.set(502n, "Choose an effect for [%ls].");
    const game = await open("1v1", [
      { type: OcgMessageType.SUMMONING, code: 70781052, ...place(0) } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type: OcgHintType.CARD, player: 0, hint: 70781052n },
      { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 70781052n },
      { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 502n },
    ], create);
    try {
      for (const viewer of [0, 1, null]) expect(log(game, viewer)).toEqual([
        "Player 1 Normal Summons Summoned Skull", "Summoned Skull", "Choose an effect for [Summoned Skull].",
      ]);
    } finally { game.close(); }
  });

  it.each([OcgLocation.HAND, OcgLocation.DECK, OcgLocation.EXTRA, OcgLocation.MZONE, OcgLocation.REMOVED])("redacts encoded card-string fallback names from hidden location %i", async (location) => {
    const hint = (70781052n << 20n) | 15n;
    fake.hintLabels.set(hint, "Summoned Skull");
    fake.queries.set(`0:${location}`, [{ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE }]);
    const game = await open("1v1", [{ type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint }], create);
    try {
      for (const viewer of [1, null]) expect(log(game, viewer)).toEqual(["a card"]);
      expect(log(game, 0)).toEqual([location === OcgLocation.DECK ? "a card" : "Summoned Skull"]);
      // A later reveal must not rewrite an earlier private hint for another viewer.
      fake.queries.set(`0:${location}`, [{ code: 70781052, position: OcgPosition.FACEUP_ATTACK, isPublic: true }]);
      for (const viewer of [1, null]) expect(log(game, viewer)).toEqual(["a card"]);
    } finally { game.close(); }
  });

  it("keeps a hint private to the confirmation recipient", async () => {
    fake.hintLabels.set(70781052n, "Summoned Skull");
    const game = await open("1v1", [
      { type: OcgMessageType.CONFIRM_CARDS, player: 1, cards: [{ code: 70781052, ...place(0, OcgLocation.DECK, OcgPosition.FACEDOWN_DEFENSE) }] } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 70781052n },
    ], create);
    try {
      expect(log(game, 1).at(-1)).toBe("Summoned Skull");
      for (const viewer of [0, null]) expect(log(game, viewer)).toEqual(["a card"]);
    } finally { game.close(); }
  });

  it("keeps chain sources public while redacting face-down target identities", async () => {
    fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:${OcgLocation.MZONE}:0:70781052:${OcgPosition.FACEDOWN_DEFENSE}`];
    const game = await open("1v1", [chain(1, 1, 2), { type: OcgMessageType.BECOME_TARGET, cards: [place(0)] } as OcgMessage], create);
    try {
      for (const viewer of [0, 1, null]) {
        expect(log(game, viewer)).toContain("Chain Link 1: Mirror Force targets a face-down card");
        expect(log(game, viewer).join(" ")).not.toContain("Summoned Skull");
      }
    } finally { game.close(); }
  });

  it("does not trust a face-up target note over the hidden MZONE 5 view", async () => {
    fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:${OcgLocation.MZONE}:5:70781052:${OcgPosition.FACEUP_ATTACK}`];
    fake.queries.set(`0:${OcgLocation.MZONE}`, Array.from({ length: 6 }, (_, sequence) => ({
      code: sequence === 5 ? 70781052 : 0,
      position: OcgPosition.FACEDOWN_DEFENSE,
    })));
    const game = await open("1v1", [chain(0, 1, 2), {
      type: OcgMessageType.BECOME_TARGET, cards: [{ ...place(0), sequence: 5 }],
    } as OcgMessage], create);
    try {
      expect(game.view(0).seats[0]!.monsters[5]!.name).toBe("Summoned Skull");
      for (const viewer of [1, null]) {
        const view = game.view(viewer);
        expect(view.seats[0]!.monsters[5]!.code).toBeUndefined();
        expect(log(game, viewer).join(" ")).not.toContain("Summoned Skull");
        const target = view.events.find((event) => event.kind === "target");
        expect(target?.text).not.toContain("Summoned Skull");
        expect(target?.targetLabels?.join(" ")).not.toContain("Summoned Skull");
      }
      expect(log(game, 0)).toContain("Chain Link 1: Mirror Force targets Summoned Skull");
      expect(game.view(0).events.find((event) => event.kind === "target")?.targetLabels).toEqual(["Summoned Skull"]);
    } finally { game.close(); }
  });

  it("keeps a late target note private after a subsequent public reveal", async () => {
    fake.queries.set(`0:${OcgLocation.MZONE}`, [{ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE }]);
    let process = 0;
    fake.onProcess = () => {
      if (process++ === 0) return true;
      fake.messages = [fake.messages.at(-1)!];
      fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:4:0:70781052:1`];
      fake.queries.set(`0:${OcgLocation.MZONE}`, [{ code: 70781052, position: OcgPosition.FACEUP_ATTACK }]);
      return false;
    };
    const game = await open("1v1", [chain(0, 1, 2), { type: OcgMessageType.BECOME_TARGET, cards: [place(0)] } as OcgMessage], create);
    try {
      for (const viewer of [1, null]) {
        expect(log(game, viewer)).toContain("Chain Link 1: Mirror Force targets a card");
        expect(game.view(viewer).events.find((event) => event.kind === "target")).toMatchObject({
          text: "Chain Link 1 targets a card", targetLabels: ["a card"],
        });
      }
      expect(log(game, 0)).toContain("Chain Link 1: Mirror Force targets Summoned Skull");
      expect(game.view(0).events.find((event) => event.kind === "target")).toMatchObject({
        text: "Chain Link 1 targets Summoned Skull", targetLabels: ["Summoned Skull"],
      });
    } finally { game.close(); }
  });

  it("retains a genuinely public Extra Monster Zone target's name", async () => {
    fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:4:5:70781052:1`];
    fake.queries.set(`0:${OcgLocation.MZONE}`, Array.from({ length: 6 }, (_, sequence) => ({
      code: sequence === 5 ? 70781052 : 0, position: OcgPosition.FACEUP_ATTACK,
    })));
    const game = await open("1v1", [chain(0, 1, 2), {
      type: OcgMessageType.BECOME_TARGET, cards: [{ ...place(0), sequence: 5 }],
    } as OcgMessage], create);
    try {
      for (const viewer of [0, 1, null]) {
        expect(log(game, viewer)).toContain("Chain Link 1: Mirror Force targets Summoned Skull");
        expect(game.view(viewer).events.find((event) => event.kind === "target")).toMatchObject({
          text: "Chain Link 1 targets Summoned Skull", targetLabels: ["Summoned Skull"],
        });
      }
    } finally { game.close(); }
  });

  it("filters replay history before projection without changing any retained audience", async () => {
    fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:4:0:70781052:1`];
    fake.queries.set(`0:${OcgLocation.MZONE}`, [{ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE }]);
    const game = await open("1v1", [chain(0, 1, 2), { type: OcgMessageType.BECOME_TARGET, cards: [place(0)] } as OcgMessage], create);
    try {
      for (const viewer of [0, 1, null]) {
        const full = game.view(viewer);
        const logAfter = full.log[0]!.id, eventsAfter = full.events[0]!.id;
        expect(game.view(viewer, { logAfter, eventsAfter })).toEqual({ ...full,
          log: full.log.filter((entry) => entry.id > logAfter), events: full.events.filter((entry) => entry.id > eventsAfter),
        });
        expect(game.view(viewer)).toEqual(full);
        expect(game.view(viewer, { logAfter: Number.MAX_SAFE_INTEGER, eventsAfter: Number.MAX_SAFE_INTEGER }))
          .toEqual({ ...full, log: [], events: [] });
      }
    } finally { game.close(); }
  });

  it("queries each target location once per core process, then refreshes its visibility", async () => {
    const key = `0:${OcgLocation.MZONE}`;
    const targets = [0, 1, 5].map((sequence) => ({ ...place(0), sequence }));
    fake.queries.set(key, Array.from({ length: 6 }, () => ({ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE })));
    fake.targetNotes = targets.map(({ sequence }) => `${TARGET_CARD_NOTE_PREFIX}0:4:${sequence}:70781052:1`);
    let processCount = 0;
    fake.onProcess = () => {
      if (processCount++ === 0) return true;
      fake.queries.set(key, Array.from({ length: 6 }, () => ({ code: 70781052, position: OcgPosition.FACEUP_ATTACK })));
      fake.messages = [chain(0, 2, 2), { type: OcgMessageType.BECOME_TARGET, cards: targets } as OcgMessage, fake.messages.at(-1)!];
      return false;
    };
    const game = await open("1v1", [chain(0, 1, 2), ...targets.map((target) => ({
      type: OcgMessageType.BECOME_TARGET, cards: [target],
    }) as OcgMessage)], create);
    try {
      // Three announcements in process 1, three targets in process 2: two full-zone reads, not six.
      expect(fake.locationQueries.filter((query) => query === key)).toHaveLength(2);
      const events = game.view(null).events.filter((event) => event.kind === "target");
      expect(events[0]!.text).toBe("Chain Link 1 targets a card");
      expect(events.at(-1)!.targetLabels).toEqual(Array(3).fill("Summoned Skull"));
      expect(game.view(0).events.filter((event) => event.kind === "target")[0]!.targetLabels).toEqual(["Summoned Skull"]);
    } finally { game.close(); }
  });

  it("names an explicitly announced hand activation in later hints", async () => {
    fake.hintLabels.set(70781052n, "Summoned Skull");
    const game = await open("1v1", [
      { ...chain(0, 1, 70781052), ...place(0, OcgLocation.HAND, OcgPosition.FACEDOWN_DEFENSE) } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 70781052n },
    ], create);
    try {
      for (const viewer of [0, 1, null]) expect(log(game, viewer).at(-1)).toBe("Summoned Skull");
    } finally { game.close(); }
  });

  it("does not let an unknown summon or position make a hint public", async () => {
    fake.hintLabels.set(70781052n, "Summoned Skull");
    const game = await open("1v1", [
      { type: OcgMessageType.SPSUMMONING, code: 70781052, ...place(0, OcgLocation.MZONE, 0 as OcgPosition) } as OcgMessage,
      { type: OcgMessageType.POS_CHANGE, code: 70781052, prev_position: 0 as OcgPosition, ...place(0, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE) } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 70781052n },
    ], create);
    try {
      for (const viewer of [1, null]) {
        expect(log(game, viewer)).toEqual(["Player 1 Special Summons a monster", "a card"]);
        expect(game.view(viewer).events.every((event) => !event.card)).toBe(true);
      }
      expect(log(game, 0).at(-1)).toBe("Summoned Skull");
    } finally { game.close(); }
  });

  it("keeps a hidden control transfer known to both players but hidden from spectators", async () => {
    fake.hintLabels.set(70781052n, "Summoned Skull");
    const game = await open("1v1", [
      { type: OcgMessageType.MOVE, card: 70781052,
        from: place(0, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE),
        to: place(1, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE), reason: 0 } as OcgMessage,
      { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 70781052n },
    ], create);
    try {
      for (const viewer of [0, 1]) expect(log(game, viewer)).toEqual(["Summoned Skull"]);
      expect(log(game, null)).toEqual(["a card"]);
    } finally { game.close(); }
  });
});

it.each([false, true])("uses live hand visibility for hints (public: %s)", async (isPublic) => {
  fake.hintLabels.set(70781052n, "Summoned Skull");
  fake.queries.set(`0:${OcgLocation.HAND}`, [{ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE, isPublic }]);
  const game = await open("1v1", [{ type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 70781052n }]);
  try {
    expect(log(game, 0)).toEqual(["Summoned Skull"]);
    for (const viewer of [1, null]) expect(log(game, viewer)).toEqual([isPublic ? "Summoned Skull" : "a card"]);
  } finally { game.close(); }
});

it("gives Tag partners visible hand hint names without revealing the private Extra Deck", async () => {
  fake.hintLabels.set(70781052n, "Summoned Skull");
  fake.hintLabels.set(1n, "Dark Magician");
  fake.queries.set(`0:${OcgLocation.HAND}`, [{ code: 70781052, position: OcgPosition.FACEDOWN_DEFENSE }]);
  fake.queries.set(`0:${OcgLocation.EXTRA}`, [{ code: 1, position: OcgPosition.FACEDOWN_DEFENSE }]);
  const game = await open("tag", [
    { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 70781052n },
    { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 1n },
  ]);
  try {
    expect(log(game, 0)).toEqual(["Summoned Skull", "Dark Magician"]);
    expect(log(game, 2)).toEqual(["Summoned Skull", "a card"]);
    for (const viewer of [1, 3, null]) expect(log(game, viewer)).toEqual(["a card", "a card"]);
  } finally { game.close(); }
});

it("names public Domain Deck Masters without exposing unrelated hidden cards", async () => {
  fake.hintLabels.set(1n, "Dark Magician");
  fake.hintLabels.set(70781052n, "Summoned Skull");
  const game = await open("1v1", [
    { type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: 1n },
    { type: OcgMessageType.MOVE, card: 1, from: place(0, 0 as OcgLocation), to: place(0, OcgLocation.HAND), reason: 0 } as OcgMessage,
    { type: OcgMessageType.SET, code: 70781052, ...place(0, OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE) } as OcgMessage,
    { type: OcgMessageType.HINT, hint_type: OcgHintType.MESSAGE, player: 0, hint: 70781052n },
  ], createEngineGame, { mode: "domain", decks: [1, 2].map((deckMaster) => ({ main: [], extra: [], side: [], deckMaster })) });
  try {
    for (const viewer of [1, null]) expect(log(game, viewer)).toEqual([
      "Dark Magician", "Dark Magician was added to Player 1's hand", "Player 1 Sets a card", "a card",
    ]);
    expect(log(game, 0).at(-1)).toBe("Summoned Skull");
  } finally { game.close(); }
});

it("keeps a hidden Domain MR5 MZONE 5 target distinct from the public Deck Masters", async () => {
  fake.targetNotes = [`${TARGET_CARD_NOTE_PREFIX}0:4:5:70781052:1`];
  fake.queries.set(`0:${OcgLocation.MZONE}`, Array.from({ length: 6 }, (_, sequence) => ({
    code: sequence === 5 ? 70781052 : 0, position: OcgPosition.FACEDOWN_DEFENSE,
  })));
  const game = await open("1v1", [chain(0, 1, 2), {
    type: OcgMessageType.BECOME_TARGET, cards: [{ ...place(0), sequence: 5 }],
  } as OcgMessage], createEngineGame, {
    mode: "domain", masterRule: 5,
    decks: [1, 2].map((deckMaster) => ({ main: [], extra: [], side: [], deckMaster })),
  });
  try {
    for (const viewer of [1, null]) {
      const view = game.view(viewer);
      expect(view.seats.map((seat) => seat.deckMaster?.card.code)).toEqual([1, 2]);
      expect(view.seats[0]!.monsters[5]!.code).toBeUndefined();
      expect(log(game, viewer)).toContain("Chain Link 1: Mirror Force targets a card");
      expect(view.events.find((event) => event.kind === "target")).toMatchObject({
        text: "Chain Link 1 targets a card", targetLabels: ["a card"],
      });
    }
    expect(log(game, 0)).toContain("Chain Link 1: Mirror Force targets Summoned Skull");
  } finally { game.close(); }
});
