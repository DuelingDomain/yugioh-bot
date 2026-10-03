import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelFormat } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { directAttackSeat, mapPrompt } from "../src/prompts.js";
import { MSG_ATTACK_DUELIST, MSG_DUELIST_ELIMINATED, parseDuelistMessages, withoutDuelistParseWarnings } from "../src/raw-messages.js";
import {
  DUELIST_NONE,
  createEventContext,
  isNoDuelist,
  observeDuelEvent,
  observeMoveEvents,
  playerLabel,
  projectStoredEvent,
  type StoredChainLink,
} from "../src/views.js";

// Synthetic messages: a controller of 0xFF means "no duelist" when there are more than two duelists.

const info = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "warrior",
});
const cards: CardDatabase = {
  search: () => [], get: info, cardData: () => null, resolveLabel: () => "", system: () => undefined,
  victory: () => undefined, counter: () => undefined, readScript: () => null, close() {},
  deckCard: () => undefined, all: () => [], setnames: () => new Map(),
};
// The wrapper types a controller as 0 | 1, but the multi core writes seats up to 3 and 0xFF.
const place = (controller: number, location: OcgLocation, sequence: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK): never =>
  ({ controller, location, sequence, position }) as never;
const NONE = DUELIST_NONE;
const multiFormats: DuelFormat[] = ["ffa3", "ffa4"];

function summon(type: OcgMessageType, controller: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK): OcgMessage {
  return { type, code: 1, controller, location: OcgLocation.MZONE, sequence: 0, position } as OcgMessage;
}

describe("no duelist helpers", () => {
  it("0xFF is no duelist only with more than two duelists", () => {
    expect(isNoDuelist("ffa3", NONE)).toBe(true);
    expect(isNoDuelist("ffa4", NONE)).toBe(true);
    expect(isNoDuelist("ffa4", 3)).toBe(false);
    expect(isNoDuelist("1v1", NONE)).toBe(false);
    expect(isNoDuelist(undefined, NONE)).toBe(false);
    expect(playerLabel("ffa3", NONE)).toBe("No duelist");
    expect(playerLabel("ffa3", 2)).toBe("Player 3");
    expect(playerLabel("1v1", 1)).toBe("Player 2");
  });
});

