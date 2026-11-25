import { expect, it } from "vitest";
import type { RemoteActionProposal, RemoteEvent } from "@yugidraft/shared/remote";
import { chainOf } from "@/components/remote/ui/think-model";

it("keeps the chain link when an undone activation is retried and reopens it on OK undo", () => {
  const event = (seq: number, proposal: RemoteActionProposal): RemoteEvent => {
    const id = `chain-${seq}`, at = seq * 1000;
    return { id, seq, at, actorSeat: proposal.actorSeat, userId: null, action: { ...proposal, idempotencyKey: id, at } };
  };
  const first = event(1, { type: "effect.activated", actorSeat: 0, source: { cardId: 14087893 } });
  const response = { type: "effect.activated", actorSeat: 1, source: { cardId: 5318639 } } as const;
  const undone = event(2, response);
  const undo = event(3, { type: "undo", actorSeat: 1, targetActionId: undone.id });
  const retry = event(4, response);
  const ok = event(5, { type: "chain.ok", actorSeat: 0 });
  const undoOk = event(6, { type: "undo", actorSeat: 0, targetActionId: ok.id });
  const closed = [first, undone, undo, retry, ok];

  expect(chainOf(closed, [0, 1]).open).toEqual([]);
  expect(chainOf([...closed, undoOk], [0, 1])).toEqual({
    links: new Map([[first.id, { n: 1 }], [retry.id, { n: 2, of: first }]]),
    open: [first, retry],
  });
});
