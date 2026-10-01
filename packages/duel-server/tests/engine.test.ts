import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelCard, DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";
import {
  OcgAttribute,
  OcgEffectClientMode,
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgPosition,
  OcgRace,
  OcgResponseType,
  OcgType,
  type OcgAttribute as OcgAttributeValue,
  type OcgCardData,
  type OcgHintTiming,
  type OcgMessage,
  type OcgRace as OcgRaceValue,
} from "ocgcore-wasm";
import { isOptionalCardScript, type CardDatabase } from "../src/cards.js";
import { EngineAnswerError, autoResponse, mapPrompt, parseFieldPlaces, recallPromptContext, resolveAnswer } from "../src/prompts.js";
import {
  DOMAIN_LEAVE_TAX_STEP,
  cardIsVisible,
  clearRevealsAt,
  createRevealMap,
  moveReveals,
  noteReveal,
  observeDuelEvent,
  projectStoredEvent,
  projectView,
  redactCard,
  slotRevealed,
  type RevealMap,
  type StoredChainLink,
} from "../src/views.js";
import { createEngineGame, parseSeed } from "../src/engine.js";
import { engineDataDirectory } from "./engine-data-dir.js";
function info(code: number, name = `Card ${code}`): DuelCardInfo {
  return { code, name, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "warrior" };
}

const cards: CardDatabase = {
  search: () => [],
  deckCard: () => undefined,
  all: () => [],
  setnames: () => new Map(),
  get: (code) => info(code),
  cardData: (code): OcgCardData | null => ({
    code,
    alias: 0,
    setcodes: [],
    type: 1,
    level: 4,
    attribute: 1,
    race: 1n,
    attack: 1000,
    defense: 1000,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  }),
  resolveLabel: () => "",
  system: () => undefined,
  victory: () => undefined,
  counter: () => undefined,
  readScript: () => null,
  close() {},
};

function idleMessage(): OcgMessage {
  return {
    type: OcgMessageType.SELECT_IDLECMD,
    player: 0,
    summons: [{ code: 89631139, controller: 0, location: OcgLocation.HAND, sequence: 0 }],
    special_summons: [],
    pos_changes: [],
    monster_sets: [],
    spell_sets: [],
    activates: [],
    to_bp: true,
    to_ep: true,
    shuffle: false,
  };
}

describe("engine answers", () => {
  it("restores the in-zone Master location without changing native action indexes or other locations", () => {
    const message = idleMessage();
    if (message.type !== OcgMessageType.SELECT_IDLECMD) throw new Error("Expected idle command");
    message.summons = [
      { code: 89631139, controller: 0, location: 0 as OcgLocation, sequence: 0 },
      { code: 89631139, controller: 0, location: OcgLocation.HAND, sequence: 0 },
      { code: 123, controller: 0, location: 0 as OcgLocation, sequence: 0 },
    ];
    const domain = [{ code: 89631139, inZone: true, returns: 0, nextCost: 0 }];
    const pending = mapPrompt(message, cards, "master", undefined, { domain });
    expect(pending.prompt.options.filter((option) => option.id.startsWith("summon:")).map((option) => option.location))
      .toEqual([0x4000, OcgLocation.HAND, 0]);
    expect(resolveAnswer(pending, 0, "master", { choice: "summon:0" }, cards))
      .toMatchObject({ action: 0, index: 0 });
    expect(mapPrompt(message, cards, "normal").prompt.options[0].location).toBe(0);
    domain[0].inZone = false;
    expect(mapPrompt(message, cards, "left", undefined, { domain }).prompt.options[0].location).toBe(0);
  });

  it("rejects the wrong seat", () => {
    const pending = mapPrompt(idleMessage(), cards, "p0-1");
    expect(() => resolveAnswer(pending, 1, "p0-1", { choice: "to_ep" }, cards)).toThrow(EngineAnswerError);
    try {
      resolveAnswer(pending, 1, "p0-1", { choice: "to_ep" }, cards);
    } catch (error) {
      expect((error as Error).message).toBe("Wrong seat");
    }
  });

  it("rejects a stale prompt id", () => {
    const pending = mapPrompt(idleMessage(), cards, "p0-1");
    expect(() => resolveAnswer(pending, 0, "p0-99", { choice: "to_ep" }, cards)).toThrow(/Stale prompt/);
  });

  it("rejects an invalid idle choice", () => {
    const pending = mapPrompt(idleMessage(), cards, "p0-1");
    expect(() => resolveAnswer(pending, 0, "p0-1", { choice: "attack:0" }, cards)).toThrow(/Invalid answer/);
  });

  it("rejects selecting too many cards", () => {
    const pending = mapPrompt(
      {
        type: OcgMessageType.SELECT_CARD,
        player: 0,
        can_cancel: false,
        min: 1,
        max: 1,
        selects: [
          { code: 1, controller: 0, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
          { code: 2, controller: 0, location: OcgLocation.HAND, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
        ],
      },
      cards,
      "p0-2",
    );
    expect(() => resolveAnswer(pending, 0, "p0-2", { selected: ["card:0", "card:1"] }, cards)).toThrow(/Invalid answer/);
  });

  it("accepts a legal end-phase choice", () => {
    const pending = mapPrompt(idleMessage(), cards, "p0-1");
    const response = resolveAnswer(pending, 0, "p0-1", { choice: "to_ep" }, cards);
    expect(response.type).toBe(OcgResponseType.SELECT_IDLECMD);
  });
});

describe("hidden state", () => {
  const facedown: DuelCard = {
    controller: 1,
    location: OcgLocation.MZONE,
    sequence: 2,
    position: OcgPosition.FACEDOWN_DEFENSE,
    code: 89631139,
    name: "Blue-Eyes White Dragon",
    attack: 3000,
    defense: 2500,
    level: 8,
    type: 1,
    attribute: 16,
    race: "Dragon",
  };

  it("strips opponent facedown field identity and stats", () => {
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.MZONE, position: OcgPosition.FACEDOWN_DEFENSE })).toBe(false);
    const hidden = redactCard(facedown, false);
    expect(hidden.code).toBeUndefined();
    expect(hidden.name).toBeUndefined();
    expect(hidden.attack).toBeUndefined();
    expect(hidden.defense).toBeUndefined();
    expect(hidden.level).toBeUndefined();
    expect(hidden.attribute).toBeUndefined();
    expect(hidden.race).toBeUndefined();
    expect(hidden.controller).toBe(1);
    expect(hidden.position).toBe(OcgPosition.FACEDOWN_DEFENSE);
  });

  it("keeps own hand identities and hides the opponent hand", () => {
    expect(cardIsVisible({ viewer: 0, controller: 0, location: OcgLocation.HAND, position: OcgPosition.FACEUP_ATTACK })).toBe(true);
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.HAND, position: OcgPosition.FACEUP_ATTACK })).toBe(false);
    expect(cardIsVisible({ viewer: null, controller: 0, location: OcgLocation.HAND, position: OcgPosition.FACEUP_ATTACK })).toBe(false);
  });

  it("hides decks, opponent extra, and facedown banish", () => {
    expect(cardIsVisible({ viewer: 0, controller: 0, location: OcgLocation.DECK, position: OcgPosition.FACEDOWN_DEFENSE })).toBe(false);
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.EXTRA, position: OcgPosition.FACEDOWN_DEFENSE, isHidden: true })).toBe(false);
    expect(cardIsVisible({ viewer: 0, controller: 0, location: OcgLocation.EXTRA, position: OcgPosition.FACEDOWN_DEFENSE, isHidden: true })).toBe(true);
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.REMOVED, position: OcgPosition.FACEDOWN_DEFENSE })).toBe(false);
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.REMOVED, position: OcgPosition.FACEUP_ATTACK })).toBe(true);
  });

  it("does not expose revealed private cards to spectators", () => {
    expect(cardIsVisible({ viewer: null, controller: 1, location: OcgLocation.HAND, position: OcgPosition.FACEUP_ATTACK, revealed: false })).toBe(false);
    expect(cardIsVisible({ viewer: 0, controller: 1, location: OcgLocation.HAND, position: OcgPosition.FACEUP_ATTACK, revealed: true })).toBe(true);
  });
});