describe.each(multiFormats)("%s: 0xFF controller in event messages", (format) => {
  it("MSG_MOVE with no duelist at either end: no seat, no zone, no out-of-range read, hand count untouched", () => {
    const ctx = createEventContext(format);
    const handBefore = [...ctx.handSize];
    const toHand: OcgMessage = { type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.HAND, 0), to: place(NONE, OcgLocation.HAND, 0, OcgPosition.FACEDOWN) };
    const out = observeMoveEvents(toHand, cards, ctx, 1);
    expect(ctx.handSize).toEqual(handBefore);
    expect(ctx.handSize).toHaveLength(handBefore.length);
    // Same controller and location: no event. A move into the grave has one, without a seat or a zone.
    expect(out).toEqual([]);
    const toGrave: OcgMessage = { type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.MZONE, 0), to: place(NONE, OcgLocation.GRAVE, 0, OcgPosition.FACEUP) };
    const [event] = observeMoveEvents(toGrave, cards, ctx, 2);
    expect(event!.seat).toBeUndefined();
    expect(event!.zone).toBeUndefined();
    expect(event!.from).toBeUndefined();
    const projected = projectStoredEvent(event!, 0);
    expect(projected.seat).toBeUndefined();
    expect(projected.zone).toBeUndefined();
  });

  it("MSG_MOVE from no duelist to a seat keeps the seat end", () => {
    const ctx = createEventContext(format);
    const move: OcgMessage = { type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.DECK, 0, OcgPosition.FACEDOWN), to: place(2, OcgLocation.HAND, 0, OcgPosition.FACEDOWN) };
    const [event] = observeMoveEvents(move, cards, ctx, 1);
    expect(event).toMatchObject({ seat: 2, zone: { controller: 2, location: OcgLocation.HAND } });
    expect(event!.from).toBeUndefined();
    expect(ctx.handSize[2]).toBe(1);
  });

  it("MSG_MOVE off the field with no duelist: the hand sizes have no stray entry", () => {
    const ctx = createEventContext(format);
    const length = ctx.handSize.length;
    const move: OcgMessage = { type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.MZONE, 1), to: place(0, OcgLocation.GRAVE, 0, OcgPosition.FACEUP) };
    expect(observeDuelEvent(move, cards, [], 1, ctx)).toBeNull();
    expect(ctx.handSize).toHaveLength(length);
    expect(ctx.pendingMoves).toHaveLength(1);
  });

  it.each([OcgMessageType.SUMMONING, OcgMessageType.SPSUMMONING, OcgMessageType.FLIPSUMMONING])("summon message %i", (type) => {
    const ctx = createEventContext(format);
    const length = ctx.handSize.length;
    const stored = observeDuelEvent(summon(type, NONE), cards, [], 1, ctx)!;
    expect(stored.seat).toBeUndefined();
    expect(stored.zone).toBeUndefined();
    expect(stored.text).toContain("No duelist");
    expect(stored.text).not.toContain("256");
    expect(ctx.handSize).toHaveLength(length);
  });

  it("a Tribute material MOVE (MOVE reason) from no duelist marks the next Normal Summon as a Tribute Summon", () => {
    const ctx = createEventContext(format);
    const length = ctx.handSize.length;
    // REASON_RELEASE | REASON_MATERIAL | REASON_SUMMON, parsed by patches/ocgcore-wasm+0.1.2.patch.
    const release = { type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.MZONE, 1), to: place(NONE, OcgLocation.GRAVE, 0, OcgPosition.FACEUP), reason: 0x1a } as unknown as OcgMessage;
    expect(() => observeMoveEvents(release, cards, ctx, 1)).not.toThrow();
    expect(ctx.summonTribute).toBe(true);
    expect(ctx.handSize).toHaveLength(length);
    const stored = observeDuelEvent(summon(OcgMessageType.SUMMONING, NONE), cards, [], 2, ctx)!;
    expect(stored.summonKind).toBe("tribute");
    expect(stored.seat).toBeUndefined();
    expect(stored.text).toContain("No duelist");
    // A material reason without the summon bits is not a Tribute.
    const other = createEventContext(format);
    observeMoveEvents({ ...release, reason: 0x2 } as unknown as OcgMessage, cards, other, 1);
    expect(other.summonTribute).toBe(false);
  });

  it("a face-down summon with no duelist is visible to nobody", () => {
    const stored = observeDuelEvent(summon(OcgMessageType.SPSUMMONING, NONE, OcgPosition.FACEDOWN_DEFENSE), cards, [], 1, createEventContext(format))!;
    expect(stored.revealCardTo).toEqual([]);
    for (const viewer of [null, 0, 1, 2]) expect(projectStoredEvent(stored, viewer).card).toBeUndefined();
    expect(stored.publicText).not.toContain("256");
  });

  it("SET, POS_CHANGE and CHAINING with no duelist", () => {
    const ctx = createEventContext(format);
    const set = observeDuelEvent({ type: OcgMessageType.SET, code: 1, controller: NONE, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEDOWN } as unknown as OcgMessage, cards, [], 1, ctx)!;
    expect(set).toMatchObject({ kind: "set", revealCardTo: [] });
    expect(set.seat).toBeUndefined();
    expect(set.zone).toBeUndefined();
    const pos = observeDuelEvent({
      type: OcgMessageType.POS_CHANGE, code: 1, controller: NONE, location: OcgLocation.MZONE, sequence: 0,
      prev_position: OcgPosition.FACEDOWN_DEFENSE, position: OcgPosition.FACEUP_ATTACK,
    } as unknown as OcgMessage, cards, [], 2, ctx)!;
    expect(pos.seat).toBeUndefined();
    expect(pos.zone).toBeUndefined();
    const chain: StoredChainLink[] = [];
    const chaining = observeDuelEvent({
      type: OcgMessageType.CHAINING, code: 1, controller: NONE, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP,
      description: 0n, chain_size: 1,
    } as unknown as OcgMessage, cards, chain, 3, ctx)!;
    expect(chaining.seat).toBeUndefined();
    expect(chaining.zone).toBeUndefined();
    // The chain memory keeps the value; the chain-link events built from it name no seat.
    const resolving = observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 } as OcgMessage, cards, chain, 4, ctx)!;
    expect(resolving.seat).toBeUndefined();
  });

  it("ATTACK with no duelist as the attacker or as the target", () => {
    const ctx = createEventContext(format);
    const attacker: OcgMessage = {
      type: OcgMessageType.ATTACK, card: place(NONE, OcgLocation.MZONE, 0), target: place(NONE, OcgLocation.MZONE, 1),
    } as OcgMessage;
    const stored = observeDuelEvent(attacker, cards, [], 1, ctx)!;
    expect(stored.seat).toBeUndefined();
    expect(stored.zone).toBeUndefined();
    expect(stored.target).toBeUndefined();
    expect(stored.text).not.toContain("256");
    const direct = observeDuelEvent({ type: OcgMessageType.ATTACK, card: place(1, OcgLocation.MZONE, 0), target: null } as unknown as OcgMessage, cards, [], 2, ctx)!;
    expect(direct).toMatchObject({ seat: 1, zone: { controller: 1 } });
    expect(direct.target).toBeUndefined();
  });

  it("a destroy with reason player 0xFF names no source seat", () => {
    const ctx = createEventContext(format);
    // controller:location:sequence:reason:rcode:rtype:rplayer (REASON_RULE | REASON_DESTROY, no reason card).
    ctx.destroyNotes.push(`0:${OcgLocation.MZONE}:0:${0x400 | 1}:0:0:${NONE}`);
    ctx.destroyNotes.push(`0:${OcgLocation.MZONE}:1:${0x40 | 1}:77:1:${NONE}`);
    const rule = observeDuelEvent({ type: OcgMessageType.MOVE, card: 5, from: place(0, OcgLocation.MZONE, 0), to: place(0, OcgLocation.GRAVE, 0, OcgPosition.FACEUP) }, cards, [], 1, ctx)!;
    expect(rule).toMatchObject({ kind: "destroy", cause: "rule" });
    expect(rule.sourceSeat).toBeUndefined();
    const effect = observeDuelEvent({ type: OcgMessageType.MOVE, card: 6, from: place(0, OcgLocation.MZONE, 1), to: place(0, OcgLocation.GRAVE, 1, OcgPosition.FACEUP) }, cards, [], 2, ctx)!;
    expect(effect).toMatchObject({ kind: "destroy", cause: "effect", sourceCode: 77 });
    expect(effect.sourceSeat).toBeUndefined();
  });

  it("a destroy of a card with no duelist names no seat and no zone", () => {
    const ctx = createEventContext(format);
    ctx.destroyNotes.push(`${NONE}:${OcgLocation.MZONE}:0:${0x20 | 1}:0:0:0`);
    const stored = observeDuelEvent({ type: OcgMessageType.MOVE, card: 5, from: place(NONE, OcgLocation.MZONE, 0), to: place(NONE, OcgLocation.GRAVE, 0, OcgPosition.FACEUP) }, cards, [], 1, ctx)!;
    expect(stored.kind).toBe("destroy");
    expect(stored.seat).toBeUndefined();
    expect(stored.zone).toBeUndefined();
  });
});

