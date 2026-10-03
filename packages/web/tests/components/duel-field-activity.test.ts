import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { deriveFieldActivity } from "@/components/duel/field-activity";
import { newBoard } from "@/components/duel/fx-lab/board";

const prompt: DuelPrompt = { id: "p1", seat: 0, kind: "choice", title: "Activate?", options: [] };
function view(extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats: newBoard().seats,
    prompt: null, chain: [], events: [], log: [], result: null, ...extra };
}

describe("deriveFieldActivity", () => {
  it.each([[0, 0], [0, 1], [1, 1], [1, 0]] as const)("keeps turn %i separate from priority %i", (turnSeat, prioritySeat) => {
    expect(deriveFieldActivity(view({ turnSeat, prioritySeat }))).toEqual({ turnSeat, prioritySeat });
  });

  it.each(["choice", "cards", "tribute", "places", "order", "counters", "number", "announce-card", "sum", "toggle"] as const)("uses a legacy %s prompt's answering seat", (kind) => {
    expect(deriveFieldActivity(view({ turnSeat: 1, prompt: { ...prompt, kind } }))).toEqual({ turnSeat: 1, prioritySeat: 0 });
  });

  it("knows the opponent is acting even when their prompt is private", () => {
    expect(deriveFieldActivity(view({ prompt: null, prioritySeat: 1 }))).toEqual({ turnSeat: 0, prioritySeat: 1 });
  });

  it("does not guess priority from the turn, chain, or absence of a local prompt in old snapshots", () => {
    expect(deriveFieldActivity(view({ chain: [{ index: 1, seat: 0 }] }))).toEqual({ turnSeat: 0, prioritySeat: null });
  });

  it("treats an explicit null as authoritative even if a stale prompt remains", () => {
    expect(deriveFieldActivity(view({ prioritySeat: null, prompt }))).toEqual({ turnSeat: 0, prioritySeat: null });
  });

  it("holds only priority during board animations", () => {
    expect(deriveFieldActivity(view({ prioritySeat: 1 }), true)).toEqual({ turnSeat: 0, prioritySeat: null });
  });

  it.each([null, view({ turn: 0, prioritySeat: 0 }), view({ result: { winnerSeat: 0, reason: "Finished" }, prioritySeat: 0 })])("clears activity before the first turn or after a game", (engine) => {
    expect(deriveFieldActivity(engine)).toEqual({ turnSeat: null, prioritySeat: null });
  });

  it("ignores seats that are not on this field", () => {
    expect(deriveFieldActivity(view({ turnSeat: 7, prioritySeat: -1 }))).toEqual({ turnSeat: null, prioritySeat: null });
  });
});
