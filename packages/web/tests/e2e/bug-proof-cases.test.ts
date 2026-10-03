import { describe, expect } from "vitest";
import { prepareProofCases } from "../../e2e/bug-proof.playwright";
import { collectFreshEvents } from "../../src/components/duel/event-queue";
import { itWithCores, needs } from "../../../duel-server/tests/support/cores.js";

describe("search-reveal proof replay", () => {
  // Real stock-core duel: skipped without the engine bundle, a failure with DUEL_REQUIRE_CORES=1.
  itWithCores("delivers both the search move and its confirmation as fresh events to each viewer", [needs.cards(), needs.standard()], async () => {
    const cases = await prepareProofCases(1);
    expect(cases.map((entry) => entry.mySeat)).toEqual([1, null]);
    for (const entry of cases) {
      const move = entry.engine.events.find((event) => event.id === 17)!;
      const confirm = entry.engine.events.find((event) => event.id === 18)!;
      expect(move).toMatchObject({ kind: "move", reason: "add", addedToHand: true });
      expect(move.card).toBeUndefined();
      expect(confirm).toMatchObject({ kind: "confirm", moveId: 17, card: { code: 1184620 } });
      const { fresh } = collectFreshEvents(entry.engine.events, entry.replayFrom!);
      expect(fresh).toEqual(expect.arrayContaining([move, confirm]));
    }
  });
});