describe("live race projection", () => {
  it("uses queried engine race, stays JSON-serializable, and redacts it when hidden", () => {
    const vacant = { position: 0, materials: 0 };
    const player = {
      monsters: [vacant, vacant, vacant, vacant, vacant, vacant, vacant],
      spells: [vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant],
      deck_size: 0,
      hand_size: 0,
      grave_size: 0,
      banish_size: 0,
      extra_size: 0,
      extra_faceup_count: 0,
    };
    const query = {
      code: 1,
      position: OcgPosition.FACEUP_ATTACK,
      race: OcgRace.DRAGON,
      attribute: 16,
      attack: 3000,
      defense: 2500,
      level: 8,
    };
    const project = (viewer: number | null, position: number) =>
      projectView({
        lib: {
          duelQueryField: () => ({ flags: 0n, players: [player, player], chain: [] }),
          duelQueryLocation: (_handle: unknown, loc: { controller: number; location: number }) =>
            loc.controller === 0 && loc.location === OcgLocation.MZONE ? [{ ...query, position }] : [],
        } as never,
        handle: {} as never,
        cards,
        viewer,
        revision: 1,
        turn: 1,
        turnSeat: 0,
        phase: "main1",
        lp: [8000, 8000],
        prompt: null,
        promptSeat: null,
        log: [],
        events: [],
        result: null,
        reveals: createRevealMap(),
        mode: "normal",
      });
    const shown = project(0, OcgPosition.FACEUP_ATTACK).seats[0].monsters[0];
    expect(shown?.race).toBe("dragon");
    expect(shown?.race).not.toBe(info(1).race);
    expect(JSON.parse(JSON.stringify(shown)).race).toBe("dragon");
    const hidden = project(1, OcgPosition.FACEDOWN_DEFENSE).seats[0].monsters[0];
    expect(hidden?.race).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toMatch(/dragon/i);
  });
});

describe("place flags", () => {
  it("maps low bits to the answering player", () => {
    const places = parseFieldPlaces(0x00000001, 1);
    expect(places.some((place) => place.player === 1 && place.location === OcgLocation.MZONE && place.sequence === 0)).toBe(false);
    expect(places.some((place) => place.player === 1 && place.location === OcgLocation.MZONE && place.sequence === 1)).toBe(true);
    expect(places.some((place) => place.player === 0 && place.location === OcgLocation.MZONE && place.sequence === 0)).toBe(true);
  });
});

