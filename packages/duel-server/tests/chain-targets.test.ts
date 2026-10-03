import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgLocPos, type OcgMessage } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { CHAIN_TARGET_NOTE_SCRIPT, createEventContext, noteChainTargetLog, observeDuelEvent, observeChainTargetEvents, projectStoredEvent, resetEventBatch, type StoredChainLink } from "../src/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { targetingResponseGame } from "./helpers/target-response.js";
import { retargetMessages } from "./helpers/retargeting.js";

const cards = loadCardDatabase(engineDataDirectory);
const source = { controller: 0 as const, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK };
const target = { controller: 1 as const, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE };
const other = { ...target, sequence: 1 };
const zone = (place: OcgLocPos) => ({ controller: place.controller, location: place.location, sequence: place.sequence });
function start(): StoredChainLink[] {
  const chain: StoredChainLink[] = [];
  observeDuelEvent({ type: OcgMessageType.CHAINING, code: 5318639, ...source,
    description: 0n, chain_size: 1, triggering_controller: 0,
    triggering_location: OcgLocation.SZONE, triggering_sequence: 0 }, cards, chain, 1);
  return chain;
}
const note = (chain: StoredChainLink[], message: OcgMessage) => observeChainTargetEvents(message, chain, 2);
const select = (chain: StoredChainLink[], places: OcgLocPos[] = [target]) => note(chain, { type: OcgMessageType.BECOME_TARGET, cards: places });

