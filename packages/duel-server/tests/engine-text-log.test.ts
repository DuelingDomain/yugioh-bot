import { beforeEach, describe, expect, it, vi } from "vitest";
import { seatCountFor, type DuelFormat } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { DESTROY_NOTE_PREFIX } from "../src/views.js";
import { MSG_ATTACK_DUELIST } from "../src/raw-messages.js";

const fake = vi.hoisted(() => ({
  messages: [] as OcgMessage[],
  buffers: [] as Uint8Array[],
  destroyNote: "",
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
      if (fake.destroyNote) fake.report(0, fake.destroyNote);
      return actual.OcgProcessResult.WAITING;
    },
    duelGetMessage: () => fake.messages,
    duelQueryField: () => ({ players: [{ deck_size: 0 }, { deck_size: 0 }], chain: [] }),
    duelQueryLocation: () => [], duelQueryCount: () => 0,
  }) };
});
vi.mock("../src/cards.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/cards.js")>(),
  loadCardDatabase: () => ({
    readScript: () => "-- test resource", cardData: () => null,
    get: (code: number) => ({ code, name: code === 1 ? "Dark Magician" : "Mirror Force", type: 1 }),
    resolveLabel: () => "", system: () => undefined,
  }),
}));
vi.mock("../src/multi-scripts.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/multi-scripts.js")>(), loadMultiScriptsFor: () => undefined,
}));
vi.mock("../src/raw-messages.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/raw-messages.js")>(),
  rawMessageCapture: () => ({ take: () => fake.buffers.splice(0) }),
}));

beforeEach(() => { fake.messages = []; fake.buffers = []; fake.destroyNote = ""; });

const place = (controller: number, location: OcgLocation = OcgLocation.MZONE, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({
  controller, location, sequence: 0, position,
});
const chain = (controller: number, chain_size: number, code = 1) => ({
  type: OcgMessageType.CHAINING, code, ...place(controller), description: 0n, chain_size,
  triggering_controller: controller, triggering_location: OcgLocation.MZONE, triggering_sequence: 0,
} as OcgMessage);

async function open(format: DuelFormat, messages: OcgMessage[]): Promise<EngineGame> {
  fake.messages = [...messages, {
    type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], special_summons: [], pos_changes: [],
    monster_sets: [], spell_sets: [], activates: [], to_bp: false, to_ep: true, shuffle: false,
  }];
  return createEngineGame({
    format, mode: "normal", decks: Array.from({ length: seatCountFor(format) }, () => ({ main: [], extra: [], side: [] })),
    dataDirectory: "/tmp/text-log-no-engine-resources", seed: ["1", "2", "3", "4"],
    standardWasmBinary: new ArrayBuffer(0), multiWasmBinary: new ArrayBuffer(0),
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