describe("temporary reveals", () => {
  it("expires a reveal when the card leaves the slot and ignores a different code", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 0, 1, OcgLocation.HAND, 0, 123);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.HAND, 0, 123)).toBe(true);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.HAND, 0, 999)).toBe(false);
    expect(slotRevealed(reveals, null, 1, OcgLocation.HAND, 0, 123)).toBe(false);
    moveReveals(reveals, { controller: 1, location: OcgLocation.HAND, sequence: 0 }, { controller: 1, location: OcgLocation.GRAVE, sequence: 0 }, 123);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.HAND, 0, 123)).toBe(false);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.GRAVE, 0, 123)).toBe(true);
    clearRevealsAt(reveals, 1, OcgLocation.GRAVE);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.GRAVE, 0, 123)).toBe(false);
  });

  it("forgets a reveal when the card returns to the deck", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 0, 1, OcgLocation.HAND, 2, 555);
    moveReveals(reveals, { controller: 1, location: OcgLocation.HAND, sequence: 2 }, { controller: 1, location: OcgLocation.DECK, sequence: 0 }, 555);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.HAND, 2, 555)).toBe(false);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.DECK, 0, 555)).toBe(false);
  });

  it("forgets a hand reveal when the card is Set face-down, and keeps a face-up move", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 0, 1, OcgLocation.HAND, 0, 777);
    moveReveals(reveals, { controller: 1, location: OcgLocation.HAND, sequence: 0 }, { controller: 1, location: OcgLocation.SZONE, sequence: 2, position: 0x8 }, 777);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.SZONE, 2, 777)).toBe(false);
    noteReveal(reveals, 0, 1, OcgLocation.HAND, 1, 888);
    moveReveals(reveals, { controller: 1, location: OcgLocation.HAND, sequence: 1 }, { controller: 1, location: OcgLocation.MZONE, sequence: 0, position: 0x1 }, 888);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.MZONE, 0, 888)).toBe(true);
    noteReveal(reveals, 0, 1, OcgLocation.SZONE, 3, 999);
    moveReveals(reveals, { controller: 1, location: OcgLocation.SZONE, sequence: 3 }, { controller: 1, location: OcgLocation.SZONE, sequence: 4, position: 0x8 }, 999);
    expect(slotRevealed(reveals, 0, 1, OcgLocation.SZONE, 4, 999)).toBe(true);
  });
});

describe("forced choices", () => {
  it("does not autopick idle, battle, yes/no, announce, or RPS", () => {
    expect(autoResponse(mapPrompt(idleMessage(), cards, "p0-1"))).toBeNull();
    expect(autoResponse(mapPrompt({ type: OcgMessageType.ROCK_PAPER_SCISSORS, player: 0 }, cards, "p0-2"))).toBeNull();
    expect(autoResponse(mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 1n }, cards, "p0-3"))).toBeNull();
  });
});

describe("quiet response windows", () => {
  function chainWindow(overrides: { spe_count?: number; forced?: boolean; selects?: number }): OcgMessage {
    const count = overrides.selects ?? 1;
    return {
      type: OcgMessageType.SELECT_CHAIN,
      player: 0,
      spe_count: overrides.spe_count ?? 0,
      forced: overrides.forced ?? false,
      hint_timing: 0 as OcgHintTiming,
      hint_timing_other: 0 as OcgHintTiming,
      selects: Array.from({ length: count }, (_, sequence) => ({
        code: 1,
        controller: 0,
        location: OcgLocation.SZONE,
        sequence,
        position: OcgPosition.FACEUP,
        description: 1n,
        client_mode: OcgEffectClientMode.NORMAL,
      })),
    };
  }
  const pass = { type: OcgResponseType.SELECT_CHAIN, index: null };

  it("keeps asking about every window unless the duel opted into quiet windows", () => {
    // Saved duels and engine callers without settings keep the old behaviour, so replays still line up.
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0 }), cards, "p0-1"))).toBeNull();
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0 }), cards, "p0-1"), { stopAtEveryWindow: true })).toBeNull();
  });

  it("passes a window when no listed card matches its timing", () => {
    // spe_count 0 is the core saying nothing here is a hinted or triggered response (the EDOPro client passes it too).
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0 }), cards, "p0-1"), { stopAtEveryWindow: false })).toEqual(pass);
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0, selects: 3 }), cards, "p0-2"), { stopAtEveryWindow: false })).toEqual(pass);
  });

  it("still asks when a card matches the timing (for example an ATK boost in the Damage Step)", () => {
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 1 }), cards, "p0-1"), { stopAtEveryWindow: false })).toBeNull();
  });

  it("never passes a mandatory effect", () => {
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0, forced: true, selects: 2 }), cards, "p0-1"), { stopAtEveryWindow: false })).toBeNull();
    expect(autoResponse(mapPrompt(chainWindow({ spe_count: 0, forced: true }), cards, "p0-1"), { stopAtEveryWindow: false })).toEqual({
      type: OcgResponseType.SELECT_CHAIN,
      index: 0,
    });
  });

  it("always passes an empty window", () => {
    expect(autoResponse(mapPrompt(chainWindow({ selects: 0 }), cards, "p0-1"))).toEqual(pass);
  });
});

describe("seed", () => {
  it("requires four nonzero decimal uint64 strings", () => {
    expect(() => parseSeed(["1", "2", "3"])).toThrow(/Seed/);
    expect(() => parseSeed(["1", "2", "3", "0"])).toThrow(/Seed/);
    expect(parseSeed(["1", "2", "3", "4"])).toEqual([1n, 2n, 3n, 4n]);
  });
});

describe("optional card scripts", () => {
  const data = (type: number) => (code: number): OcgCardData | null => ({
    code,
    alias: 0,
    setcodes: [],
    type,
    level: 4,
    attribute: 1,
    race: 1n,
    attack: 1000,
    defense: 1000,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  });

  it("treats c0.lua and vanilla TYPE_NORMAL monsters as optional", () => {
    expect(isOptionalCardScript("c0.lua", () => null)).toBe(true);
    expect(isOptionalCardScript("official/c1184620.lua", data(OcgType.MONSTER | OcgType.NORMAL))).toBe(true);
    expect(isOptionalCardScript("c2311603.lua", data(17))).toBe(true);
  });

  it("requires effect, pendulum, and non-card scripts", () => {
    expect(isOptionalCardScript("constant.lua", () => null)).toBe(false);
    expect(isOptionalCardScript("c123.lua", data(OcgType.MONSTER | OcgType.EFFECT))).toBe(false);
    expect(isOptionalCardScript("c456.lua", data(OcgType.SPELL | OcgType.NORMAL))).toBe(false);
    expect(isOptionalCardScript("c789.lua", data(OcgType.MONSTER | OcgType.NORMAL | OcgType.PENDULUM))).toBe(false);
  });
});

