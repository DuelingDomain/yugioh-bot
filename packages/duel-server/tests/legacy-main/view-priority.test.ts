// Main afd5f228 public-priority tests, run against the legacy 1v1 projection.
import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import type { CardDatabase } from "../../src/cards.js";
import { createRevealMap, projectView } from "../../src/legacy/views.js";

const prompt: DuelPrompt = {
  id: "private", seat: 1, kind: "choice", title: "Activate secret card?",
  options: [{ id: "secret", label: "Secret option" }],
};
const player = { deck_size: 30, extra_size: 0 };
function project(viewer: number | null, pending: DuelPrompt | null = prompt, result: DuelEngineView["result"] = null) {
  return projectView({
    lib: {
      duelQueryField: () => ({ players: [player, player], chain: [] }),
      duelQueryLocation: () => [],
    } as never,
    handle: {} as never, cards: { get: () => undefined } as unknown as CardDatabase,
    viewer, revision: 1, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
    prompt: pending, promptSeat: pending?.seat ?? null, log: [], events: [], result,
    reveals: createRevealMap(), mode: "normal",
  });
}

describe("public priority ownership", () => {
  it.each([0, 1, null])("publishes only the waiting seat to viewer %s", (viewer) => {
    const view = project(viewer);
    expect(view.prioritySeat).toBe(1);
    expect(view.turnSeat).toBe(0);
    if (viewer === 1) expect(view.prompt).toEqual(prompt);
    else {
      expect(view.prompt).toBeNull();
      expect(JSON.stringify(view)).not.toContain("secret");
    }
  });

  it("clears priority when the engine is not waiting", () => {
    expect(project(0, null).prioritySeat).toBeNull();
  });

  it("clears priority at the end even if the last prompt remains", () => {
    expect(project(0, prompt, { winnerSeat: 0, reason: "Finished" }).prioritySeat).toBeNull();
  });
});