describe("n == 2 does not change", () => {
  it("values 0 and 1 and the event shape stay as before, a seat-like value is read as a seat", () => {
    const ctx = createEventContext("1v1");
    const stored = observeDuelEvent(summon(OcgMessageType.SUMMONING, 1), cards, [], 1, ctx)!;
    expect(stored).toMatchObject({ seat: 1, zone: { controller: 1, location: OcgLocation.MZONE, sequence: 0 } });
    expect(stored.text).toBe("Player 2 Normal Summons Card 1");
    // At two duelists the core never writes 0xFF, so nothing there is read as "no duelist".
    const odd = observeDuelEvent(summon(OcgMessageType.SUMMONING, NONE), cards, [], 2, ctx)!;
    expect(odd.seat).toBe(NONE);
    const move = observeMoveEvents({ type: OcgMessageType.MOVE, card: 5, from: place(0, OcgLocation.DECK, 0), to: place(1, OcgLocation.HAND, 0) }, cards, ctx, 3);
    expect(move[0]).toMatchObject({ seat: 1, from: { controller: 0 }, zone: { controller: 1 } });
  });
});

describe("prompts with a 0xFF controller", () => {
  it("SELECT_EFFECTYN about a card with no duelist uses the answering seat and no zone", () => {
    const message = {
      type: OcgMessageType.SELECT_EFFECTYN, player: 2, code: 9, controller: NONE, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP, description: 0n,
    } as unknown as OcgMessage;
    const built = mapPrompt(message, cards, "p1");
    expect(built.prompt.source).toMatchObject({ code: 9, seat: 2 });
    expect(built.prompt.source?.zone).toBeUndefined();
  });

  it("SELECT_EFFECTYN about a card of a seat keeps seat and zone", () => {
    const message = {
      type: OcgMessageType.SELECT_EFFECTYN, player: 2, code: 9, controller: 1, location: OcgLocation.GRAVE, sequence: 3, position: OcgPosition.FACEUP, description: 0n,
    } as unknown as OcgMessage;
    expect(mapPrompt(message, cards, "p1").prompt.source).toMatchObject({ seat: 1, zone: { controller: 1, location: OcgLocation.GRAVE, sequence: 3 } });
  });

  it("a direct attack pick for duelist 0xFF is not a seat", () => {
    expect(directAttackSeat(0xffff0000 + 2)).toBe(2);
    expect(directAttackSeat(BigInt(0xffff0000 + NONE))).toBeNull();
  });
});