describe("prompt mapping", () => {
  it("maps multi-race and multi-attribute announces as cards selections", () => {
    const race = mapPrompt(
      {
        type: OcgMessageType.ANNOUNCE_RACE,
        player: 0,
        count: 2,
        available: (OcgRace.WARRIOR | OcgRace.SPELLCASTER | OcgRace.FAIRY) as OcgRaceValue,
      },
      cards,
      "p0-race",
    );
    expect(race.prompt.kind).toBe("cards");
    expect(race.prompt.min).toBe(2);
    expect(race.prompt.max).toBe(2);
    const raceAnswer = resolveAnswer(race, 0, "p0-race", { selected: ["race:1", "race:2"] }, cards);
    expect(raceAnswer).toEqual({ type: OcgResponseType.ANNOUNCE_RACE, races: [1n, 2n] });

    const attrib = mapPrompt(
      {
        type: OcgMessageType.ANNOUNCE_ATTRIB,
        player: 0,
        count: 2,
        available: (OcgAttribute.EARTH | OcgAttribute.WATER | OcgAttribute.FIRE) as OcgAttributeValue,
      },
      cards,
      "p0-attr",
    );
    expect(attrib.prompt.kind).toBe("cards");
    const attribAnswer = resolveAnswer(attrib, 0, "p0-attr", { selected: ["attr:1", "attr:2"] }, cards);
    expect(attribAnswer.type).toBe(OcgResponseType.ANNOUNCE_ATTRIB);
  });

  it("maps announce-number as a single choice using num ids", () => {
    const pending = mapPrompt(
      { type: OcgMessageType.ANNOUNCE_NUMBER, player: 0, options: [100n, 200n, 300n] },
      cards,
      "p0-num",
    );
    expect(pending.prompt.kind).toBe("choice");
    expect(pending.prompt.min).toBe(1);
    expect(pending.prompt.max).toBe(1);
    expect(pending.prompt.options.map((option) => option.id)).toEqual(["num:0", "num:1", "num:2"]);
    const response = resolveAnswer(pending, 0, "p0-num", { choice: "num:1" }, cards);
    expect(response).toEqual({ type: OcgResponseType.ANNOUNCE_NUMBER, value: 1 });
  });

  it("maps tribute min as weighted release and max as card count", () => {
    const pending = mapPrompt(
      {
        type: OcgMessageType.SELECT_TRIBUTE,
        player: 0,
        can_cancel: false,
        min: 2,
        max: 3,
        selects: [
          { code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, release_param: 1 },
          { code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, release_param: 2 },
          { code: 3, controller: 0, location: OcgLocation.MZONE, sequence: 2, release_param: 1 },
        ],
      },
      cards,
      "p0-tr",
    );
    expect(pending.prompt.kind).toBe("tribute");
    expect(pending.prompt.min).toBe(2);
    expect(pending.prompt.max).toBe(3);
    expect(pending.prompt.options.map((option) => option.values)).toEqual([[1], [2], [1]]);
    const response = resolveAnswer(pending, 0, "p0-tr", { selected: ["card:1"] }, cards);
    expect(response).toEqual({ type: OcgResponseType.SELECT_TRIBUTE, indicies: [1] });
  });

  it("accepts a double-tribute under max count and rejects extra cards", () => {
    const pending = mapPrompt(
      {
        type: OcgMessageType.SELECT_TRIBUTE,
        player: 0,
        can_cancel: false,
        min: 2,
        max: 2,
        selects: [
          { code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, release_param: 2 },
          { code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, release_param: 1 },
          { code: 3, controller: 0, location: OcgLocation.MZONE, sequence: 2, release_param: 1 },
          { code: 4, controller: 0, location: OcgLocation.MZONE, sequence: 3, release_param: 1 },
        ],
      },
      cards,
      "p0-tr-edge",
    );
    expect(pending.prompt.max).toBe(2);
    expect(resolveAnswer(pending, 0, "p0-tr-edge", { selected: ["card:0"] }, cards)).toEqual({
      type: OcgResponseType.SELECT_TRIBUTE,
      indicies: [0],
    });
    expect(resolveAnswer(pending, 0, "p0-tr-edge", { selected: ["card:0", "card:1"] }, cards)).toEqual({
      type: OcgResponseType.SELECT_TRIBUTE,
      indicies: [0, 1],
    });
    expect(() => resolveAnswer(pending, 0, "p0-tr-edge", { selected: ["card:1", "card:2", "card:3"] }, cards)).toThrow(/Invalid answer/);
  });

  it("accepts a packed SELECT_SUM alternative without adding high16 as a scalar", () => {
    const packed = 1 | (2 << 16);
    const pending = mapPrompt(
      {
        type: OcgMessageType.SELECT_SUM,
        player: 0,
        select_max: 0,
        amount: 1,
        min: 1,
        max: 1,
        selects_must: [],
        selects: [{ code: 1, controller: 0, location: OcgLocation.HAND, sequence: 0, amount: packed }],
      },
      cards,
      "p0-sum",
    );
    expect(pending.prompt.options[0].values).toEqual([1, 2]);
    const response = resolveAnswer(pending, 0, "p0-sum", { selected: ["card:0"] }, cards);
    expect(response).toEqual({ type: OcgResponseType.SELECT_SUM, indicies: [0] });
    expect(autoResponse(pending)).toBeNull();
  });
});

