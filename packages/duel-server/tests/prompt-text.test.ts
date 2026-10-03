import { describe, expect, it } from "vitest";
import type { DuelAnswer, DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";
import { OcgHintType, OcgLocation, OcgMessageType, OcgPhase, OcgPosition, OcgType, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { isPendulumSummonAnswer } from "../src/engine.js";
import { cardStringCode, mapPrompt } from "../src/prompts.js";
import {
  createEventContext,
  createRevealMap,
  nextBattleStep,
  observeDuelEvent,
  observeMoveEvents,
  projectStoredEvent,
  projectView,
  resetEventBatch,
  type StoredChainLink,
} from "../src/views.js";

const GIANT_RAT = 97017120;
const ENEMY_CONTROLLER = 98045062;
const FLAME_SWORDSMAN = 45231177;
const PALADIN = 73398797;

const library: Record<number, DuelCardInfo> = {
  [GIANT_RAT]: {
    code: GIANT_RAT, name: "Giant Rat", type: OcgType.MONSTER | OcgType.EFFECT, attack: 1400, defense: 1450, level: 4, attribute: 1, race: "Beast",
    description: "When this card is destroyed by battle and sent to the GY: You can Special Summon 1 EARTH monster with 1500 or less ATK from your Deck in Attack Position.",
  },
  [ENEMY_CONTROLLER]: {
    code: ENEMY_CONTROLLER, name: "Enemy Controller", type: OcgType.SPELL | OcgType.QUICKPLAY, attack: 0, defense: 0, level: 0, attribute: 0, race: "unknown",
    description: "Activate 1 of these effects;\n● Target 1 face-up monster your opponent controls; change that target's battle position.\n● Tribute 1 monster, then target 1 face-up monster your opponent controls; take control of that target until the End Phase.",
  },
  [FLAME_SWORDSMAN]: {
    code: FLAME_SWORDSMAN, name: "Flame Swordsman", type: OcgType.MONSTER | OcgType.FUSION, attack: 1800, defense: 1600, level: 5, attribute: 4, race: "Warrior",
    description: '"Flame Manipulator" + "Masaki the Legendary Swordsman"',
  },
  [PALADIN]: {
    code: PALADIN, name: "Paladin of White Dragon", type: OcgType.MONSTER | OcgType.RITUAL | OcgType.EFFECT, attack: 1900, defense: 1200, level: 4, attribute: 0x10, race: "Dragon",
    description: 'You can Ritual Summon this card with "White Dragon Ritual".',
  },
};

const system: Record<number, string> = {
  95: 'Use the effect of "%ls"?',
  200: 'Use the effect of "%ls" from [%ls]?',
  221: 'Activate the Trigger Effect of "%ls" from [%ls]?',
  569: 'Select the zone to place "%ls"',
  1160: "Activate the effect",
};

const cardStrings: Record<number, string[]> = {
  [ENEMY_CONTROLLER]: ["Activate 1 of these effects", "Change the battle position of an opponent's monster", "Take control"],
};

const cards: CardDatabase = {
  search: () => [],
  deckCard: () => undefined,
  all: () => [],
  setnames: () => new Map(),
  get: (code) => library[code],
  cardData: () => null,
  resolveLabel: (desc) => {
    const value = typeof desc === "bigint" ? desc : BigInt(desc);
    if (value > 0n && value <= 0xffffffffn) return library[Number(value)]?.name ?? system[Number(value)] ?? "";
    const code = Number(value >> 20n);
    const index = Number(value & 0xfffffn);
    return cardStrings[code]?.[index] ?? library[code]?.name ?? "";
  },
  system: (id) => system[id],
  victory: () => undefined,
  counter: () => undefined,
  readScript: () => null,
  close() {},
};

const cardString = (code: number, index: number) => (BigInt(code) << 20n) | BigInt(index);

function noPlaceholders(prompt: DuelPrompt) {
  expect(prompt.title).not.toContain("%");
  expect(prompt.description ?? "").not.toContain("%");
  for (const option of prompt.options) {
    expect(option.label).not.toContain("%");
    expect(option.effectText ?? "").not.toContain("%");
  }
}

describe("prompt text", () => {
  it("fills the trigger-effect yes/no with the card name and its location, and names the source", () => {
    const { prompt } = mapPrompt(
      { type: OcgMessageType.SELECT_EFFECTYN, player: 0, code: GIANT_RAT, controller: 0, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP, description: 221n },
      cards,
      "p1",
    );
    noPlaceholders(prompt);
    expect(prompt.title).toBe('Activate the Trigger Effect of "Giant Rat" from [Graveyard]?');
    expect(prompt.description).toBeUndefined();
    expect(prompt.source).toEqual({
      code: GIANT_RAT,
      name: "Giant Rat",
      seat: 0,
      zone: { controller: 0, location: OcgLocation.GRAVE, sequence: 0 },
      text: library[GIANT_RAT]!.description,
    });
    expect(prompt.options.map((option) => option.id)).toEqual(["yes", "no"]);
    expect(prompt.options[0]!.cardText).toBe(library[GIANT_RAT]!.description);
    expect(prompt.options[0]!.card?.code).toBe(GIANT_RAT);
  });

  it("uses the core's default effect string when a SELECT_EFFECTYN has no description", () => {
    const { prompt } = mapPrompt(
      { type: OcgMessageType.SELECT_EFFECTYN, player: 1, code: GIANT_RAT, controller: 1, location: OcgLocation.HAND, sequence: 3, position: OcgPosition.FACEDOWN, description: 0n },
      cards,
      "p1",
    );
    expect(prompt.title).toBe('Use the effect of "Giant Rat" from [hand]?');
    expect(prompt.source?.seat).toBe(1);
  });

  it("fills a yes/no system string from the last card hint and attaches it as the source", () => {
    const { prompt } = mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 95n }, cards, "p1", undefined, { hintCard: ENEMY_CONTROLLER });
    noPlaceholders(prompt);
    expect(prompt.title).toBe('Use the effect of "Enemy Controller"?');
    expect(prompt.source).toMatchObject({ code: ENEMY_CONTROLLER, name: "Enemy Controller", seat: 0, text: library[ENEMY_CONTROLLER]!.description });
    expect(prompt.source?.zone).toBeUndefined();
    expect(prompt.options[0]!.card?.code).toBe(ENEMY_CONTROLLER);
    expect(prompt.options[0]!.cardText).toBe(library[ENEMY_CONTROLLER]!.description);
  });

  it("degrades a yes/no with no card hint to a readable sentence", () => {
    const { prompt } = mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 95n }, cards, "p1");
    noPlaceholders(prompt);
    expect(prompt.title).toBe("Use the effect?");
    expect(prompt.source).toBeUndefined();
    expect(prompt.options[0]!.card).toBeUndefined();
  });

  it("gives option prompts the card's effect strings plus its full printed text", () => {
    const { prompt } = mapPrompt(
      { type: OcgMessageType.SELECT_OPTION, player: 1, options: [cardString(ENEMY_CONTROLLER, 1), cardString(ENEMY_CONTROLLER, 2)] },
      cards,
      "p1",
    );
    noPlaceholders(prompt);
    expect(prompt.source).toMatchObject({ code: ENEMY_CONTROLLER, seat: 1, text: library[ENEMY_CONTROLLER]!.description });
    expect(prompt.options.map((option) => option.label)).toEqual(["Change the battle position of an opponent's monster", "Take control"]);
    expect(prompt.options[1]).toMatchObject({ id: "opt:1", effectText: "Take control", cardText: library[ENEMY_CONTROLLER]!.description, values: [1] });
    expect(cardStringCode(cardString(ENEMY_CONTROLLER, 2))).toBe(ENEMY_CONTROLLER);
    expect(cardStringCode(221n)).toBe(0);
  });

  it("binds chain options to their card text and marks a lone candidate as the source", () => {
    const select = { code: ENEMY_CONTROLLER, controller: 1 as const, location: OcgLocation.SZONE, sequence: 2, position: OcgPosition.FACEDOWN, description: cardString(ENEMY_CONTROLLER, 2), client_mode: 0 as never };
    const { prompt } = mapPrompt(
      { type: OcgMessageType.SELECT_CHAIN, player: 1, spe_count: 0, forced: false, hint_timing: 0 as never, hint_timing_other: 0 as never, selects: [select] },
      cards,
      "p1",
    );
    noPlaceholders(prompt);
    expect(prompt.options[0]).toMatchObject({
      id: "card:0",
      label: "Enemy Controller: Take control",
      effectText: "Take control",
      cardText: library[ENEMY_CONTROLLER]!.description,
      controller: 1,
      location: OcgLocation.SZONE,
      sequence: 2,
    });
    expect(prompt.source).toEqual({
      code: ENEMY_CONTROLLER,
      name: "Enemy Controller",
      seat: 1,
      zone: { controller: 1, location: OcgLocation.SZONE, sequence: 2 },
      text: library[ENEMY_CONTROLLER]!.description,
    });
    const two = mapPrompt(
      { type: OcgMessageType.SELECT_CHAIN, player: 1, spe_count: 0, forced: false, hint_timing: 0 as never, hint_timing_other: 0 as never, selects: [select, { ...select, sequence: 3 }] },
      cards,
      "p2",
    ).prompt;
    expect(two.source).toBeUndefined();
  });

  it("fills a select hint with the card the prompt is about and carries the hinted card as source", () => {
    const { prompt } = mapPrompt(
      { type: OcgMessageType.SELECT_PLACE, player: 0, count: 1, field_mask: 0xffff_fffe },
      cards,
      "p1",
      system[569],
      { hintCard: PALADIN },
    );
    noPlaceholders(prompt);
    expect(prompt.title).toBe('Select the zone to place "Paladin of White Dragon"');
    expect(prompt.source).toMatchObject({ code: PALADIN, seat: 0 });
  });

  it("labels positions, attributes and types in words and keeps option ids", () => {
    const position = mapPrompt(
      { type: OcgMessageType.SELECT_POSITION, player: 0, code: GIANT_RAT, positions: (OcgPosition.FACEUP_ATTACK | OcgPosition.FACEUP_DEFENSE | OcgPosition.FACEDOWN_DEFENSE) as never },
      cards,
      "p1",
    ).prompt;
    expect(position.options.map((option) => [option.id, option.label])).toEqual([
      ["pos:1", "Face-up Attack"],
      ["pos:4", "Face-up Defense"],
      ["pos:8", "Face-down Defense"],
    ]);
    expect(position.options[0]!.cardText).toBe(library[GIANT_RAT]!.description);
    const attribute = mapPrompt({ type: OcgMessageType.ANNOUNCE_ATTRIB, player: 0, count: 1, available: 0x21 as never }, cards, "p2").prompt;
    expect(attribute.options.map((option) => option.label)).toEqual(["EARTH", "DARK"]);
    const race = mapPrompt({ type: OcgMessageType.ANNOUNCE_RACE, player: 0, count: 1, available: 0x8200n as never }, cards, "p3").prompt;
    expect(race.options.map((option) => option.label)).toEqual(["Winged Beast", "Beast-Warrior"]);
    for (const prompt of [position, attribute, race]) {
      for (const option of prompt.options) expect(option.label).not.toMatch(/[a-z]_[a-z]/);
    }
  });

  it("does not give the main action prompts a source", () => {
    const idle = mapPrompt(
      {
        type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], special_summons: [], pos_changes: [], monster_sets: [], spell_sets: [],
        activates: [{ code: ENEMY_CONTROLLER, controller: 0, location: OcgLocation.HAND, sequence: 0, description: 1160n, client_mode: 0 as never }],
        to_bp: false, to_ep: true, shuffle: false,
      },
      cards,
      "p1",
      undefined,
      { hintCard: GIANT_RAT },
    ).prompt;
    expect(idle.source).toBeUndefined();
    expect(idle.options[0]).toMatchObject({ label: "Activate Enemy Controller: Activate the effect", effectText: "Activate the effect", cardText: library[ENEMY_CONTROLLER]!.description });
  });
});

