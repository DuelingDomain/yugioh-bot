import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { chainTargetPhrase, parseTargetCardNote, publicTargetLabel, TARGET_CARD_NOTE_PREFIX, type TargetVisibility } from "../src/target-names.js";
import { isNegatedOnField as isNegatedMulti } from "../src/views.js";
import { isNegatedOnField as isNegatedLegacy } from "../src/legacy/views.js";
import * as mainViews from "../src/views.js";
import * as legacyViews from "../src/legacy/views.js";
import type { CardDatabase } from "../src/cards.js";

const names: Record<number, string> = { 46986414: "Dark Magician", 89631139: "Blue-Eyes White Dragon", 70781052: "Summoned Skull" };
const cards: CardDatabase = {
  get: (code) => names[code] ? { code, name: names[code]!, description: "", type: 1, attack: 0, defense: 0, level: 6, attribute: 1, race: "" } : undefined,
  search: () => [], deckCard: () => undefined, all: () => [], setnames: () => new Map(), cardData: () => null,
  resolveLabel: () => "", system: () => undefined, victory: () => undefined, counter: () => undefined,
  readScript: () => null, close() {},
};

describe("target names", () => {
  it("parses a note and rejects malformed ones", () => {
    expect(parseTargetCardNote(`${TARGET_CARD_NOTE_PREFIX}2:4:1:70405001:1`)).toEqual({ controller: 2, location: 4, sequence: 1, code: 70405001, position: 1 });
    expect(parseTargetCardNote(`${TARGET_CARD_NOTE_PREFIX}2:4:1:70405001`)).toBeNull();
    expect(parseTargetCardNote(`${TARGET_CARD_NOTE_PREFIX}a:4:1:70405001:1`)).toBeNull();
    expect(parseTargetCardNote("YGD:CHAIN_TARGET:1;")).toBeNull();
  });

  it("names only what the table can see", () => {
    expect(publicTargetLabel({ location: OcgLocation.MZONE, position: OcgPosition.FACEUP_ATTACK, name: "Black Luster Soldier" })).toBe("Black Luster Soldier");
    expect(publicTargetLabel({ location: OcgLocation.SZONE, position: OcgPosition.FACEDOWN, name: "Mirror Force" })).toBe("a face-down card");
    expect(publicTargetLabel({ location: OcgLocation.MZONE, position: OcgPosition.FACEDOWN_DEFENSE, name: "Dark Magician" })).toBe("a face-down card");
    expect(publicTargetLabel({ location: OcgLocation.GRAVE, position: OcgPosition.FACEDOWN, name: "Monster Reborn" })).toBe("Monster Reborn");
    expect(publicTargetLabel({ location: OcgLocation.REMOVED, position: OcgPosition.FACEDOWN, name: "Secret" })).toBe("a face-down card");
    expect(publicTargetLabel({ location: OcgLocation.HAND, position: OcgPosition.FACEDOWN, name: "Secret" })).toBe("a card");
    expect(publicTargetLabel({ location: OcgLocation.MZONE, position: OcgPosition.FACEUP_ATTACK })).toBe("a card");
  });

  it("joins the targets into a phrase and falls back to the count", () => {
    expect(chainTargetPhrase(["A"], 1)).toBe("A");
    expect(chainTargetPhrase(["A", "B"], 2)).toBe("A and B");
    expect(chainTargetPhrase(["A", "a face-down card", "C"], 3)).toBe("A, a face-down card and C");
    expect(chainTargetPhrase([undefined], 1)).toBe("1 card");
    expect(chainTargetPhrase([undefined, undefined], 2)).toBe("2 cards");
    expect(chainTargetPhrase([], 0)).toBe("0 cards");
    expect(chainTargetPhrase(["A", undefined], 2)).toBe("A and a card");
  });

  it("does not treat mixed face-up and face-down target flags as public", () => {
    expect(publicTargetLabel({
      location: OcgLocation.MZONE,
      position: OcgPosition.FACEUP_ATTACK | OcgPosition.FACEDOWN_DEFENSE,
      name: "Summoned Skull",
    })).toBe("a face-down card");
  });

  it("does not treat overlay or combined locations as a public field slot", () => {
    for (const location of [OcgLocation.MZONE | OcgLocation.OVERLAY, OcgLocation.MZONE | OcgLocation.HAND, 0, 0x4000]) {
      expect(publicTargetLabel({ location, position: OcgPosition.FACEUP_ATTACK, name: "Summoned Skull" })).toBe("a card");
    }
  });
});

