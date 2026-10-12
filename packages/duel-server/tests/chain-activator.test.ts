import { describe, expect, it } from "vitest";
import { OcgEffectClientMode, OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { ChainActivator } from "../src/chain-activator.js";
import type { CardDatabase } from "../src/cards.js";
import { observeDuelEvent, type StoredChainLink } from "../src/views.js";
import { observeDuelEvent as observeLegacyEvent } from "../src/legacy/views.js";

const chaining: OcgMessage = {
  type: OcgMessageType.CHAINING, code: 80921533, controller: 1, location: OcgLocation.SZONE,
  sequence: 5, position: OcgPosition.FACEUP_ATTACK, triggering_controller: 1,
  triggering_location: OcgLocation.SZONE, triggering_sequence: 5, description: 0n, chain_size: 1,
};
const idleActivation: OcgResponse = { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 };
const triggerPrompt = (description: bigint): OcgMessage => ({
  type: OcgMessageType.SELECT_EFFECTYN, player: 2, code: 80921533, controller: 1,
  location: OcgLocation.SZONE, sequence: 5, position: OcgPosition.FACEUP_ATTACK, description,
});
const forcedPrompt = (controller: 0 | 1): OcgMessage => ({
  type: OcgMessageType.SELECT_CHAIN, player: 2, spe_count: 1, forced: true,
  hint_timing: 0 as never, hint_timing_other: 0 as never,
  selects: [{ code: 80921533, controller, location: OcgLocation.SZONE, sequence: 5,
    position: OcgPosition.FACEUP_ATTACK, description: 0n, client_mode: OcgEffectClientMode.NORMAL }],
});

describe("chain activation answers", () => {
  it.each([
    ["idle activation", idleActivation, undefined],
    ["battle activation", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index: 0 }, undefined],
    ["chosen response or forced trigger", { type: OcgResponseType.SELECT_CHAIN, index: 0 }, undefined],
    ["optional event trigger", { type: OcgResponseType.SELECT_EFFECTYN, yes: true }, 221n],
    ["optional phase trigger", { type: OcgResponseType.SELECT_EFFECTYN, yes: true }, 0n],
  ] satisfies [string, OcgResponse, bigint | undefined][])("uses the answering non-turn seat for %s once", (_, response, description) => {
    const tracker = new ChainActivator();
    tracker.recordResponse(2, response, description == null ? undefined : triggerPrompt(description));
    expect(tracker.observe(chaining)).toBe(2);
    expect(tracker.observe(chaining)).toBeUndefined();
  });

  it("keeps the activator through choices made by other players while paying costs or picking targets", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(0, idleActivation);
    tracker.recordResponse(1, { type: OcgResponseType.SELECT_OPTION, index: 0 });
    tracker.recordResponse(1, { type: OcgResponseType.SELECT_EFFECTYN, yes: true });
    tracker.recordResponse(1, { type: OcgResponseType.SELECT_YESNO, yes: false });
    tracker.recordResponse(2, { type: OcgResponseType.SELECT_CARD, indicies: [0] });
    expect(tracker.observe(chaining)).toBe(0);
  });

  it.each([
    ["chain pass", { type: OcgResponseType.SELECT_CHAIN, index: null }],
    ["normal summon", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 }],
    ["attack", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 }],
    ["declined effect", { type: OcgResponseType.SELECT_EFFECTYN, yes: false }],
    ["declined yes/no", { type: OcgResponseType.SELECT_YESNO, yes: false }],
    ["script's accepted yes/no", { type: OcgResponseType.SELECT_YESNO, yes: true }],
    ["script's accepted effect choice", { type: OcgResponseType.SELECT_EFFECTYN, yes: true }],
  ] satisfies [string, OcgResponse][])("does not attribute a later unprompted trigger to a %s", (_, response) => {
    const tracker = new ChainActivator();
    tracker.recordResponse(2, response);
    expect(tracker.observe(chaining)).toBeUndefined();
  });

  it("rolls back a rejected activation and accepts the next answer", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(0, idleActivation);
    tracker.observe({ type: OcgMessageType.RETRY });
    expect(tracker.observe(chaining)).toBeUndefined();
    tracker.recordResponse(1, idleActivation);
    expect(tracker.observe(chaining)).toBe(1);
  });

  it("does not treat a resolving effect's yes/no choice as a new trigger", () => {
    const tracker = new ChainActivator();
    tracker.observe({ type: OcgMessageType.CHAIN_SOLVING, chain_size: 1 });
    tracker.recordResponse(0, { type: OcgResponseType.SELECT_EFFECTYN, yes: true }, triggerPrompt(0n));
    tracker.observe({ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 });
    tracker.recordResponse(1, { type: OcgResponseType.SELECT_CHAIN, index: 0 });
    expect(tracker.observe(chaining)).toBe(1);
    tracker.observe({ type: OcgMessageType.CHAIN_END });
    expect(tracker.observe(chaining)).toBeUndefined();
  });

  it.each([OcgResponseType.SELECT_EFFECTYN, OcgResponseType.SELECT_YESNO] as const)("does not credit the next mandatory trigger to a post-CHAINING cost/target chooser (%s)", (type) => {
    const tracker = new ChainActivator();
    tracker.recordResponse(0, idleActivation);
    expect(tracker.observe(chaining)).toBe(0);
    // AddChain announces the link before running its Lua cost/target functions.
    tracker.recordResponse(0, { type, yes: true }, triggerPrompt(0n));
    tracker.observe({ type: OcgMessageType.CHAINED, chain_size: 1 });
    // SEGOC can add the other player's only mandatory trigger without another prompt.
    expect(tracker.observe({ ...chaining, chain_size: 2 })).toBeUndefined();
  });

  it("attributes a new yes/no trigger after the previous link has finished activating", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(0, idleActivation);
    expect(tracker.observe(chaining)).toBe(0);
    tracker.observe({ type: OcgMessageType.CHAINED, chain_size: 1 });
    tracker.recordResponse(1, { type: OcgResponseType.SELECT_EFFECTYN, yes: true }, triggerPrompt(221n));
    expect(tracker.observe({ ...chaining, chain_size: 2 })).toBe(1);
  });

  it("matches a queued forced answer to its card after an unprompted link and another player's pass", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(2, { type: OcgResponseType.SELECT_CHAIN, index: 0 }, forcedPrompt(1));
    tracker.observe(forcedPrompt(0));
    tracker.recordResponse(0, { type: OcgResponseType.SELECT_CHAIN, index: null });
    expect(tracker.observe({ ...chaining, controller: 0, triggering_controller: 0 })).toBeUndefined();
    expect(tracker.observe(chaining)).toBe(2);
    expect(tracker.observe(chaining)).toBeUndefined();
  });

  it("retains forced selections from multiple seats and matches them in engine link order", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(2, { type: OcgResponseType.SELECT_CHAIN, index: 0 }, forcedPrompt(1));
    tracker.observe(forcedPrompt(0));
    tracker.recordResponse(0, { type: OcgResponseType.SELECT_CHAIN, index: 0 }, forcedPrompt(0));
    expect(tracker.observe({ ...chaining, controller: 0, triggering_controller: 0 })).toBe(0);
    expect(tracker.observe(chaining)).toBe(2);
  });

  it("rolls back a rejected forced selection while retaining an earlier accepted selection", () => {
    const tracker = new ChainActivator();
    tracker.recordResponse(0, { type: OcgResponseType.SELECT_CHAIN, index: 0 }, forcedPrompt(0));
    tracker.recordResponse(2, { type: OcgResponseType.SELECT_CHAIN, index: 0 }, forcedPrompt(1));
    tracker.observe({ type: OcgMessageType.RETRY });
    expect(tracker.observe({ ...chaining, controller: 0, triggering_controller: 0 })).toBe(0);
    expect(tracker.observe(chaining)).toBeUndefined();
  });
});

const cards = { get: () => undefined, resolveLabel: () => "" } as unknown as CardDatabase;
describe.each([["merged", observeDuelEvent], ["legacy", observeLegacyEvent]] as const)("%s link attribution", (_, observe) => {
  it.each([0, undefined])("uses activator %s with a controller fallback and unchanged source coordinates", (activator) => {
    const chain: StoredChainLink[] = [];
    const event = observe(chaining, cards, chain, 1, undefined, activator)!;
    expect(event.seat).toBe(activator ?? 1);
    expect(chain[0].seat).toBe(activator ?? 1);
    expect(event.text).toBe("Card 80921533 is activating");
    expect(event.publicText).toBe(event.text);
    expect(event.revealCardTo).toBe("all");
    expect(event.zone).toEqual({ controller: 1, location: 8, sequence: 5 });
    expect(chain[0].zone).toEqual(event.zone);
    const resolved = observe({ type: OcgMessageType.CHAIN_SOLVED, chain_size: 1 }, cards, chain, 2)!;
    expect(resolved.seat).toBe(activator ?? 1);
  });
});