describe("prompt source privacy", () => {
  const vacant = { position: 0, materials: 0 };
  const emptyPlayer = {
    monsters: [vacant, vacant, vacant, vacant, vacant, vacant, vacant],
    spells: [vacant, vacant, vacant, vacant, vacant, vacant, vacant, vacant],
    deck_size: 0, hand_size: 0, grave_size: 0, banish_size: 0, extra_size: 0, extra_faceup_count: 0,
  };
  const project = (prompt: DuelPrompt, viewer: number, locations: Record<string, Array<{ code: number; position: number } | null>>) =>
    projectView({
      lib: {
        duelQueryField: () => ({ flags: 0n, players: [emptyPlayer, emptyPlayer], chain: [] }),
        duelQueryLocation: (_handle: unknown, loc: { controller: number; location: number }) => locations[`${loc.controller}:${loc.location}`] ?? [],
      } as never,
      handle: {} as never,
      cards,
      viewer,
      revision: 1, turn: 1, turnSeat: 0, phase: "main1", battleStep: null, lp: [8000, 8000],
      prompt, promptSeat: viewer, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal",
    });

  it("keeps a source the answering seat can see and drops one it cannot", () => {
    const facedown = { code: ENEMY_CONTROLLER, position: OcgPosition.FACEDOWN };
    const own = mapPrompt(
      { type: OcgMessageType.SELECT_EFFECTYN, player: 1, code: ENEMY_CONTROLLER, controller: 1, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEDOWN, description: 221n },
      cards,
      "p1",
    ).prompt;
    expect(project(own, 1, { "1:8": [facedown] }).prompt?.source?.code).toBe(ENEMY_CONTROLLER);
    const foreign = { ...own, seat: 0, source: { ...own.source!, seat: 1 } };
    expect(project(foreign, 0, { "1:8": [facedown] }).prompt?.source).toBeUndefined();
    const graveyard = { ...own, seat: 0, source: { ...own.source!, zone: { controller: 1, location: OcgLocation.GRAVE, sequence: 0 } } };
    expect(project(graveyard, 0, { "1:16": [{ code: ENEMY_CONTROLLER, position: OcgPosition.FACEUP }] }).prompt?.source?.code).toBe(ENEMY_CONTROLLER);
  });
});