function targetTrackingTests<Context>(name: string, views: {
  createEventContext(): Context & { targetVisibility?: (zone: mainViews.StoredChainLink["zone"]) => TargetVisibility };
  noteTargetCardLog(ctx: Context, text: string): boolean;
  nameLinkTargets(ctx: Context, link: mainViews.StoredChainLink, cards: CardDatabase): boolean;
  observeChainTargetEvents(message: OcgMessage, chain: mainViews.StoredChainLink[], id: number, ctx?: Context, cards?: CardDatabase): mainViews.StoredDuelEvent[];
  linkTargetPhrase(link: mainViews.StoredChainLink): string;
  snapshotLinkTargets(link: mainViews.StoredChainLink): mainViews.StoredChainLink;
  targetEventText(link: mainViews.StoredChainLink, viewer?: number | null): string;
  targetEventLabels(link: mainViews.StoredChainLink, viewer?: number | null): string[];
  updateTargetEvent(event: mainViews.StoredDuelEvent, link: mainViews.StoredChainLink): void;
  projectStoredEvent(event: mainViews.StoredDuelEvent, viewer: number | null): unknown;
}) {
  describe(`target tracking (${name})`, () => {
    function context() {
      const ctx = views.createEventContext();
      // Explicit query snapshots for these public-target tracking fixtures, independent of Lua notes.
      ctx.targetVisibility = (zone) => new Map([0, 1, null].map((viewer) => [viewer, zone.sequence === 0 ? 46986414 : 89631139]));
      return ctx;
    }
    const grave = (sequence: number) => ({ controller: 0 as const, location: OcgLocation.GRAVE, sequence });
    const field = (sequence: number) => ({ controller: 0 as const, location: OcgLocation.MZONE, sequence });
    const link = (): mainViews.StoredChainLink => ({ index: 1, seat: 0, code: 83764718, zone: field(0), targets: [] });

    it("keeps each target's name through graveyard compaction, a move and a swap", () => {
      const ctx = context();
      const chain = [link()];
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:16:0:46986414:1`);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:16:1:89631139:1`);
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...grave(0), position: OcgPosition.FACEUP_ATTACK }, { ...grave(1), position: OcgPosition.FACEUP_ATTACK }] }, chain, 1, ctx, cards);
      views.nameLinkTargets(ctx, chain[0]!, cards);
      expect(views.linkTargetPhrase(chain[0]!)).toBe("Dark Magician and Blue-Eyes White Dragon");
      views.observeChainTargetEvents({ type: OcgMessageType.MOVE, card: 46986414, from: { ...grave(0), position: 1 }, to: { ...field(0), position: 1 } }, chain, 2, ctx, cards);
      expect(chain[0]!.targets).toEqual([field(0), grave(0)]);
      expect(views.linkTargetPhrase(chain[0]!)).toBe("Dark Magician and Blue-Eyes White Dragon");
      views.observeChainTargetEvents({ type: OcgMessageType.SWAP, card1: { ...field(0), code: 46986414, position: 1 }, card2: { ...grave(0), code: 89631139, position: 1 } }, chain, 3, ctx, cards);
      expect(views.linkTargetPhrase(chain[0]!)).toBe("Dark Magician and Blue-Eyes White Dragon");
    });

    it("still matches a late name to the original card after its coordinates change", () => {
      const ctx = context();
      const chain = [link()];
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...grave(1), position: OcgPosition.FACEUP_ATTACK }] }, chain, 1, ctx, cards);
      views.observeChainTargetEvents({ type: OcgMessageType.REMOVE_CARDS, cards: [{ ...grave(0), position: OcgPosition.FACEUP_ATTACK }] }, chain, 2, ctx, cards);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:16:1:89631139:1`);
      expect(views.nameLinkTargets(ctx, chain[0]!, cards)).toBe(true);
      expect(chain[0]!.targets).toEqual([grave(0)]);
      expect(views.linkTargetPhrase(chain[0]!)).toBe("Blue-Eyes White Dragon");
    });

    it("settles the original two-target announcement after both cards move and their hidden pile shuffles", () => {
      const ctx = context();
      const chain = [link()];
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...grave(0), position: OcgPosition.FACEUP_ATTACK }, { ...grave(1), position: OcgPosition.FACEUP_ATTACK }] }, chain, 1, ctx, cards);
      const announcement = views.snapshotLinkTargets(chain[0]!);
      const hand = { controller: 0 as const, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE };
      views.observeChainTargetEvents({ type: OcgMessageType.MOVE, card: 46986414, from: { ...grave(0), position: 1 }, to: hand }, chain, 2, ctx, cards);
      views.observeChainTargetEvents({ type: OcgMessageType.MOVE, card: 89631139, from: { ...grave(0), position: 1 }, to: { ...hand, sequence: 1 } }, chain, 3, ctx, cards);
      views.observeChainTargetEvents({ type: OcgMessageType.SHUFFLE_HAND, player: 0, cards: [] }, chain, 4, ctx, cards);
      expect(chain[0]!.targets).toEqual([]);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:16:0:46986414:1`);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:16:1:89631139:1`);
      expect(views.nameLinkTargets(ctx, announcement, cards)).toBe(true);
      expect(announcement.targets).toEqual([grave(0), grave(1)]);
      expect(views.targetEventText(announcement)).toBe("Chain Link 1 targets Dark Magician and Blue-Eyes White Dragon");
      expect(views.targetEventLabels(announcement)).toEqual(["Dark Magician", "Blue-Eyes White Dragon"]);
    });

    it("settles cumulative announcements without adding later targets to the earlier wording", () => {
      const ctx = context();
      const chain = [link()];
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...field(0), position: OcgPosition.FACEUP_ATTACK }] }, chain, 1, ctx, cards);
      const first = views.snapshotLinkTargets(chain[0]!);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:0:46986414:1`);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:1:89631139:1`);
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...field(1), position: OcgPosition.FACEUP_ATTACK }] }, chain, 2, ctx, cards);
      expect(views.nameLinkTargets(ctx, first, cards)).toBe(true);
      expect(views.targetEventText(first)).toBe("Chain Link 1 targets Dark Magician");
      expect(views.targetEventText(chain[0]!)).toBe("Chain Link 1 targets Dark Magician and Blue-Eyes White Dragon");
    });

    it("keeps hidden targets anonymous in the structured announcement labels", () => {
      const ctx = context();
      const chain = [link()];
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:0:46986414:8`);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:2:0:89631139:8`);
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET, cards: [{ ...field(0), position: OcgPosition.FACEDOWN_DEFENSE }, { controller: 0, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE }] }, chain, 1, ctx, cards);
      expect(views.targetEventLabels(views.snapshotLinkTargets(chain[0]!))).toEqual(["a face-down card", "a card"]);
    });

    it("freezes visibility before a late note and projects private text and labels together", () => {
      const ctx = views.createEventContext();
      const visible = new Map<number | null, number>([[0, 70781052]]);
      ctx.targetVisibility = () => visible;
      const chain = [link()];
      const [event] = views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET,
        cards: [{ ...field(5), position: OcgPosition.FACEUP_ATTACK }],
      }, chain, 1, ctx, cards);
      const announcement = views.snapshotLinkTargets(chain[0]!);
      // A subsequent reveal or replacement must never broaden an earlier announcement's audience.
      visible.set(null, 70781052);
      visible.set(1, 70781052);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:5:70781052:1`);
      expect(views.nameLinkTargets(ctx, announcement, cards)).toBe(true);
      views.updateTargetEvent(event!, announcement);
      for (const viewer of [1, null]) expect(views.projectStoredEvent(event!, viewer)).toMatchObject({
        text: "Chain Link 1 targets a card", targetLabels: ["a card"],
      });
      expect(views.projectStoredEvent(event!, 0)).toMatchObject({
        text: "Chain Link 1 targets Summoned Skull", targetLabels: ["Summoned Skull"],
      });
    });

    it.each([undefined, 46986414])("does not name an unverified or replaced target (visible code: %s)", (code) => {
      const ctx = views.createEventContext();
      if (code != null) ctx.targetVisibility = () => new Map([[0, code], [1, code], [null, code]]);
      const chain = [link()];
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:5:70781052:1`);
      views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET,
        cards: [{ ...field(5), position: OcgPosition.FACEUP_ATTACK }],
      }, chain, 1, ctx, cards);
      for (const viewer of [0, 1, null]) {
        expect(views.targetEventText(chain[0]!, viewer)).toBe("Chain Link 1 targets a card");
        expect(views.targetEventLabels(chain[0]!, viewer)).toEqual(["a card"]);
      }
    });

    it("keeps each private target name with its own eligible viewer", () => {
      const ctx = views.createEventContext();
      ctx.targetVisibility = (zone) => new Map([[zone.sequence, zone.sequence === 0 ? 46986414 : 89631139]]);
      const chain = [link()];
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:0:46986414:8`);
      views.noteTargetCardLog(ctx, `${TARGET_CARD_NOTE_PREFIX}0:4:1:89631139:8`);
      const [event] = views.observeChainTargetEvents({ type: OcgMessageType.BECOME_TARGET,
        cards: [0, 1].map((sequence) => ({ ...field(sequence), position: OcgPosition.FACEDOWN_DEFENSE })),
      }, chain, 1, ctx, cards);
      views.updateTargetEvent(event!, chain[0]!);
      expect(views.projectStoredEvent(event!, null)).toMatchObject({
        text: "Chain Link 1 targets a face-down card and a face-down card",
        targetLabels: ["a face-down card", "a face-down card"],
      });
      expect(views.projectStoredEvent(event!, 0)).toMatchObject({
        text: "Chain Link 1 targets Dark Magician and a face-down card",
        targetLabels: ["Dark Magician", "a face-down card"],
      });
      expect(views.projectStoredEvent(event!, 1)).toMatchObject({
        text: "Chain Link 1 targets a face-down card and Blue-Eyes White Dragon",
        targetLabels: ["a face-down card", "Blue-Eyes White Dragon"],
      });
    });
  });
}
targetTrackingTests("main", mainViews);
targetTrackingTests("legacy", legacyViews);