describe("raw 200 and 201 with duelist 0xFF", () => {
  const message = (...bytes: number[]) => [bytes.length, 0, 0, 0, ...bytes];

  it("MSG_ATTACK_DUELIST (201) keeps the value 255 for the engine to treat as no duelist", () => {
    const parsed = parseDuelistMessages(Uint8Array.from([...message(40, 1), ...message(MSG_ATTACK_DUELIST, NONE)]));
    expect(parsed.extras).toEqual([{ type: MSG_ATTACK_DUELIST, duelist: NONE, after: 1 }]);
  });

  it("MSG_DUELIST_ELIMINATED (200) with 0xFF parses", () => {
    expect(parseDuelistMessages(Uint8Array.from(message(MSG_DUELIST_ELIMINATED, NONE, 2))).extras).toEqual([
      { type: MSG_DUELIST_ELIMINATED, duelist: NONE, reason: 2, after: 0 },
    ]);
  });

  it("a 201 message with trailing bytes still parses (the core may widen the message)", () => {
    expect(parseDuelistMessages(Uint8Array.from(message(MSG_ATTACK_DUELIST, 3, 0, 0))).extras).toEqual([
      { type: MSG_ATTACK_DUELIST, duelist: 3, after: 0 },
    ]);
  });
});

describe("wrapper parse warning for ids 200, 201 and 202", () => {
  const original = console.warn;
  afterEach(() => {
    console.warn = original;
  });

  it("drops only the three warnings of the ids the tap reads", () => {
    const seen: string[] = [];
    console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
    const result = withoutDuelistParseWarnings(() => {
      for (const id of [200, 201, 202, 203, 41]) console.warn(`failed to parse a message: ${id}`);
      console.warn("failed to parse a message: 7 (boom)");
      console.warn("another warning");
      return 42;
    });
    expect(result).toBe(42);
    expect(seen).toEqual([
      "failed to parse a message: 203",
      "failed to parse a message: 41",
      "failed to parse a message: 7 (boom)",
      "another warning",
    ]);
  });

  it("restores console.warn when the read throws", () => {
    const spy = vi.fn();
    console.warn = spy;
    expect(() => withoutDuelistParseWarnings(() => { throw new Error("read failed"); })).toThrow("read failed");
    expect(console.warn).toBe(spy);
  });
});