describe("battle step", () => {
  const hint = (value: number): OcgMessage => ({ type: OcgMessageType.HINT, hint_type: OcgHintType.EVENT, player: 0, hint: BigInt(value) });
  const phase = (value: OcgPhase): OcgMessage => ({ type: OcgMessageType.NEW_PHASE, phase: value });
  const loc = { controller: 1 as const, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK };

  it("follows the core's messages through one attack, as the engine trace shows them", () => {
    const sequence: Array<[OcgMessage, ReturnType<typeof nextBattleStep>]> = [
      [phase(OcgPhase.MAIN1), null],
      [hint(40), null],
      [phase(OcgPhase.BATTLE_START), "start"],
      [{ type: OcgMessageType.SELECT_BATTLECMD, player: 1, chains: [], attacks: [], to_m2: true, to_ep: true }, "battle"],
      [{ type: OcgMessageType.ATTACK, card: loc, target: null }, "battle"],
      [hint(24), "battle"],
      [{ type: OcgMessageType.DAMAGE_STEP_START }, "damage"],
      [hint(40), "damage"],
      [hint(41), "damage"],
      [hint(42), "damage-calculation"],
      [{ type: OcgMessageType.BATTLE, card: { ...loc, attack: 2000, defense: 0, destroyed: false }, target: null }, "damage-calculation"],
      [{ type: OcgMessageType.DAMAGE, player: 0, amount: 600 }, "damage-calculation"],
      [hint(43), "damage"],
      [hint(44), "damage"],
      [{ type: OcgMessageType.DAMAGE_STEP_END }, "battle"],
      [{ type: OcgMessageType.SELECT_BATTLECMD, player: 1, chains: [], attacks: [], to_m2: true, to_ep: true }, "battle"],
      [hint(29), "end"],
      [phase(OcgPhase.MAIN2), null],
      [{ type: OcgMessageType.DAMAGE_STEP_START }, null],
    ];
    let step: ReturnType<typeof nextBattleStep> = null;
    for (const [message, expected] of sequence) {
      step = nextBattleStep(step, message);
      expect(step, `after ${message.type}`).toBe(expected);
    }
  });

  it("maps explicit sub-phase announcements and leaves at a new turn or the End Phase", () => {
    expect(nextBattleStep("start", phase(OcgPhase.BATTLE_STEP))).toBe("battle");
    expect(nextBattleStep("battle", phase(OcgPhase.DAMAGE))).toBe("damage");
    expect(nextBattleStep("damage", phase(OcgPhase.DAMAGE_CAL))).toBe("damage-calculation");
    expect(nextBattleStep("battle", phase(OcgPhase.BATTLE))).toBe("end");
    expect(nextBattleStep("end", phase(OcgPhase.END))).toBe(null);
    expect(nextBattleStep("battle", { type: OcgMessageType.NEW_TURN, player: 0 })).toBe(null);
    expect(nextBattleStep(null, hint(42))).toBe(null);
  });
});