describe("live projection", () => {
  it("shuffles each opening deck with the journal seed and reproduces it on replay", async () => {
    const dataDirectory = engineDataDirectory;
    const cdb = new Database(`${dataDirectory}/cards.cdb`, { readonly: true });
    const rows = cdb.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 ORDER BY id LIMIT 40").all() as { id: number }[];
    cdb.close();
    const deck = { main: rows.map((row) => row.id), extra: [], side: [] };
    const opening = async (seed: string[]) => {
      const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed, dataDirectory });
      try {
        return [0, 1].map((seat) => game.view(seat).seats[seat].hand.map((card) => card.code));
      } finally {
        game.close();
      }
    };
    const first = await opening(["1", "2", "3", "4"]);
    const replay = await opening(["1", "2", "3", "4"]);
    const different = await opening(["5", "6", "7", "8"]);
    expect(first).toEqual(replay);
    expect(first[0]).not.toEqual(deck.main.slice(-5).reverse());
    expect(first[0]).not.toEqual(first[1]);
    expect(first).not.toEqual(different);
  });

  it("projects five own hand identities, hides opponent codes, and occupies a monster after summon", async () => {
    const dataDirectory = engineDataDirectory;
    const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const row = cdb.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 LIMIT 1").get() as { id: number };
    cdb.close();
    const deck = { main: Array.from({ length: 40 }, () => row.id), extra: [] as number[], side: [] as number[] };
    const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed: ["1", "2", "3", "4"], dataDirectory });
    try {
      const mine = game.view(0);
      expect(mine.seats[0].hand).toHaveLength(5);
      expect(mine.seats[0].hand.every((card) => card.code != null)).toBe(true);
      expect(mine.seats[1].hand).toHaveLength(5);
      expect(mine.seats[1].hand.every((card) => card.code == null)).toBe(true);
      expect(mine.seats[0].deckCount).toBe(35);
      const summon = mine.prompt?.options.find((option) => option.id.startsWith("summon:"));
      expect(summon).toBeTruthy();
      game.answer(0, mine.prompt!.id, { choice: summon!.id });
      for (let step = 0; step < 8; step++) {
        const view = game.view(0);
        if (view.seats[0].monsters.some((card) => card != null)) break;
        const next = view.prompt;
        if (!next || next.seat !== 0) break;
        if (next.kind === "places" || next.kind === "cards" || next.kind === "tribute") {
          game.answer(0, next.id, { selected: next.options.slice(0, next.min ?? 1).map((option) => option.id) });
        } else if (next.kind === "choice") {
          game.answer(0, next.id, { choice: next.options[0].id });
        } else break;
      }
      const after = game.view(0);
      const monster = after.seats[0].monsters.find((card) => card != null);
      expect(monster?.code).toBeDefined();
      expect(monster?.attribute).toEqual(expect.any(Number));
      expect(typeof monster?.race).toBe("string");
      expect(monster?.race?.length).toBeGreaterThan(0);
      const summons = after.events.filter((event) => event.kind === "summon");
      expect(summons.length).toBeGreaterThan(0);
      expect(summons.map((event) => event.id)).toEqual([...summons.map((event) => event.id)].sort((a, b) => a - b));
      expect(summons[0]?.card?.code).toBe(monster?.code);
      expect(game.view(1).events.some((event) => event.kind === "summon" && event.card?.code === monster?.code)).toBe(true);
      expect(after.chain.every((link) => link.index >= 1)).toBe(true);
    } finally {
      game.close();
    }
  });

  it("keeps set identity off opponent and spectator event views", async () => {
    const dataDirectory = engineDataDirectory;
    const cdb = new Database(resolve(dataDirectory, "cards.cdb"), { readonly: true });
    const row = cdb.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 LIMIT 1").get() as { id: number };
    cdb.close();
    const deck = { main: Array.from({ length: 40 }, () => row.id), extra: [] as number[], side: [] as number[] };
    const game = await createEngineGame({ mode: "normal", decks: [deck, deck], seed: ["1", "2", "3", "4"], dataDirectory });
    try {
      const mine = game.view(0);
      const set = mine.prompt?.options.find((option) => option.id.startsWith("mset:"));
      expect(set).toBeTruthy();
      game.answer(0, mine.prompt!.id, { choice: set!.id });
      for (let step = 0; step < 8; step++) {
        const view = game.view(0);
        if (view.events.some((event) => event.kind === "set")) break;
        const next = view.prompt;
        if (!next || next.seat !== 0) break;
        if (next.kind === "places" || next.kind === "cards" || next.kind === "tribute") {
          game.answer(0, next.id, { selected: next.options.slice(0, next.min ?? 1).map((option) => option.id) });
        } else if (next.kind === "choice") {
          game.answer(0, next.id, { choice: next.options[0].id });
        } else break;
      }
      const ownerSet = game.view(0).events.filter((event) => event.kind === "set");
      const opponentSet = game.view(1).events.filter((event) => event.kind === "set");
      const spectatorSet = game.view(null).events.filter((event) => event.kind === "set");
      expect(ownerSet.length).toBeGreaterThan(0);
      expect(ownerSet[0]?.card?.code).toBe(row.id);
      expect(opponentSet.length).toBeGreaterThan(0);
      expect(opponentSet[0]?.card).toBeUndefined();
      expect(opponentSet[0]?.text).toMatch(/Sets a card/);
      expect(spectatorSet[0]?.card).toBeUndefined();
      expect(spectatorSet[0]?.text).toMatch(/Sets a card/);
    } finally {
      game.close();
    }
  });
});

