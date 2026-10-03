import assert from "node:assert/strict";
import { test } from "node:test";
import { tracePrompt } from "../../duel-server/src/prompt-trace.ts";

test("prompt trace preserves fast consecutive decisions and first-draw counts", () => {
  const view = {
    revision: 1, turn: 1, turnSeat: 0, phase: "main1",
    prompt: { id: "p1", seat: 0, kind: "choice", context: { type: "action" }, options: [{ id: "to_ep", label: "End turn" }] },
    chain: [], seats: [{ seat: 0, hand: Array(6).fill({}), deckCount: 34 }],
  };
  const first = tracePrompt(view as never)!;
  const second = tracePrompt({ ...view, revision: 2, turn: 2, turnSeat: 1, prompt: { ...view.prompt, id: "p2", seat: 1 } } as never)!;
  assert.deepEqual([first, second].map(({ turn, turnSeat, promptSeat, promptType }) => ({ turn, turnSeat, promptSeat, promptType })), [
    { turn: 1, turnSeat: 0, promptSeat: 0, promptType: "action" },
    { turn: 2, turnSeat: 1, promptSeat: 1, promptType: "action" },
  ]);
  assert.deepEqual(first.seats, [{ seat: 0, handCount: 6, deckCount: 34 }]);
  view.prompt.options[0]!.id = "changed";
  assert.equal(first.options[0]!.id, "to_ep");
});

test("prompt trace keeps responder order and ignores a view without a prompt", () => {
  const view = { revision: 5, turn: 4, turnSeat: 0, phase: "main1", prompt: { id: "p5", seat: 2, kind: "chain", options: [] }, chain: [{ seat: 0 }, { seat: 1 }], seats: [] };
  assert.deepEqual(tracePrompt(view as never)!.chainSeats, [0, 1]);
  assert.equal(tracePrompt({ ...view, prompt: null } as never), null);
});
