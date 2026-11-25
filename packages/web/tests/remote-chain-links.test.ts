import { expect, it } from "vitest";
import type { RemoteActionProposal, RemoteEvent } from "@yugidraft/shared/remote";
import { chainOf } from "@/components/remote/ui/think-model";
import { chainMarksOf, markLabel } from "@/components/remote/ui/chain-marks";

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

it("marks the cards of an open chain: a fresh label first, then a small Chain N, and none once the chain closes", () => {
  const event = (seq: number, proposal: RemoteActionProposal): RemoteEvent => {
    const id = `mark-${seq}`, at = seq * 1000;
    return { id, seq, at, actorSeat: proposal.actorSeat, userId: null, action: { ...proposal, idempotencyKey: id, at } };
  };
  const first = event(1, { type: "effect.activated", actorSeat: 0, source: { cardId: 1, cardRef: "a" } });
  const reply = event(2, { type: "effect.activated", actorSeat: 1, source: { cardId: 2, cardRef: "b" } });
  const marks = chainMarksOf(chainOf([first, reply], [0, 1]));
  expect(marks.map(mark => [mark.ref, mark.n])).toEqual([["a", 1], ["b", 2]]);
  expect(markLabel(marks[1], marks[1].at + 100)).toBe("Effect activated · Chain 2");
  expect(markLabel(marks[1], marks[1].at + 5000)).toBe("Chain 2");
  expect(chainMarksOf(chainOf([first, reply, event(3, { type: "chain.ok", actorSeat: 0 })], [0, 1]))).toEqual([]);
});
