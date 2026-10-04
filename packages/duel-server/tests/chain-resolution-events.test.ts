// What the client gets to explain a resolving chain: the order of the negate events, the LP gained by an
// effect, and the printed text of a link that survives a reload. Real cards and scripts on the stock core,
// run through both event pipelines (the merged engine's views and the 1v1 legacy engine's views).
import { beforeAll, describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { chainResolutionBatches, RAIGEKI, SOLEMN_JUDGMENT, UPSTART_GOBLIN, type ChainScenario, type EngineBatch } from "./helpers/chain-resolution.js";

type Views = typeof merged | typeof legacy;

describeWithCores("chain resolution events", [needs.cards(engineDataDirectory), needs.scripts(engineDataDirectory)], () => {
  let cards: ReturnType<typeof loadCardDatabase>;
  beforeAll(() => { cards = loadCardDatabase(engineDataDirectory); });

  /** The same calls engine.ts makes for every message, in the same order. */
  function storedEvents(views: Views, batches: readonly EngineBatch[]): merged.StoredDuelEvent[] {
    const ctx = views.createEventContext() as never;
    const chain: merged.StoredChainLink[] = [];
    const events: merged.StoredDuelEvent[] = [];
    const push = (stored: merged.StoredDuelEvent) => { stored.id = events.length + 1; events.push(stored); };
    for (const batch of batches) {
      views.resetEventBatch(ctx);
      for (const note of batch.notes) views.noteDestroyLog(ctx, note) || views.noteChainTargetLog(ctx, note);
      for (const message of batch.messages) {
        for (const move of views.observeMoveEvents(message, cards, ctx, events.length + 1)) push(move);
        for (const confirm of views.observeConfirmEvents(message, cards, ctx, events.length + 1)) push(confirm);
        const stored = views.observeDuelEvent(message, cards, chain, events.length + 1, ctx);
        if (stored) push(stored);
        for (const target of views.observeChainTargetEvents(message, chain, events.length + 1, ctx)) push(target);
      }
      for (const stored of views.drainDeferredDestroys(ctx, cards, events.length + 1)) push(stored);
    }
    return events;
  }

  async function eventsOf(views: Views, scenario: ChainScenario): Promise<merged.StoredDuelEvent[]> {
    const batches = await chainResolutionBatches(scenario, [views.DESTROY_NOTE_SCRIPT, views.CHAIN_TARGET_NOTE_SCRIPT]);
    return storedEvents(views, batches);
  }

  const brief = (event: merged.StoredDuelEvent) => `${event.kind}${event.chainIndex != null ? `#${event.chainIndex}` : ""}`;

  describe.each([["merged", merged], ["legacy", legacy]] as const)("%s engine: chain resolution events", (_name, views) => {
    it("reports a negation while the negating link resolves, naming the negated link", async () => {
      const events = await eventsOf(views, "negate");
      const order = events.filter((event) => event.kind.startsWith("chain-") || event.kind === "activate").map(brief);
      // Real stock-core order: CHAIN_SOLVING#2, CHAIN_NEGATED#1, CHAIN_SOLVED#2, then the negated link still resolves (as a no-op).
      expect(order).toEqual([
        "activate#1", "activate#2",
        "chain-resolving#2", "chain-negated#1", "chain-resolved#2",
        "chain-resolving#1", "chain-resolved#1",
        "chain-end",
      ]);
      const negated = events.find((event) => event.kind === "chain-negated")!;
      expect(negated).toMatchObject({ chainIndex: 1, seat: 0, revealCardTo: "all" });
      expect(negated.card).toMatchObject({ code: RAIGEKI });
      const ids = events.map((event) => event.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      const activations = events.filter((event) => event.kind === "activate");
      expect(activations.map((event) => event.card?.code)).toEqual([RAIGEKI, SOLEMN_JUDGMENT]);
      // The negated Spell leaves the field between the negation and the end of link 2.
      const resolving2 = events.findIndex((event) => event.kind === "chain-resolving" && event.chainIndex === 2);
      const solved2 = events.findIndex((event) => event.kind === "chain-resolved" && event.chainIndex === 2);
      const between = events.slice(resolving2, solved2).filter((event) => event.kind === "destroy" || event.kind === "move");
      expect(between.map((event) => event.card?.code)).toContain(RAIGEKI);
    });

    it("emits a public recover event inside the link that gained the LP", async () => {
      const events = await eventsOf(views, "recover");
      const resolving = events.findIndex((event) => event.kind === "chain-resolving" && event.chainIndex === 1);
      const solved = events.findIndex((event) => event.kind === "chain-resolved" && event.chainIndex === 1);
      const recovers = events.map((event, index) => ({ event, index })).filter(({ event }) => event.kind === "recover");
      expect(recovers).toHaveLength(1);
      const [{ event, index }] = recovers;
      expect(index).toBeGreaterThan(resolving);
      expect(index).toBeLessThan(solved);
      expect(event).toMatchObject({ seat: 1, amount: 1000, revealCardTo: "all" });
      expect(event.text).toBe("Player 2 gains 1000 LP");
      for (const viewer of [0, 1, null]) {
        expect(views.projectStoredEvent(event, viewer)).toMatchObject({ kind: "recover", seat: 1, amount: 1000, text: "Player 2 gains 1000 LP" });
      }
    });

    it("ignores a recover of nothing", () => {
      const message = { type: OcgMessageType.RECOVER, player: 0, amount: 0 } as OcgMessage;
      expect(views.observeDuelEvent(message, cards, [], 1, views.createEventContext() as never)).toBeNull();
    });

    it("puts the printed text and type of every chain link on the snapshot, for every viewer", () => {
      const view = (viewer: number | null) => views.projectView({
        lib: {
          duelQueryField: () => ({
            players: [{ deck_size: 30, extra_size: 0 }, { deck_size: 30, extra_size: 0 }],
            chain: [
              { code: UPSTART_GOBLIN, controller: 0, location: OcgLocation.SZONE, sequence: 0, description: 0n },
              { code: SOLEMN_JUDGMENT, controller: 1, location: OcgLocation.SZONE, sequence: 2, description: 0n },
            ],
          }),
          duelQueryCount: () => 30,
          duelQueryLocation: () => [],
        } as never,
        handle: {} as never,
        cards,
        viewer, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000], prompt: null, promptSeat: null,
        log: [], events: [], result: null, reveals: views.createRevealMap(2), mode: "normal",
      });
      for (const viewer of [0, 1, null]) {
        const { chain } = view(viewer);
        expect(chain).toHaveLength(2);
        expect(chain[0]).toMatchObject({ index: 1, code: UPSTART_GOBLIN, text: cards.get(UPSTART_GOBLIN)!.description, cardType: cards.get(UPSTART_GOBLIN)!.type });
        expect(chain[1]).toMatchObject({ index: 2, code: SOLEMN_JUDGMENT, name: "Solemn Judgment" });
        expect(chain[1].text).toContain("negate the Summon or activation");
        expect(chain[1].cardType! & 0x4).toBe(0x4);
      }
    });

    it("omits the text of a link whose card is unknown to the database", () => {
      const { chain } = views.projectView({
        lib: {
          duelQueryField: () => ({ players: [{ deck_size: 1, extra_size: 0 }, { deck_size: 1, extra_size: 0 }], chain: [{ code: 1, controller: 0, location: OcgLocation.SZONE, sequence: 0, description: 0n }] }),
          duelQueryCount: () => 1,
          duelQueryLocation: () => [],
        } as never,
        handle: {} as never,
        cards: { get: () => undefined, resolveLabel: () => "" } as never,
        viewer: 0, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000], prompt: null, promptSeat: null,
        log: [], events: [], result: null, reveals: views.createRevealMap(2), mode: "normal",
      });
      expect(chain[0].text).toBeUndefined();
      expect(chain[0].cardType).toBeUndefined();
      expect(JSON.stringify(chain)).not.toContain('"text"');
    });
  });

  describe("events keep their pre-existing shape", () => {
    it("still emits the same non-recover kinds for the recover chain", async () => {
      for (const views of [merged, legacy]) {
        const kinds = (await eventsOf(views, "recover")).map((event) => event.kind);
        expect(kinds).toContain("activate");
        expect(kinds.at(-1)).toBe("chain-end");
        expect(kinds).toContain("recover");
      }
    });
  });
});
