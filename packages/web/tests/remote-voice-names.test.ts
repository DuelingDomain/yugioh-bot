import { expect, it } from "vitest";
import { ygoModule, type RemoteRoom } from "@yugidraft/shared/remote";
import { createHotListMatcher } from "@/components/remote/ui/voice/hot-list";
import { decideVoice } from "@/components/remote/ui/voice/decision";
import type { VoiceFinal } from "@/components/remote/ui/voice/live-client";
import { voiceCardNames } from "@/components/remote/ui/model";

// Heard texts are real Moonshine Tiny q8 outputs for synthetic speech (names garbled the way the model garbles them).
it("asr-names turns misheard card names into table proposals using only the hot list, and ignores table talk", () => {
  const base = ygoModule.initialState({ seatCount: 2 });
  const card = (ref: string, name: string, slot: number) => ({ ref, name, cardId: slot, zone: "monster", slot, faceUp: true, position: "attack" as const });
  const state = { ...base, turn: 3, phase: "main1", turnSeat: 0, seats: base.seats.map(s => s.seat === 0 ? { ...s, twin: [card("a", "Kashtira Unicorn", 1), card("b", "Dogmatika Maximus", 2)] } : s) } as typeof base;
  const players = [{ seat: 0, displayName: "Me" }, { seat: 1, displayName: "Opponent" }];
  const room = { state, seats: [{ seat: 0 }, { seat: 1 }] } as unknown as RemoteRoom;
  const names = voiceCardNames(room, () => undefined);
  expect([...names].sort()).toEqual(["Dogmatika Maximus", "Kashtira Unicorn"]);
  const context = { state, players, me: 0, trayOpen: false, cardNames: [...names, "Branded Fusion", "Raigeki", "Ash Blossom & Joyous Spring"] };
  const hot = createHotListMatcher();
  const decide = (text: string, method: VoiceFinal["method"] = "asr-names") => {
    const canonical = hot.canonical(text, 1800, context.cardNames);
    const final: VoiceFinal = { id: "u", method, text, canonical, utterance: { id: 1, hits: [], text, speechMs: 1800, audioMs: 2400, busyMs: 90 } };
    return decideVoice(final, context, true);
  };
  const effect = decide("Casteuro Unicorn Effect.");
  expect(effect).toMatchObject({ accepted: true, intent: { kind: "effect", proposal: { type: "effect.activated", source: { cardRef: "a", name: "Kashtira Unicorn" } } } });
  expect(decide("I activate dog metica maximus.")).toMatchObject({ accepted: true, intent: { kind: "effect", proposal: { source: { cardRef: "b" } } } });
  expect(decide("Opponent takes 1,500.")).toMatchObject({ accepted: true, intent: { kind: "lp", seat: 1, delta: -1500 } });
  expect(decide("Pay 500lp")).toMatchObject({ accepted: true, intent: { kind: "lp", seat: 0, delta: -500 } });
  expect(decide("Battle phase.")).toMatchObject({ accepted: true, intent: { kind: "phase", phase: "battle" } });
  // A card that is not on the speaker's field, and plain table talk, never become actions.
  expect(decide("I activate rejicky.").accepted).toBe(false);
  for (const talk of ["Can you read the effect of that card please.", "I think the battle phase is next.", "Good game, man, that was close.", "What does that card do?"]) expect(decide(talk).accepted).toBe(false);
  // The existing method keeps its phase/turn-only rule.
  expect(decide("Casteuro Unicorn Effect.", "asr").accepted).toBe(false);
});