describe.each([["main views", isNegatedMulti], ["legacy views", isNegatedLegacy]])("negated flag (%s)", (_name, isNegated) => {
  const DISABLED = 0x0001;
  it("is set for a face-up monster or Spell/Trap with STATUS_DISABLED", () => {
    expect(isNegated(OcgLocation.MZONE, OcgPosition.FACEUP_ATTACK, DISABLED)).toBe(true);
    expect(isNegated(OcgLocation.MZONE, OcgPosition.FACEUP_DEFENSE, DISABLED | 0x400)).toBe(true);
    expect(isNegated(OcgLocation.SZONE, OcgPosition.FACEUP, DISABLED)).toBe(true);
  });
  it("is never set for a face-down card, a card off the field or a status without the bit", () => {
    expect(isNegated(OcgLocation.MZONE, OcgPosition.FACEDOWN_DEFENSE, DISABLED)).toBe(false);
    expect(isNegated(OcgLocation.SZONE, OcgPosition.FACEDOWN, DISABLED)).toBe(false);
    expect(isNegated(OcgLocation.GRAVE, OcgPosition.FACEUP, DISABLED)).toBe(false);
    expect(isNegated(OcgLocation.HAND, OcgPosition.FACEUP, DISABLED)).toBe(false);
    expect(isNegated(OcgLocation.MZONE, OcgPosition.FACEUP_ATTACK, 0)).toBe(false);
    expect(isNegated(OcgLocation.MZONE, OcgPosition.FACEUP_ATTACK, undefined)).toBe(false);
  });
});