describe("chain target tracking", () => {
  it("handles the stock core's empty ChangeTargetCard message while Dianaira replaces CL1 after CL2 resolves", async () => {
    const { messages, notes } = await retargetMessages("dianaira", CHAIN_TARGET_NOTE_SCRIPT);
    expect(messages.filter((message) => message.type === OcgMessageType.CHAINING).map((message) => message.code)).toEqual([83764718, 5318639]);
    const chain: StoredChainLink[] = [];
    const ctx = createEventContext();
    expect(notes).toEqual(["YGD:CHAIN_TARGET:1;"]);
    for (const note of notes) expect(noteChainTargetLog(ctx, note)).toBe(true);
    let sawReplacement = false;
    for (const message of messages) {
      observeDuelEvent(message, cards, chain, 1, ctx);
      const events = observeChainTargetEvents(message, chain, 2, ctx);
      if (message.type === OcgMessageType.BECOME_TARGET && message.cards.length === 0) {
        sawReplacement = true;
        expect(events).toMatchObject([{ kind: "target", chainIndex: 1, targets: [] }]);
        expect(chain[0].targets).toEqual([]);
        expect(chain[1].targets).toHaveLength(1);
      }
    }
    expect(sawReplacement).toBe(true);
  });

  it("retargets CL1 when stock Shift changes it while CL2 is resolving", async () => {
    const stock = await retargetMessages("shift");
    const { messages, notes } = await retargetMessages("shift", CHAIN_TARGET_NOTE_SCRIPT);
    // Reporting must preserve the stock core's entire message stream and resulting moves.
    expect(messages).toEqual(stock.messages);
    expect(messages.filter((message) => message.type === OcgMessageType.CHAINING).map((message) => message.code)).toEqual([14087893, 59560625]);
    const chain: StoredChainLink[] = [];
    const ctx = createEventContext();
    expect(notes).toEqual(["YGD:CHAIN_TARGET:1;1:4:1"]);
    for (const note of notes) expect(noteChainTargetLog(ctx, note)).toBe(true);
    let replaced = false;
    for (const message of messages) {
      observeDuelEvent(message, cards, chain, 1, ctx);
      if (message.type === OcgMessageType.CHAIN_SOLVING && message.chain_size === 2) {
        // A note from later in the buffered batch must not replace a construction announcement.
        expect(chain[0].targets).toEqual([{ controller: 1, location: 4, sequence: 0 }]);
        expect(ctx.chainTargetNotes).toHaveLength(1);
      }
      const events = observeChainTargetEvents(message, chain, 2, ctx);
      if (message.type === OcgMessageType.BECOME_TARGET && ctx.resolving) {
        replaced = true;
        expect(ctx.resolving.index).toBe(2);
        expect(events).toMatchObject([{ chainIndex: 1, targets: [{ controller: 1, location: 4, sequence: 1 }] }]);
        expect(chain[0].targets).toEqual([{ controller: 1, location: 4, sequence: 1 }]);
        expect(chain[1].targets).toEqual([{ controller: 1, location: 4, sequence: 1 }]);
        for (const viewer of [0, 1, null]) expect(projectStoredEvent(events[0], viewer)).toEqual({
          id: 2, kind: "target", chainIndex: 1, seat: 0,
          text: "Chain Link 1 targets 1 card", targets: [{ controller: 1, location: 4, sequence: 1 }],
        });
      }
    }
    expect(replaced).toBe(true);
  });

  it("does not let unmatched retarget notes survive a prompt or a chain end", () => {
    const ctx = createEventContext();
    expect(noteChainTargetLog(ctx, "YGD:CHAIN_TARGET:1;1:8:0")).toBe(true);
    resetEventBatch(ctx);
    expect(ctx.chainTargetNotes).toEqual([]);
    noteChainTargetLog(ctx, "YGD:CHAIN_TARGET:1;");
    observeDuelEvent({ type: OcgMessageType.CHAIN_END }, cards, start(), 1, ctx);
    expect(ctx.chainTargetNotes).toEqual([]);
  });

  it("ignores malformed internal notes and unrelated engine logs", () => {
    const ctx = createEventContext();
    expect(noteChainTargetLog(ctx, "ordinary engine log")).toBe(false);
    for (const note of ["0;1:8:0", "1;2:8:0", "1;1:8", "1;1:8:-1", "1"]) {
      expect(noteChainTargetLog(ctx, `YGD:CHAIN_TARGET:${note}`)).toBe(true);
    }
    expect(ctx.chainTargetNotes).toEqual([]);
  });

  it.each([{ replacement: [other] }, { replacement: [] }])("replaces the resolving link's targets with $replacement, leaving the newest link alone", ({ replacement }) => {
    const chain = start();
    select(chain);
    observeDuelEvent({ type: OcgMessageType.CHAINING, code: 5318639, ...other,
      description: 0n, chain_size: 2, triggering_controller: 1,
      triggering_location: OcgLocation.SZONE, triggering_sequence: 1 }, cards, chain, 3);
    select(chain, [source]);
    const ctx = createEventContext();
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 2 }, cards, chain, 4, ctx);
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVED, chain_size: 2 }, cards, chain, 5, ctx);
    observeDuelEvent({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 }, cards, chain, 6, ctx);
    const events = observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: replacement }, chain, 7, ctx);
    expect(chain.map((link) => link.targets)).toEqual([replacement.map(zone), [zone(source)]]);
    expect(events).toMatchObject([{ chainIndex: 1, targets: replacement.map(zone) }]);
    for (const viewer of [0, 1, null]) expect(projectStoredEvent(events[0], viewer).targets).toEqual(replacement.map(zone));
  });

  it("clears grave/deck/extra tracking only for the seat whose grave and deck swap", () => {
    const chain = start();
    select(chain, [
      { ...target, location: OcgLocation.DECK }, { ...target, location: OcgLocation.GRAVE },
      { ...target, location: OcgLocation.EXTRA }, { ...source, location: OcgLocation.DECK }, other,
    ]);
    const events = note(chain, { type: OcgMessageType.SWAP_GRAVE_DECK, player: 1, deck_size: 3, returned_to_extra: [0] });
    expect(chain[0].targets).toEqual([{ controller: 0, location: 1, sequence: 0 }, zone(other)]);
    expect(events[0].targets).toEqual(chain[0].targets);
  });

  it("removes vanished cards and compacts pile coordinates once for a bulk removal", () => {
    const chain = start();
    const grave = { ...target, location: OcgLocation.GRAVE };
    select(chain, [target, other, grave, { ...grave, sequence: 2 }, { ...grave, sequence: 4 }]);
    const events = note(chain, { type: OcgMessageType.REMOVE_CARDS, cards: [target, { ...grave, sequence: 3 }, { ...grave, sequence: 0 }] });
    expect(events[0].targets).toEqual([zone(other), { controller: 1, location: 16, sequence: 1 }, { controller: 1, location: 16, sequence: 2 }]);
    note(chain, { type: OcgMessageType.MOVE, card: 53582587, from: source, to: target });
    expect(chain[0].targets).toEqual(events[0].targets);
  });

  it("clears both players' deck targets on reversal without exposing deck order", () => {
    const chain = start();
    select(chain, [{ ...target, location: OcgLocation.DECK }, { ...source, location: OcgLocation.DECK }, other]);
    expect(note(chain, { type: OcgMessageType.REVERSE_DECK })[0].targets).toEqual([zone(other)]);
  });

  it("keeps coordinates on DECK_TOP, which reveals a card without changing its slot", () => {
    const chain = start();
    select(chain, [{ ...target, location: OcgLocation.DECK }, other]);
    expect(note(chain, { type: OcgMessageType.DECK_TOP, player: 1, count: 0, code: 44095762, position: OcgPosition.FACEUP_ATTACK })).toEqual([]);
    expect(chain[0].targets).toEqual([{ controller: 1, location: 1, sequence: 0 }, zone(other)]);
  });

  it("clears deck targets on DRAW, which moves cards without MOVE messages", () => {
    const chain = start();
    select(chain, [{ ...target, location: OcgLocation.DECK }, { ...source, location: OcgLocation.DECK }, other]);
    expect(note(chain, { type: OcgMessageType.DRAW, player: 1, drawn: [{ code: 44095762, position: OcgPosition.FACEDOWN_DEFENSE }] })[0].targets)
      .toEqual([{ controller: 0, location: 1, sequence: 0 }, zone(other)]);
  });

  it("clears replaced private piles on TAG_SWAP and all coordinates on RELOAD_FIELD", () => {
    const chain = start();
    select(chain, [{ ...target, location: OcgLocation.DECK }, { ...target, location: OcgLocation.HAND },
      { ...target, location: OcgLocation.EXTRA }, source, other]);
    expect(note(chain, { type: OcgMessageType.TAG_SWAP, player: 1, deck_size: 2,
      extra_faceup_count: 0, deck_top_card: null, hand: [], extra: [] })[0].targets).toEqual([zone(source), zone(other)]);
    expect(note(chain, { type: OcgMessageType.RELOAD_FIELD } as OcgMessage)[0].targets).toEqual([]);
  });

  it("accumulates separate BECOME_TARGET messages, deduplicates, and clears for a new chain", () => {
    const chain = start();
    select(chain);
    select(chain, [other, target]);
    expect(chain[0].targets).toEqual([zone(target), zone(other)]);
    observeDuelEvent({ type: OcgMessageType.CHAIN_END }, cards, chain, 3);
    expect(chain).toEqual([]);
    expect(select(chain)).toEqual([]);
    expect(start()[0].targets).toEqual([]);
  });

  it.each([0, 1, null])("publishes only target coordinates to viewer %s, even if a message carries identity", (viewer) => {
    const chain = start();
    const event = select(chain, [{ ...target, code: 44095762 } as typeof target])[0];
    expect(projectStoredEvent(event, viewer)).toEqual({ id: 2, kind: "target", seat: 0,
      chainIndex: 1, text: "Chain Link 1 targets 1 card", targets: [zone(target)] });
    expect(chain[0].targets).toEqual([zone(target)]);
  });

  it("follows a target's public move without marking a replacement in its old zone", () => {
    const chain = start();
    select(chain);
    const to = { ...target, location: OcgLocation.GRAVE, sequence: 2, position: OcgPosition.FACEUP_ATTACK };
    const updates = note(chain, { type: OcgMessageType.MOVE, card: 44095762, from: target, to });
    expect(chain[0].targets).toEqual([{ controller: 1, location: 16, sequence: 2 }]);
    expect(updates[0].targets).toEqual([{ controller: 1, location: 16, sequence: 2 }]);
    note(chain, { type: OcgMessageType.MOVE, card: 53582587, from: other, to: target });
    expect(chain[0].targets).toEqual([{ controller: 1, location: 16, sequence: 2 }]);
  });

  it("shifts targets when another card leaves their pile and swaps field targets together", () => {
    const chain = start();
    const grave = { ...target, location: OcgLocation.GRAVE, sequence: 2 };
    select(chain, [grave]);
    note(chain, { type: OcgMessageType.MOVE, card: 1, from: { ...grave, sequence: 0 }, to: other });
    expect(chain[0].targets).toEqual([{ controller: 1, location: 16, sequence: 1 }]);
    const fresh = start();
    select(fresh, [target, other]);
    note(fresh, { type: OcgMessageType.SWAP, card1: { ...target, code: 1 }, card2: { ...other, code: 2 } });
    expect(fresh[0].targets).toEqual([zone(other), zone(target)]);
  });

  it("removes a vanished target instead of marking a newly created card", () => {
    const chain = start();
    select(chain);
    note(chain, { type: OcgMessageType.MOVE, card: 1, from: target, to: { ...target, location: 0 as OcgLocation } });
    expect(chain[0].targets).toEqual([]);
  });

  it("clears shuffled hidden targets for every viewer instead of tracking their hidden order", () => {
    const chain = start();
    select(chain);
    const updates = note(chain, { type: OcgMessageType.SHUFFLE_SET_CARD, location: OcgLocation.SZONE,
      cards: [{ from: target, to: other }] });
    for (const viewer of [0, 1, null]) expect(projectStoredEvent(updates[0], viewer).targets).toEqual([]);
    expect(chain[0].targets).toEqual([]);
  });

  it("keeps targets outside the shuffled set, including targets on the other seat's field", () => {
    const chain = start();
    select(chain, [target, other, source]);
    const updates = note(chain, { type: OcgMessageType.SHUFFLE_SET_CARD, location: OcgLocation.SZONE,
      cards: [{ from: target, to: { ...target, sequence: 2 } }] });
    expect(updates[0].targets).toEqual([zone(other), zone(source)]);
  });

  it.each([
    [OcgMessageType.SHUFFLE_DECK, OcgLocation.DECK],
    [OcgMessageType.SHUFFLE_HAND, OcgLocation.HAND],
    [OcgMessageType.SHUFFLE_EXTRA, OcgLocation.EXTRA],
  ] as const)("erases hidden tracking on message %s only for the shuffled seat and location", (type, location) => {
    const chain = start();
    select(chain, [{ ...target, location }, { ...source, location }, other]);
    const update = note(chain, { type, player: 1, cards: [] } as OcgMessage)[0];
    expect(update.targets).toEqual([{ controller: 0, location, sequence: 0 }, zone(other)]);
    for (const viewer of [0, 1, null]) expect(projectStoredEvent(update, viewer).card).toBeUndefined();
  });

  it("updates every link targeting a moved card and keeps previously published events immutable", () => {
    const chain = start();
    const original = select(chain)[0];
    observeDuelEvent({ type: OcgMessageType.CHAINING, code: 5318639, ...other,
      description: 0n, chain_size: 2, triggering_controller: 1,
      triggering_location: OcgLocation.SZONE, triggering_sequence: 1 }, cards, chain, 3);
    select(chain);
    const moved = { ...target, controller: 0 as const, sequence: 3 };
    const updates = note(chain, { type: OcgMessageType.MOVE, card: 44095762, from: target, to: moved });
    expect(updates.map((event) => [event.chainIndex, event.targets])).toEqual([
      [1, [{ controller: 0, location: 8, sequence: 3 }]], [2, [{ controller: 0, location: 8, sequence: 3 }]],
    ]);
    expect(original.targets).toEqual([zone(target)]);
  });

  it("clears the real two-link chain after both responders pass", async () => {
    const game = await targetingResponseGame(true);
    try {
      expect(game.view(0).chain.map((link) => link.targets)).toEqual([
        [{ controller: 1, location: 8, sequence: 0 }], [{ controller: 0, location: 8, sequence: 0 }],
      ]);
      for (let step = 0; step < 10 && game.view(null).chain.length > 0; step++) {
        const seat = game.view(0).prompt ? 0 : 1;
        const prompt = game.view(seat).prompt!;
        game.answer(seat, prompt.id, prompt.cancelable ? { cancel: true } : { choice: "no" });
      }
      for (const viewer of [0, 1, null]) {
        const view = game.view(viewer);
        expect(view.chain).toEqual([]);
        expect(view.events.some((event) => event.kind === "chain-end")).toBe(true);
        const movedTargets = view.events.filter((event) => event.kind === "target" && event.chainIndex === 2).at(-1);
        expect(movedTargets?.targets).toEqual([{ controller: 0, location: 16, sequence: 0 }]);
        expect(movedTargets?.card).toBeUndefined();
      }
    } finally { game.close(); }
  });
});