describe("position events", () => {
  const change = (prev: OcgPosition, next: OcgPosition, controller: 0 | 1 = 0): OcgMessage => ({
    type: OcgMessageType.POS_CHANGE, code: GIANT_RAT, controller, location: OcgLocation.MZONE, sequence: 1, prev_position: prev, position: next,
  });

  it("reports attack/defense changes with both positions and the card", () => {
    const stored = observeDuelEvent(change(OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE), cards, [], 1, createEventContext())!;
    for (const viewer of [0, 1, null]) {
      const event = projectStoredEvent(stored, viewer);
      expect(event).toMatchObject({
        kind: "position", seat: 0, fromPosition: OcgPosition.FACEUP_ATTACK, toPosition: OcgPosition.FACEUP_DEFENSE,
        zone: { controller: 0, location: OcgLocation.MZONE, sequence: 1 }, text: "Giant Rat changed to Defense Position",
      });
      expect(event.card?.code).toBe(GIANT_RAT);
      expect(event.flip).toBeUndefined();
    }
  });

  it("marks a face-down to face-up change as a flip everyone may see", () => {
    const stored = observeDuelEvent(change(OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_DEFENSE), cards, [], 1, createEventContext())!;
    const event = projectStoredEvent(stored, 1);
    expect(event).toMatchObject({ kind: "position", flip: true, fromPosition: OcgPosition.FACEDOWN_DEFENSE, toPosition: OcgPosition.FACEUP_DEFENSE, text: "Giant Rat was flipped face-up" });
    expect(event.card?.code).toBe(GIANT_RAT);
  });

  it("keeps a face-down to face-down change private to the controller", () => {
    const stored = observeDuelEvent(change(OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEDOWN_ATTACK, 1), cards, [], 1, createEventContext())!;
    expect(projectStoredEvent(stored, 1).card?.code).toBe(GIANT_RAT);
    for (const viewer of [0, null]) {
      const event = projectStoredEvent(stored, viewer);
      expect(event.card).toBeUndefined();
      expect(event.text).toBe("A face-down card changed position");
      expect(event.zone).toEqual({ controller: 1, location: OcgLocation.MZONE, sequence: 1 });
      expect(event.fromPosition).toBe(OcgPosition.FACEDOWN_DEFENSE);
    }
  });
});

