// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ygoModule, type RemoteActionProposal, type RemoteEvent } from "@yugidraft/shared/remote";
import { decideVoice } from "@/components/remote/ui/voice/decision";
import type { VoiceFinal } from "@/components/remote/ui/voice/live-client";
import { RespondBanner } from "@/components/remote/ui/respond-banner";
import { heldByResponse, respondCoolingDown, RESPOND_HOLD_MS } from "@/components/remote/ui/respond";
import { chainOf } from "@/components/remote/ui/think-model";
import { createHotListMatcher } from "@/components/remote/ui/voice/hot-list";

afterEach(cleanup);
const final = (text: string, canonical: string, method: VoiceFinal["method"] = "asr"): VoiceFinal =>
  ({ id: "u1", method, text, canonical, utterance: { id: 1, hits: [], text, speechMs: 500, audioMs: 1000, busyMs: 20 } });

it("a spoken response from any seat shows the banner and holds the turn player's phase change", () => {
  const state = { ...ygoModule.initialState({ seatCount: 2 }), turn: 3, phase: "main1" as const, turnSeat: 0 };
  const players = [{ seat: 0, displayName: "Yugi" }, { seat: 1, displayName: "Kaiba" }];
  // Every phrase the owner listed reaches the same intent through the live hot-list path; "asr" carries it for the off-turn seat too.
  const hot = createHotListMatcher();
  const decide = (said: string) => decideVoice(final(said, hot.canonical(said, 800, [])), { state, players, me: 1, trayOpen: false }, true);
  for (const said of ["response", "I respond", "respond", "chain", "I chain", "chain to that", "in response"]) expect(decide(said), said).toEqual({ accepted: true, intent: { kind: "respond" } });
  // Table talk is not a response.
  for (const said of ["I can't respond", "no response"]) expect(decide(said).accepted, said).toBe(false);

  // The room action: the reducer takes it as a public no-op, which the room events then carry to players and spectators.
  const at = state.updatedAt + 10;
  const action = { type: "chain.respond" as const, actorSeat: 1, idempotencyKey: "r1", at };
  expect(ygoModule.reduce(state, action).phase).toBe("main1");
  const events = [{ id: "e1", seq: 1, actorSeat: 1, userId: 2, at, action }] as RemoteEvent[];

  render(<RespondBanner hold={heldByResponse({ kind: "phase" }, events, at + 500, 0)} name={seat => players[seat].displayName} />);
  expect(screen.getByTestId("respond-banner").textContent).toBe("KaibaResponse!");

  // The turn player's phase line is accepted by the voice rules but waits during the hold, and goes through after it.
  const phase = decideVoice(final("battle phase", "battle phase"), { state, players, me: 0, trayOpen: false }, true);
  expect(phase).toEqual({ accepted: true, intent: { kind: "phase", phase: "battle" } });
  expect(heldByResponse(phase.accepted ? phase.intent : { kind: "none" }, events, at + 500, 0)?.seat).toBe(1);
  expect(heldByResponse({ kind: "phase" }, events, at + RESPOND_HOLD_MS + 1, 0)).toBeNull();
  expect(heldByResponse({ kind: "lp" }, events, at + 500, 0)).toBeNull();
  // The responder's own lines never wait for their own response, and the button cools down for the server's 8 seconds.
  expect(heldByResponse({ kind: "phase" }, events, at + 500, 1)).toBeNull();
  expect(respondCoolingDown(events, 1, at + 7000)).toBe(true);
  expect(respondCoolingDown(events, 1, at + 8001)).toBe(false);
  // Bare "chain" and the turn player's question are not a response from the turn player; "I chain" is.
  const asTurn = (said: string) => decideVoice(final(said, hot.canonical(said, 800, [])), { state, players, me: 0, trayOpen: false }, true);
  expect(asTurn("chain").accepted).toBe(false);
  expect(asTurn("any response").accepted).toBe(false);
  expect(asTurn("any responses").accepted).toBe(false);
  expect(asTurn("I chain")).toEqual({ accepted: true, intent: { kind: "respond" } });
  // No response after the game ended (the die roll and siding use the same guard).
  expect(decideVoice(final("response", "chain"), { state: { ...state, ended: true } as typeof state, players, me: 1, trayOpen: false }, true).accepted).toBe(false);
});

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