describe("prompt context", () => {
  function chainSelect(forced: boolean): OcgMessage {
    return {
      type: OcgMessageType.SELECT_CHAIN,
      player: 0,
      spe_count: 0,
      forced,
      hint_timing: 0 as OcgHintTiming,
      hint_timing_other: 0 as OcgHintTiming,
      selects: [
        {
          code: 1,
          controller: 0,
          location: OcgLocation.SZONE,
          sequence: 0,
          position: OcgPosition.FACEUP,
          description: 1n,
          client_mode: OcgEffectClientMode.NORMAL,
        },
      ],
    };
  }

  it("marks idle and battle prompts as phase actions", () => {
    expect(mapPrompt(idleMessage(), cards, "p0-idle").prompt.context).toEqual({ type: "action", phase: "main" });
    const battle = mapPrompt(
      { type: OcgMessageType.SELECT_BATTLECMD, player: 0, chains: [], attacks: [], to_m2: true, to_ep: true },
      cards,
      "p0-bp",
    );
    expect(battle.prompt.context).toEqual({ type: "action", phase: "battle" });
  });

  it("marks position selection", () => {
    const pending = mapPrompt(
      { type: OcgMessageType.SELECT_POSITION, player: 0, code: 1, positions: OcgPosition.FACEUP },
      cards,
      "p0-pos",
    );
    expect(pending.prompt.context).toEqual({ type: "position" });
  });

  it("distinguishes optional and mandatory chain response", () => {
    const optional = mapPrompt(chainSelect(false), cards, "p0-opt");
    expect(optional.prompt.context).toEqual({ type: "chain", forced: false });
    expect(optional.prompt.cancelable).toBe(true);
    expect(optional.prompt.min).toBe(0);
    const mandatory = mapPrompt(chainSelect(true), cards, "p0-must");
    expect(mandatory.prompt.context).toEqual({ type: "chain", forced: true });
    expect(mandatory.prompt.cancelable).toBe(false);
    expect(mandatory.prompt.min).toBe(1);
  });

  it("does not treat the stock Psychic string as a Domain recall", () => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 1040n }, cards, "p0-psychic");
    expect(pending.prompt.context?.type).not.toBe("deck-master-recall");
  });
});

describe("domain recall cost", () => {
  it("sets nextCost to the leave tax after accepting this recall", () => {
    expect(recallPromptContext({ code: 1, returns: 0 }, cards)).toEqual({
      type: "deck-master-recall",
      card: info(1),
      returns: 0,
      nextCost: DOMAIN_LEAVE_TAX_STEP,
    });
    expect(recallPromptContext({ code: 1, returns: 1 }, cards)?.nextCost).toBe(DOMAIN_LEAVE_TAX_STEP * 2);
  });

  it("attaches recall context and cost copy to the yes/no prompt", () => {
    const recall = recallPromptContext({ code: 1, returns: 2 }, cards)!;
    const pending = mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 1n }, cards, "p0-recall", undefined, {
      recall: { card: recall.card, returns: recall.returns, nextCost: recall.nextCost },
    });
    expect(pending.prompt.context).toEqual(recall);
    expect(pending.prompt.context?.type === "deck-master-recall" && pending.prompt.context.nextCost).toBe(1500);
  });
});

