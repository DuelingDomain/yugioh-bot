import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { EngineGame } from "../../src/engine.js";
import { LOCATION_DECKMASTER } from "../../src/domain-core.js";
import { act, defaultAnswer, gameFor, respond, settle, variants, waiting, type Fixture } from "./helpers.js";

const AXE = 48305365;
const JESTER = 8487449;
const RECALL = 888112040;
function removal(master: number): Fixture {
  return { id: RECALL, type: 0x20002, lua: `
local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_IGNITION)
 e:SetRange(LOCATION_SZONE)
 e:SetOperation(function(e,tp)
  local g=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_ONFIELD,0,nil,${master})
  Duel.SendtoGrave(g,REASON_EFFECT)
 end)
 c:RegisterEffect(e)
end` };
}
function nextTurn(game: EngineGame, seat = 0): void {
  for (let turn = 0; turn < game.view(null).seats.length; turn++) {
    respond(game, { choice: "to_ep" });
    settle(game);
    if (game.view(null).turnSeat === seat) return;
  }
  throw new Error(`Did not reach the next turn of seat ${seat}`);
}
function recall(game: EngineGame): void {
  act(game, RECALL);
  expect(game.view(null).seats[0].deckMaster?.inZone).toBe(true);
}
function publicState(game: EngineGame, returns: number, inZone: boolean, actor = 0): void {
  const state = { inZone, returns, nextCost: returns * 500 };
  const spectator = game.view(null);
  expect(spectator.seats[actor].deckMaster).toMatchObject(state);
  for (let seat = 0; seat < spectator.seats.length; seat++) {
    expect(game.view(seat).seats[actor].deckMaster).toEqual(spectator.seats[actor].deckMaster);
  }
}

for (const variant of variants) describe(`Deck Master leave tax (${variant.name})`, () => {
  const baseLp = variant.format === "tag" ? 16000 : 8000;
  const seatCount = variant.format === "1v1" ? 2 : variant.format === "ffa3" ? 3 : 4;
  for (let actor = 1; actor < seatCount; actor++) {
    it(`seat ${actor} pays its own 0/500/1000 LP cost and keeps a separate public counter`, async () => {
      const game = await gameFor(variant, { [`p${actor}`]: { deckMaster: AXE, spells: [RECALL] } }, [removal(AXE)]);
      nextTurn(game, actor);
      let lp = baseLp;
      for (let returns = 0; returns < 3; returns++) {
        publicState(game, returns, true, actor);
        expect(waiting(game).options.find(option => option.card?.code === AXE && option.id.startsWith("summon:"))?.label).toContain(`costs ${returns * 500} LP`);
        act(game, AXE, "summon:");
        lp -= returns * 500;
        expect(game.view(null).seats[actor].lp).toBe(lp);
        publicState(game, returns, false, actor);
        for (const seat of game.view(null).seats) {
          if (seat.seat !== actor) expect(seat.deckMaster).toMatchObject({ inZone: true, returns: 0, nextCost: 0 });
        }
        if (returns < 2) {
          act(game, RECALL);
          publicState(game, returns + 1, true, actor);
          nextTurn(game, actor);
        }
      }
    });
  }
  for (const prefix of ["summon:", "mset:", "spsummon:"]) {
    it(`${prefix} pays 0, 500, then 1000 LP and keeps public return state`, async () => {
      const master = prefix === "spsummon:" ? JESTER : AXE;
      const game = await gameFor(variant, { p0: { deckMaster: master, spells: [RECALL] } }, [removal(master)]);
      expect(game.coreInfo().wasmFile).toBe(variant.legacy ? "ocgcore.domain.legacy.wasm" : variant.format === "1v1" ? "ocgcore.domain.wasm" : "ocgcore.multi-domain.wasm");
      let lp = baseLp;
      for (let returns = 0; returns < 3; returns++) {
        publicState(game, returns, true);
        act(game, master, prefix);
        lp -= returns * 500;
        expect(game.view(null).seats[0].lp).toBe(lp);
        publicState(game, returns, false);
        if (returns < 2) {
          recall(game);
          publicState(game, returns + 1, true);
          expect(game.view(null).seats[0].lp).toBe(lp);
          nextTurn(game);
        }
      }
    });
  }

  it("shows the current cost on the idle actions before summon, set, and special summon", async () => {
    const game = await gameFor(variant, { p0: { deckMaster: JESTER, spells: [RECALL] } }, [removal(JESTER)]);
    for (let returns = 0; returns < 3; returns++) {
      const options = waiting(game).options.filter(option => option.card?.code === JESTER);
      expect(options.map(option => option.id.split(":")[0])).toEqual(expect.arrayContaining(["summon", "mset", "spsummon"]));
      for (const option of options) {
        expect(option.location).toBe(LOCATION_DECKMASTER);
        expect(option.label).toContain(`costs ${returns * 500} LP`);
      }
      act(game, JESTER, "spsummon:");
      if (returns < 2) recall(game);
    }
  });

  it("shows the next cost on the recall prompt and current cost on all public views", async () => {
    const game = await gameFor(variant, { p0: { deckMaster: JESTER, spells: [RECALL] } }, [removal(JESTER)]);
    for (let returns = 1; returns <= 2; returns++) {
      act(game, JESTER, "spsummon:");
      const remove = waiting(game).options.find(option => option.card?.code === RECALL);
      assert(remove);
      respond(game, { choice: remove.id });
      for (let step = 0; step < 30 && waiting(game).context?.type !== "deck-master-recall"; step++) respond(game, defaultAnswer(waiting(game)));
      const prompt = waiting(game);
      expect(prompt.context).toMatchObject({ type: "deck-master-recall", nextCost: returns * 500 });
      expect(prompt.description).toContain(`costs ${returns * 500} LP`);
      respond(game, { choice: "yes" });
      settle(game);
      publicState(game, returns, true);
    }
  });

  it.each([499, 500])("at %i LP offers the free first summon and blocks the 500 LP return cost if LP is too low", async lp => {
    const game = await gameFor(variant, { p0: { lp, deckMaster: AXE, spells: [RECALL] } }, [removal(AXE)]);
    act(game, AXE, "summon:");
    expect(game.view(null).seats[0].lp).toBe(lp);
    recall(game);
    nextTurn(game);
    publicState(game, 1, true);
    const offered = waiting(game).options.filter(option => option.card?.code === AXE);
    if (lp < 500) {
      expect(offered).toEqual([]);
      expect(game.view(null).seats[0].lp).toBe(lp);
    } else {
      expect(offered.map(option => option.id.split(":")[0])).toEqual(expect.arrayContaining(["summon", "mset"]));
      const option = offered.find(option => option.id.startsWith("summon:"));
      assert(option);
      respond(game, { choice: option.id });
      for (let step = 0; step < 20 && game.view(null).seats[0].lp !== 0; step++) respond(game, defaultAnswer(waiting(game)));
      expect(game.view(null).seats[0].lp).toBe(0);
    }
  });

  it("at 1499 LP pays 500 after recall and blocks the third 1000 LP summon at 999 LP", async () => {
    const game = await gameFor(variant, { p0: { lp: 1499, deckMaster: JESTER, spells: [RECALL] } }, [removal(JESTER)]);
    act(game, JESTER, "spsummon:");
    recall(game);
    act(game, JESTER, "spsummon:");
    expect(game.view(null).seats[0].lp).toBe(999);
    recall(game);
    publicState(game, 2, true);
    expect(waiting(game).options.some(option => option.card?.code === JESTER)).toBe(false);
    expect(game.view(null).seats[0].lp).toBe(999);
  });
});