describe("summon kinds", () => {
  const at = (controller: 0 | 1, location: OcgLocation, sequence: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({ controller, location, sequence, position });
  const move = (code: number, from: ReturnType<typeof at>, to: ReturnType<typeof at>, reason = 0) => ({ type: OcgMessageType.MOVE as typeof OcgMessageType.MOVE, card: code, from, to, reason });
  const spsummon = (code: number, sequence = 0): OcgMessage => ({ type: OcgMessageType.SPSUMMONING, code, controller: 0, location: OcgLocation.MZONE, sequence, position: OcgPosition.FACEUP_ATTACK });
  const chain: StoredChainLink[] = [];

  function summonAfter(from: ReturnType<typeof at>, code: number, ctx = createEventContext(), materialReason = 0) {
    if (materialReason) {
      observeMoveEvents(move(GIANT_RAT, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.GRAVE, 0), materialReason), cards, ctx, 0);
    }
    const target = at(0, OcgLocation.MZONE, 0);
    observeMoveEvents(move(code, from, target), cards, ctx, 1);
    observeDuelEvent(move(code, from, target), cards, chain, 1, ctx);
    return observeDuelEvent(spsummon(code), cards, chain, 2, ctx)!;
  }

  it("names Fusion and Ritual Summons only after matching material moves", () => {
    const fusionMaterial = 0x8 | 0x40000;
    const ritualMaterial = 0x8 | 0x100000;
    expect(summonAfter(at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEDOWN_DEFENSE), FLAME_SWORDSMAN, undefined, fusionMaterial).summonKind).toBe("fusion");
    expect(summonAfter(at(0, OcgLocation.HAND, 2, OcgPosition.FACEDOWN), PALADIN, undefined, ritualMaterial).summonKind).toBe("ritual");
    // The Domain core's MOVE can report the Deck Master Zone as location 0.
    for (const location of [0x4000, 0]) {
      expect(summonAfter(at(0, location as OcgLocation, 0), FLAME_SWORDSMAN, undefined, fusionMaterial).summonKind).toBe("fusion");
      expect(summonAfter(at(0, location as OcgLocation, 0), PALADIN, undefined, ritualMaterial).summonKind).toBe("ritual");
    }
  });

  it("keeps effect summons of Fusion and Ritual monsters without materials plain", () => {
    for (const location of [OcgLocation.EXTRA, 0x4000, 0]) {
      expect(summonAfter(at(0, location as OcgLocation, 0), FLAME_SWORDSMAN).summonKind).toBe("special");
    }
    for (const location of [OcgLocation.HAND, 0x4000, 0]) {
      expect(summonAfter(at(0, location as OcgLocation, 0), PALADIN).summonKind).toBe("special");
    }
  });

  it("requires both material and matching method reason bits", () => {
    for (const reason of [0x8, 0x40000, 0x8 | 0x80000, 0x8 | 0x4000000]) {
      expect(summonAfter(at(0, OcgLocation.EXTRA, 0), FLAME_SWORDSMAN, undefined, reason).summonKind).toBe("special");
    }
    expect(summonAfter(at(0, OcgLocation.HAND, 0), PALADIN, undefined, 0x8 | 0x40000).summonKind).toBe("special");
  });

  it.each([
    { kind: "fusion", code: FLAME_SWORDSMAN, origin: OcgLocation.EXTRA, reason: 0x8 | 0x40000 },
    { kind: "ritual", code: PALADIN, origin: OcgLocation.HAND, reason: 0x8 | 0x100000 },
  ])("retains $kind material reasons for every monster until SPSUMMONED", ({ kind, code, origin, reason }) => {
    const ctx = createEventContext();
    observeMoveEvents(move(GIANT_RAT, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.GRAVE, 0), reason), cards, ctx, 1);
    for (const sequence of [0, 1]) {
      const arrival = move(code, at(0, origin, 0), at(0, OcgLocation.MZONE, sequence));
      observeMoveEvents(arrival, cards, ctx, 2 + sequence * 2);
      expect(observeDuelEvent(spsummon(code, sequence), cards, chain, 3 + sequence * 2, ctx)!.summonKind).toBe(kind);
    }
    observeDuelEvent({ type: OcgMessageType.SPSUMMONED }, cards, chain, 7, ctx);
    // A separate effect summon in the same batch has no new materials.
    expect(summonAfter(at(0, OcgLocation.EXTRA, 0), FLAME_SWORDSMAN, ctx).summonKind).toBe("special");
  });

  it("consumes material reasons when a summon completes so a later effect summon stays plain", () => {
    for (const type of [OcgMessageType.SPSUMMONING, OcgMessageType.SUMMONING, OcgMessageType.FLIPSUMMONING]) {
      const ctx = createEventContext();
      observeMoveEvents(move(GIANT_RAT, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.GRAVE, 0), 0x8 | 0x40000), cards, ctx, 1);
      observeDuelEvent({ ...spsummon(GIANT_RAT), type } as OcgMessage, cards, chain, 2, ctx);
      if (type === OcgMessageType.SPSUMMONING) observeDuelEvent({ type: OcgMessageType.SPSUMMONED }, cards, chain, 3, ctx);
      expect(summonAfter(at(0, OcgLocation.EXTRA, 0), FLAME_SWORDSMAN, ctx).summonKind).toBe("special");
    }
  });

  it("clears unused material reasons at batch, chain, turn and phase boundaries", () => {
    const boundaries: Array<OcgMessage | null> = [
      null,
      { type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 },
      { type: OcgMessageType.CHAIN_END },
      { type: OcgMessageType.NEW_TURN, player: 0 },
      { type: OcgMessageType.NEW_PHASE, phase: OcgPhase.MAIN1 },
    ];
    for (const boundary of boundaries) {
      const ctx = createEventContext();
      observeMoveEvents(move(GIANT_RAT, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.GRAVE, 0), 0x8 | 0x40000), cards, ctx, 1);
      if (boundary) observeDuelEvent(boundary, cards, chain, 2, ctx);
      else resetEventBatch(ctx);
      expect(summonAfter(at(0, OcgLocation.EXTRA, 0), FLAME_SWORDSMAN, ctx).summonKind).toBe("special");
    }
  });

  it("keeps revivals and other Special Summons plain", () => {
    expect(summonAfter(at(0, OcgLocation.GRAVE, 0, OcgPosition.FACEUP), FLAME_SWORDSMAN).summonKind).toBe("special");
    expect(summonAfter(at(0, OcgLocation.GRAVE, 0, OcgPosition.FACEUP), PALADIN).summonKind).toBe("special");
    expect(summonAfter(at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), GIANT_RAT).summonKind).toBe("special");
    expect(observeDuelEvent(spsummon(GIANT_RAT, 4), cards, chain, 3, createEventContext())!.summonKind).toBe("special");
  });

  it("tags every monster of a Pendulum Summon and clears the flag when the summon completes", () => {
    const ctx = createEventContext();
    ctx.pendulumSummon = true;
    expect(summonAfter(at(0, OcgLocation.HAND, 0, OcgPosition.FACEDOWN), GIANT_RAT, ctx).summonKind).toBe("pendulum");
    expect(summonAfter(at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEUP), FLAME_SWORDSMAN, ctx).summonKind).toBe("pendulum");
    observeDuelEvent({ type: OcgMessageType.SPSUMMONED }, cards, chain, 9, ctx);
    expect(ctx.pendulumSummon).toBe(false);
    expect(summonAfter(at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEUP), FLAME_SWORDSMAN, ctx).summonKind).toBe("special");
  });

  it("recognises a Pendulum Summon from the Pendulum Zone card's summon action", () => {
    const idle: OcgMessage = {
      type: OcgMessageType.SELECT_IDLECMD, player: 0, summons: [], pos_changes: [], monster_sets: [], spell_sets: [], activates: [], to_bp: false, to_ep: true, shuffle: false,
      special_summons: [
        { code: GIANT_RAT, controller: 0, location: OcgLocation.HAND, sequence: 0 },
        { code: PALADIN, controller: 0, location: OcgLocation.SZONE, sequence: 6 },
      ],
    };
    const pending = mapPrompt(idle, cards, "p1");
    const answer = (choice: string): DuelAnswer => ({ choice });
    expect(isPendulumSummonAnswer(pending, answer("spsummon:0"))).toBe(false);
    expect(isPendulumSummonAnswer(pending, answer("spsummon:1"))).toBe(true);
    expect(isPendulumSummonAnswer(pending, answer("to_ep"))).toBe(false);
  });
});