describe("duel events", () => {
  const eventCards: CardDatabase = {
    ...cards,
    get: (code) => info(code, code === 2 ? "Mirror Force" : `Card ${code}`),
    resolveLabel: (desc) => (desc ? `effect ${desc}` : ""),
  };

  function chaining(code: number, chainSize: number, controller: 0 | 1 = 0, description = 9n): OcgMessage {
    return {
      type: OcgMessageType.CHAINING,
      code,
      controller,
      location: OcgLocation.SZONE,
      sequence: 0,
      position: OcgPosition.FACEUP,
      triggering_controller: controller,
      triggering_location: OcgLocation.SZONE,
      triggering_sequence: 0,
      description,
      chain_size: chainSize,
    };
  }

  it("redacts set identity from opponents and spectators", () => {
    const chain: StoredChainLink[] = [];
    const stored = observeDuelEvent(
      {
        type: OcgMessageType.SET,
        code: 89631139,
        controller: 0,
        location: OcgLocation.SZONE,
        sequence: 0,
        position: OcgPosition.FACEDOWN,
      },
      eventCards,
      chain,
      1,
    );
    expect(stored).toBeTruthy();
    const owner = projectStoredEvent(stored!, 0);
    const opponent = projectStoredEvent(stored!, 1);
    const spectator = projectStoredEvent(stored!, null);
    expect(owner.kind).toBe("set");
    expect(owner.card?.code).toBe(89631139);
    expect(owner.card?.name).toBe("Card 89631139");
    expect(opponent.card).toBeUndefined();
    expect(opponent.text).toBe("Player 1 Sets a card");
    expect(opponent.description).toBeUndefined();
    expect(spectator.card).toBeUndefined();
    expect(spectator.text).toBe("Player 1 Sets a card");
  });

  it("keeps face-down special summon identities private", () => {
    const stored = observeDuelEvent({
      type: OcgMessageType.SPSUMMONING,
      code: 89631139,
      controller: 0,
      location: OcgLocation.MZONE,
      sequence: 0,
      position: OcgPosition.FACEDOWN_DEFENSE,
    }, eventCards, [], 1)!;
    expect(projectStoredEvent(stored, 0).card?.code).toBe(89631139);
    for (const viewer of [1, null]) {
      const projected = projectStoredEvent(stored, viewer);
      expect(projected.card).toBeUndefined();
      expect(projected.description).toBeUndefined();
      expect(projected.text).not.toContain("89631139");
    }
  });

  it("keeps a short chain sequence with effect text and 1-based indexes", () => {
    const chain: StoredChainLink[] = [];
    const messages: OcgMessage[] = [
      chaining(1, 1, 0, 11n),
      chaining(2, 2, 1, 22n),
      { type: OcgMessageType.CHAIN_SOLVING, chain_size: 2 },
      { type: OcgMessageType.CHAIN_SOLVED, chain_size: 2 },
      { type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 },
      { type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 },
      { type: OcgMessageType.CHAIN_END },
    ];
    const events = messages.map((message, index) => observeDuelEvent(message, eventCards, chain, index + 1));
    expect(events.every((event) => event != null)).toBe(true);
    expect(events.map((event) => event!.kind)).toEqual([
      "activate",
      "activate",
      "chain-resolving",
      "chain-resolved",
      "chain-resolving",
      "chain-resolved",
      "chain-end",
    ]);
    expect(events.map((event) => event!.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events[0]?.chainIndex).toBe(1);
    expect(events[0]?.description).toBe("effect 11");
    expect(events[1]?.chainIndex).toBe(2);
    expect(events[1]?.card?.name).toBe("Mirror Force");
    expect(events[1]?.description).toBe("effect 22");
    expect(events[2]?.chainIndex).toBe(2);
    expect(events[2]?.card?.name).toBe("Mirror Force");
    expect(events[4]?.chainIndex).toBe(1);
    expect(events[6]?.chainIndex).toBeUndefined();
    expect(chain).toEqual([]);
  });

  it("maps summons, attacks, and negated links from ocgcore messages", () => {
    const chain: StoredChainLink[] = [];
    const summon = observeDuelEvent(
      {
        type: OcgMessageType.SUMMONING,
        code: 1,
        controller: 0,
        location: OcgLocation.MZONE,
        sequence: 0,
        position: OcgPosition.FACEUP_ATTACK,
      },
      eventCards,
      chain,
      1,
    );
    expect(summon?.kind).toBe("summon");
    expect(projectStoredEvent(summon!, 1).card?.code).toBe(1);
    observeDuelEvent(chaining(2, 1, 0, 5n), eventCards, chain, 2);
    const negated = observeDuelEvent({ type: OcgMessageType.CHAIN_NEGATED, chain_size: 1 }, eventCards, chain, 3);
    expect(negated?.kind).toBe("chain-negated");
    expect(negated?.chainIndex).toBe(1);
    expect(negated?.card?.name).toBe("Mirror Force");
    const attack = observeDuelEvent(
      {
        type: OcgMessageType.ATTACK,
        card: { controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
        target: null,
      },
      eventCards,
      chain,
      4,
    );
    expect(attack?.kind).toBe("attack");
    expect(attack?.seat).toBe(0);
    expect(attack?.card).toBeUndefined();
    expect(attack?.text).toMatch(/direct attack/);
  });

  it("announces main/battle/end from NEW_PHASE and skips auto draw/standby/substeps", () => {
    const chain: StoredChainLink[] = [];
    const sequence: Array<{ phase: typeof OcgPhase[keyof typeof OcgPhase]; title: string | null }> = [
      { phase: OcgPhase.DRAW, title: null },
      { phase: OcgPhase.STANDBY, title: null },
      { phase: OcgPhase.MAIN1, title: "Main Phase 1" },
      { phase: OcgPhase.BATTLE_START, title: "Battle Phase" },
      { phase: OcgPhase.BATTLE_STEP, title: null },
      { phase: OcgPhase.DAMAGE, title: null },
      { phase: OcgPhase.DAMAGE_CAL, title: null },
      { phase: OcgPhase.BATTLE, title: null },
      { phase: OcgPhase.MAIN2, title: "Main Phase 2" },
      { phase: OcgPhase.END, title: "End Phase" },
      { phase: OcgPhase.DRAW, title: null },
      { phase: OcgPhase.STANDBY, title: null },
      { phase: OcgPhase.MAIN1, title: "Main Phase 1" },
    ];
    const stored = sequence.map((step, index) =>
      observeDuelEvent({ type: OcgMessageType.NEW_PHASE, phase: step.phase }, eventCards, chain, index + 1),
    );
    expect(stored.map((event) => event?.text ?? null)).toEqual(sequence.map((step) => step.title));
    const announced = stored.filter((event): event is NonNullable<typeof event> => event != null);
    expect(announced.map((event) => event.kind)).toEqual(["phase", "phase", "phase", "phase", "phase"]);
    expect(announced.map((event) => event.text)).toEqual([
      "Main Phase 1",
      "Battle Phase",
      "Main Phase 2",
      "End Phase",
      "Main Phase 1",
    ]);
    for (const viewer of [0, 1, null]) {
      const projected = projectStoredEvent(announced[0]!, viewer);
      expect(projected.kind).toBe("phase");
      expect(projected.text).toBe("Main Phase 1");
      expect(projected.card).toBeUndefined();
      expect(projected.description).toBeUndefined();
    }
  });

});

describe("prompt privacy", () => {
  const vacant = { position: 0, materials: 0 };
  const emptyPlayer = {
    monsters: [vacant, vacant, vacant, vacant, vacant, vacant, vacant],
    spells: [vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant],
    deck_size: 0,
    hand_size: 0,
    grave_size: 0,
    banish_size: 0,
    extra_size: 0,
    extra_faceup_count: 0,
  };

  function project(args: {
    viewer: number | null;
    prompt: DuelPrompt | null;
    promptSeat: number | null;
    locations?: Record<string, Array<{ code: number; position: number } | null>>;
    reveals?: RevealMap;
  }) {
    return projectView({
      lib: {
        duelQueryField: () => ({ flags: 0n, players: [emptyPlayer, emptyPlayer], chain: [] }),
        duelQueryLocation: (_handle: unknown, loc: { controller: number; location: number }) =>
          args.locations?.[`${loc.controller}:${loc.location}`] ?? [],
      } as never,
      handle: {} as never,
      cards,
      viewer: args.viewer,
      revision: 1,
      turn: 1,
      turnSeat: 0,
      phase: "main1",
      lp: [8000, 8000],
      prompt: args.prompt,
      promptSeat: args.promptSeat,
      log: [],
      events: [],
      result: null,
      reveals: args.reveals ?? createRevealMap(),
      mode: "normal",
    });
  }

  const mirror = {
    code: 44095762,
    name: "Mirror Force",
    description: "When an opponent's monster declares an attack: Destroy all your opponent's Attack Position monsters.",
    type: 4,
    attack: 0,
    defense: 0,
    level: 0,
    attribute: 0,
    race: "unknown",
  };
  const torrential = {
    code: 53582587,
    name: "Torrential Tribute",
    description: "When a monster(s) is Summoned: Destroy all monsters on the field.",
    type: 4,
    attack: 0,
    defense: 0,
    level: 0,
    attribute: 0,
    race: "unknown",
  };

  it("redacts opponent set Spell/Trap identities in SELECT_CARD options but keeps native indexes", () => {
    const prompt: DuelPrompt = {
      id: "p1",
      seat: 0,
      kind: "cards",
      title: "Select the card(s) to destroy",
      options: [
        { id: "card:0", label: "Mirror Force", card: mirror, controller: 1, location: OcgLocation.SZONE, sequence: 0 },
        { id: "card:1", label: "Torrential Tribute", card: torrential, controller: 1, location: OcgLocation.SZONE, sequence: 1 },
      ],
      min: 1,
      max: 1,
    };
    const view = project({
      viewer: 0,
      promptSeat: 0,
      prompt,
      locations: {
        [`1:${OcgLocation.SZONE}`]: [
          { code: mirror.code, position: OcgPosition.FACEDOWN_DEFENSE },
          { code: torrential.code, position: OcgPosition.FACEDOWN_DEFENSE },
        ],
      },
    });
    expect(view.prompt?.options.map((option) => option.id)).toEqual(["card:0", "card:1"]);
    expect(view.prompt?.options.map((option) => [option.controller, option.location, option.sequence])).toEqual([
      [1, OcgLocation.SZONE, 0],
      [1, OcgLocation.SZONE, 1],
    ]);
    expect(view.prompt?.options.every((option) => option.card == null && option.label === "Face-down card")).toBe(true);
    expect(JSON.stringify(view.prompt)).not.toMatch(/Mirror Force|Torrential Tribute|44095762|53582587|declares an attack|Summoned/);
    expect(prompt.options[0]?.card?.name).toBe("Mirror Force");
    expect(project({ viewer: null, promptSeat: 0, prompt }).prompt).toBeNull();
  });

  it("keeps own hand, public GY, and own deck-search identities", () => {
    const bewd = info(89631139, "Blue-Eyes White Dragon");
    const view = project({
      viewer: 0,
      promptSeat: 0,
      prompt: {
        id: "p-visible",
        seat: 0,
        kind: "cards",
        title: "Select a card",
        options: [
          { id: "card:0", label: bewd.name, card: bewd, controller: 0, location: OcgLocation.HAND, sequence: 0 },
          { id: "card:1", label: mirror.name, card: mirror, controller: 1, location: OcgLocation.GRAVE, sequence: 0 },
          { id: "card:2", label: bewd.name, card: bewd, controller: 0, location: OcgLocation.DECK, sequence: 3 },
        ],
        min: 1,
        max: 1,
      },
      locations: {
        [`0:${OcgLocation.HAND}`]: [{ code: bewd.code, position: OcgPosition.FACEUP_ATTACK }],
        [`1:${OcgLocation.GRAVE}`]: [{ code: mirror.code, position: OcgPosition.FACEUP_ATTACK }],
      },
    });
    expect(view.prompt?.options.map((option) => option.card?.name)).toEqual([
      "Blue-Eyes White Dragon",
      "Mirror Force",
      "Blue-Eyes White Dragon",
    ]);
  });

  it("hides opponent deck and unrevealed hand, but shows a revealed hand card", () => {
    const reveals = createRevealMap();
    noteReveal(reveals, 0, 1, OcgLocation.HAND, 1, torrential.code);
    const view = project({
      viewer: 0,
      promptSeat: 0,
      reveals,
      prompt: {
        id: "p-private",
        seat: 0,
        kind: "toggle",
        title: "Select or unselect a card",
        options: [
          { id: "select:0", label: mirror.name, card: mirror, controller: 1, location: OcgLocation.DECK, sequence: 0, selected: false },
          { id: "select:1", label: torrential.name, card: torrential, controller: 1, location: OcgLocation.HAND, sequence: 0, selected: false },
          { id: "unselect:0", label: torrential.name, card: torrential, controller: 1, location: OcgLocation.HAND, sequence: 1, selected: true },
        ],
      },
      locations: {
        [`1:${OcgLocation.HAND}`]: [
          { code: torrential.code, position: OcgPosition.FACEUP_ATTACK },
          { code: torrential.code, position: OcgPosition.FACEUP_ATTACK },
        ],
      },
    });
    expect(view.prompt?.options[0]).toMatchObject({ id: "select:0", label: "Unknown card", selected: false });
    expect(view.prompt?.options[0]?.card).toBeUndefined();
    expect(view.prompt?.options[1]?.card).toBeUndefined();
    expect(view.prompt?.options[1]?.label).toBe("Unknown card");
    expect(view.prompt?.options[2]).toMatchObject({ id: "unselect:0", label: torrential.name, selected: true, card: torrential });
    expect(JSON.stringify(view.prompt?.options.slice(0, 2))).not.toMatch(/Mirror Force|Torrential Tribute|44095762|53582587/);
  });

  it("hides facedown tribute targets while retaining release metadata", () => {
    const view = project({
      viewer: 0,
      promptSeat: 0,
      prompt: {
        id: "p-tribute",
        seat: 0,
        kind: "tribute",
        title: "Select tribute(s)",
        options: [
          {
            id: "card:0",
            label: "Blue-Eyes White Dragon (2)",
            card: info(89631139, "Blue-Eyes White Dragon"),
            controller: 1,
            location: OcgLocation.MZONE,
            sequence: 2,
            values: [2],
          },
        ],
        min: 2,
        max: 2,
      },
      locations: {
        [`1:${OcgLocation.MZONE}`]: [null, null, { code: 89631139, position: OcgPosition.FACEDOWN_DEFENSE }],
      },
    });
    expect(view.prompt?.options[0]).toMatchObject({
      id: "card:0",
      label: "Face-down card",
      controller: 1,
      location: OcgLocation.MZONE,
      sequence: 2,
      values: [2],
    });
    expect(view.prompt?.options[0]?.card).toBeUndefined();
    expect(JSON.stringify(view.prompt)).not.toMatch(/Blue-Eyes|89631139/);
  });
});

