import assert from "node:assert/strict";
import { expect, it } from "vitest";
import type { DuelCard, DuelFormat } from "@yugidraft/shared/duels";
import { getDuelCounterMetadata } from "@yugidraft/shared/duels";
import { OcgCardHintType, OcgLocation, OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../src/engine.js";
import { CardHints } from "../src/card-hints.js";
import { loadCardDatabase } from "../src/cards.js";
import { sameReplayBoard } from "../src/replay-board-comparator.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { compileBoard, type BoardSpec } from "./support/board.js";
import { activate, defineScenario, expectBoard, pickOpponent, zone, type Step } from "./support/dsl.js";
import { Session } from "./support/session.js";
import { describeWithCores, needs } from "./support/cores.js";

const ACTOR = "Mystical Elf";
const SUBJECT = "Dark Magician";
const KNOWN = String(57761191n * 1048576n + 2n);
const UNKNOWN = "9223372036854775807";
const variants = [
  { name: "legacy", format: "1v1", legacy: true },
  { name: "pinned", format: "1v1", legacy: false },
  { name: "ffa3", format: "ffa3", legacy: false },
  { name: "ffa4", format: "ffa4", legacy: false },
  { name: "tag", format: "tag", legacy: false },
] as const;

// These zero-value effects only create real client-hint add/remove messages. The operation is
// a real, selectable Ignition Effect, so yielding control/position operations run in the core.
const markerHelper = `
  local function mark(c,description,reset)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_SINGLE)
    e:SetCode(EFFECT_UPDATE_ATTACK)
    e:SetValue(0)
    e:SetProperty(EFFECT_FLAG_CLIENT_HINT)
    e:SetDescription(description)
    e:SetReset(RESET_EVENT|(reset or (RESETS_STANDARD&~RESET_CONTROL)))
    c:RegisterEffect(e)
    return e
  end
`;

async function open(format: DuelFormat, legacy: boolean, setup: string, operations: string[], board: BoardSpec = {
  p0: { monsters: [ACTOR, SUBJECT, "Blue-Eyes White Dragon"] }, p1: {},
}) {
  const scenario = defineScenario({ id: "card-hints-lifecycle", title: "Real card hint lifecycle",
    source: "Approved backend status design", tags: ["status"],
    setup: { ...board, format, skipOpeningDraw: true }, steps: [] });
  const compiled = compileBoard(scenario.setup, engineDataDirectory);
  const messages: OcgMessage[] = [];
  const operation = operations.map((body, index) => `${index ? "elseif" : "if"} stage==${index + 1} then\n${body}`).join("\n");
  const game: EngineGame = await (legacy ? createLegacyEngineGame : createEngineGame)({
    ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
    onCoreMessage: message => messages.push(message),
    startupScripts: [...(compiled.options.startupScripts ?? []), {
      name: "card-hints-lifecycle.lua", content: `${markerHelper}
        local subject=Duel.GetFieldCard(0,LOCATION_MZONE,1)
        ${setup}
        local actor=Duel.GetFieldCard(0,LOCATION_MZONE,0)
        local stage=0
        local action=Effect.CreateEffect(actor)
        action:SetDescription(1000)
        action:SetType(EFFECT_TYPE_IGNITION)
        action:SetRange(LOCATION_MZONE)
        action:SetOperation(function()
          stage=stage+1
          ${operation}
          end
        end)
        actor:RegisterEffect(action)
      `,
    }],
  });
  const session = new Session(scenario, game);
  try { session.reachMainPhase(); }
  catch (error) { game.close(); throw error; }
  let index = 0;
  const run = (...steps: Step[]) => steps.forEach(step => session.run(step, ++index));
  return { game, messages, run, act: () => run(activate(ACTOR), expectBoard({})) };
}

const ids = (card: DuelCard | null | undefined) => card?.hints?.map(hint => hint.descriptionId);
const fieldCard = (game: EngineGame, seat = 0, sequence = 1) => game.view(null).seats[seat].monsters[sequence];

for (const { name, format, legacy } of variants) {
  describeWithCores(`real hint lifecycle (${name})`, [needs.cards(), needs.scripts(),
    ...(format === "1v1" ? [needs.standard()] : [needs.installedMulti()])], () => {
    it("classifies live combined protection text without treating attack restrictions as protection", async () => {
      const { game } = await open(format, legacy,
        "for _,description in ipairs({3104,3008,3009,3007,3206}) do mark(subject,description) end", [""]);
      try {
        expect(fieldCard(game)?.hints).toEqual([
          { descriptionId: "3007", text: "Cannot be targeted for an attack", categories: ["cannot-be-attacked"] },
          { descriptionId: "3008", text: "Cannot be destroyed by battle or card effects",
            categories: ["cannot-be-destroyed-by-battle", "cannot-be-destroyed-by-effects"] },
          { descriptionId: "3009", text: "Cannot be targeted or destroyed by card effects",
            categories: ["cannot-be-destroyed-by-effects", "cannot-be-targeted"] },
          { descriptionId: "3104", text: "Unaffected by Spell/Trap effects", categories: ["unaffected-spells", "unaffected-traps"] },
          { descriptionId: "3206", text: "Cannot attack", categories: ["status"] },
        ]);
      } finally { game.close(); }
    });

    it("reference-counts equal descriptors and preserves unknown 64-bit IDs in public JSON", async () => {
      const { game, act } = await open(format, legacy,
        `local first=mark(subject,${KNOWN}); local second=mark(subject,${KNOWN})
         local unknown=mark(subject,${UNKNOWN})`, ["first:Reset()", "second:Reset()", "unknown:Reset()"]);
      try {
        expect(ids(fieldCard(game))).toEqual([KNOWN, UNKNOWN]);
        expect(fieldCard(game)?.hints?.[1]).toEqual({ descriptionId: UNKNOWN,
          text: `Status (${UNKNOWN})`, categories: ["status"] });
        const before = JSON.stringify(game.view(null));
        for (const viewer of [1, 0, null, 1]) expect(ids(game.view(viewer).seats[0].monsters[1])).toEqual([KNOWN, UNKNOWN]);
        expect(JSON.stringify(game.view(null))).toBe(before);
        expect(JSON.parse(before).seats[0].monsters[1].hints[1].descriptionId).toBe(UNKNOWN);
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN, UNKNOWN]);
        act();
        expect(ids(fieldCard(game))).toEqual([UNKNOWN]);
        act();
        expect(fieldCard(game)?.hints).toBeUndefined();
      } finally { game.close(); }
    });

    it("preserves a counter's WITHOUT_PERMIT flag in the shared catalog lookup", async () => {
      const { game, act } = await open(format, legacy, "", ["assert(subject:AddCounter(0x100e,2))"]);
      try {
        act();
        const counters = fieldCard(game)?.counters;
        expect(counters).toEqual([{ type: 0x100e, count: 2 }]);
        expect(getDuelCounterMetadata(counters![0]!.type)).toEqual({
          key: "a", name: "A-Counter", family: "combat", glyph: "a",
        });
      } finally { game.close(); }
    });

    it("compares legacy lossy counter boards only when explicitly allowed", async () => {
      const { game, act } = await open(format, legacy, "", ["assert(subject:AddCounter(0x100e,2))"]);
      try {
        act();
        const rebuilt = game.view(null), saved = structuredClone(rebuilt);
        saved.seats[0].monsters[1]!.counters = [{ type: 2, count: 0x100e }];
        expect(sameReplayBoard(saved, rebuilt)).toBe(false);
        expect(sameReplayBoard(saved, rebuilt, { allowLegacyCounters: true })).toBe(true);
        // The old decoder keyed by count: equal counts lost all but the last type.
        rebuilt.seats[0].monsters[1]!.counters!.push({ type: 0x100f, count: 2 });
        saved.seats[0].monsters[1]!.counters = [{ type: 2, count: 0x100f }];
        expect(sameReplayBoard(saved, rebuilt, { allowLegacyCounters: true })).toBe(true);
        saved.seats[0].lp--;
        expect(sameReplayBoard(saved, rebuilt, { allowLegacyCounters: true })).toBe(false);
      } finally { game.close(); }
    });

    it("retains hints through a face-down reset only when their core effects survive", async () => {
      const { game, act } = await open(format, legacy,
        `mark(subject,${KNOWN},RESETS_STANDARD&~RESET_TURN_SET); mark(subject,${UNKNOWN})`, [
          "assert(Duel.ChangePosition(subject,POS_FACEDOWN_DEFENSE)>0)",
          "assert(Duel.ChangePosition(subject,POS_FACEUP_ATTACK)>0)",
        ]);
      try {
        expect(ids(fieldCard(game))).toEqual([KNOWN, UNKNOWN]);
        act();
        for (const viewer of [0, 1, null]) expect(game.view(viewer).seats[0].monsters[1]?.hints).toBeUndefined();
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
      } finally { game.close(); }
    });

    it("retains a hint registered face-down until its core effect resets", async () => {
      const { game, act } = await open(format, legacy, "", [
        `assert(Duel.ChangePosition(subject,POS_FACEDOWN_DEFENSE)>0); local hidden=mark(subject,${KNOWN})`,
        "assert(Duel.ChangePosition(subject,POS_FACEUP_ATTACK)>0)",
      ]);
      try {
        act();
        expect(fieldCard(game)?.hints).toBeUndefined();
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
      } finally { game.close(); }
    });

    it("retains off-field hints when the core carries them onto the field", async () => {
      const { game, act } = await open(format, legacy,
        `local waiting=Duel.GetFieldGroup(0,LOCATION_GRAVE,0):GetFirst(); mark(waiting,${KNOWN},0)`, [
          "assert(Duel.SpecialSummon(waiting,0,0,0,false,false,POS_FACEUP_ATTACK)>0)",
        ], { p0: { monsters: [ACTOR, SUBJECT], grave: ["Blue-Eyes White Dragon"] }, p1: {} });
      try {
        expect(game.view(null).seats[0].graveyard[0]?.hints).toBeUndefined();
        act();
        const summoned = game.view(null).seats[0].monsters.find(card => card?.name === "Blue-Eyes White Dragon");
        expect(ids(summoned)).toEqual([KNOWN]);
      } finally { game.close(); }
    });

    it("compacts hinted piles after simultaneous removals using the original coordinates", async () => {
      const { game, act } = await open(format, legacy, `
        local pile=Duel.GetFieldGroup(0,LOCATION_GRAVE,0)
        local waiting=pile:Filter(Card.IsCode,nil,89631139):GetFirst()
        assert(waiting:GetSequence()==2)
        local removed=pile:Filter(function(c) return c~=waiting end,nil)
        mark(waiting,${KNOWN},0)
        for c in aux.Next(removed) do mark(c,${UNKNOWN},0) end
      `, ["Duel.RemoveCards(removed)", "assert(Duel.SpecialSummon(waiting,0,0,0,false,false,POS_FACEUP_ATTACK)>0)"], {
        p0: { monsters: [ACTOR, SUBJECT], grave: [SUBJECT, "Celtic Guardian", "Blue-Eyes White Dragon"] }, p1: {},
      });
      try {
        act();
        expect(game.view(null).seats[0].graveyard.map(card => card.name)).toEqual(["Blue-Eyes White Dragon"]);
        act();
        const summoned = game.view(null).seats[0].monsters.find(card => card?.name === "Blue-Eyes White Dragon");
        expect(ids(summoned)).toEqual([KNOWN]);
      } finally { game.close(); }
    });

    it("does not assign old Extra Deck hints to cards inserted by a deck/grave swap", async () => {
      const { game, act } = await open(format, legacy, `
        local waiting=Debug.AddCard(16178681,0,0,LOCATION_EXTRA,0,POS_FACEUP_DEFENSE)
        mark(waiting,${KNOWN},0)
        local returned=Duel.GetFieldGroup(0,LOCATION_GRAVE,0):GetFirst()
      `, ["Duel.SwapDeckAndGrave(0)", "assert(Duel.SpecialSummon(returned,0,0,0,true,true,POS_FACEUP_ATTACK)>0)"], {
        p0: { monsters: [ACTOR, SUBJECT], grave: ["Stardust Dragon"] }, p1: {},
      });
      try {
        act();
        expect(game.view(0).seats[0].extra.map(card => card.name)).toEqual(["Stardust Dragon", "Odd-Eyes Pendulum Dragon"]);
        act();
        const summoned = game.view(null).seats[0].monsters.find(card => card?.name === "Stardust Dragon");
        expect(summoned).toBeDefined();
        expect(summoned?.hints).toBeUndefined();
      } finally { game.close(); }
    });

    it("keeps hints on face-up Extra cards whose sequence a shuffle does not change", async () => {
      const { game, act } = await open(format, legacy, `
        local waiting=Debug.AddCard(16178681,0,0,LOCATION_EXTRA,0,POS_FACEUP_DEFENSE)
        mark(waiting,${KNOWN},0)
      `, ["Duel.ShuffleExtra(0)", "assert(Duel.SpecialSummon(waiting,0,0,0,true,true,POS_FACEUP_ATTACK)>0)"], {
        p0: { monsters: [ACTOR, SUBJECT], extra: ["Stardust Dragon", "Black Rose Dragon"] }, p1: {},
      });
      try {
        act();
        act();
        const summoned = game.view(null).seats[0].monsters.find(card => card?.name === "Odd-Eyes Pendulum Dragon");
        expect(ids(summoned)).toEqual([KNOWN]);
      } finally { game.close(); }
    });

    it("re-derives shuffled hand hints from the core without duplicating descriptor counts", async () => {
      const { game, act } = await open(format, legacy, `
        local waiting=Duel.GetFieldGroup(0,LOCATION_HAND,0):Filter(Card.IsCode,nil,89631139):GetFirst()
        local first=mark(waiting,${KNOWN},0)
      `, ["Duel.ShuffleHand(0)", "assert(Duel.SpecialSummon(waiting,0,0,0,true,true,POS_FACEUP_ATTACK)>0)", "first:Reset()"], {
        p0: { monsters: [ACTOR, SUBJECT], hand: ["Blue-Eyes White Dragon", "Celtic Guardian"] }, p1: {},
      });
      try {
        act();
        act();
        const summoned = () => game.view(null).seats[0].monsters.find(card => card?.name === "Blue-Eyes White Dragon");
        expect(ids(summoned())).toEqual([KNOWN]);
        act();
        expect(summoned()?.hints).toBeUndefined();
      } finally { game.close(); }
    });

    it("keeps an Xyz host's hints on the host through material moves and removals", async () => {
      const { game, act, messages } = await open(format, legacy, `
        mark(subject,${KNOWN},0)
        local material=subject:GetOverlayGroup():GetFirst()
      `, ["assert(Duel.SendtoGrave(material,REASON_EFFECT)>0)", "assert(Duel.SpecialSummon(material,0,0,0,true,true,POS_FACEUP_ATTACK)>0)",
        "Duel.Overlay(subject,material)", "Duel.RemoveCards(subject:GetOverlayGroup())"], {
        p0: { monsters: [ACTOR, { card: "Number 39: Utopia", materials: ["Blue-Eyes White Dragon"] }] }, p1: {},
      });
      try {
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
        const summoned = game.view(null).seats[0].monsters.find(card => card?.name === "Blue-Eyes White Dragon");
        expect(summoned).toBeDefined();
        expect(summoned?.hints).toBeUndefined();
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
        expect(fieldCard(game)?.materials).toHaveLength(1);
        act();
        expect(ids(fieldCard(game))).toEqual([KNOWN]);
        if (!legacy) expect(messages.some(message => message.type === OcgMessageType.REMOVE_CARDS
          && message.cards.some(card => card.overlay_sequence != null))).toBe(true);
      } finally { game.close(); }
    });

    it("follows field moves and an atomic swap without leaving hints on the old slot", async () => {
      const { game, act, messages } = await open(format, legacy,
        `mark(subject,${KNOWN}); mark(Duel.GetFieldCard(0,LOCATION_MZONE,2),${UNKNOWN})`, [
          "assert(Duel.MoveSequence(subject,3))",
          "Duel.SwapSequence(subject,Duel.GetFieldCard(0,LOCATION_MZONE,2))",
        ]);
      try {
        act();
        expect(fieldCard(game)).toBeNull();
        expect(ids(fieldCard(game, 0, 3))).toEqual([KNOWN]);
        act();
        expect(fieldCard(game, 0, 2)?.name).toBe(SUBJECT);
        expect(ids(fieldCard(game, 0, 2))).toEqual([KNOWN]);
        expect(ids(fieldCard(game, 0, 3))).toEqual([UNKNOWN]);
        if (!legacy) expect(messages.some(message => message.type === OcgMessageType.SWAP)).toBe(true);
      } finally { game.close(); }
    });

    it("follows a control MOVE and resets the hint when the monster is turned face-down", async () => {
      const { game, run, act, messages } = await open(format, legacy, `mark(subject,${KNOWN})`, [
        "assert(Duel.GetControl(subject,1,0,0,1))",
        "assert(Duel.ChangePosition(subject,POS_FACEDOWN_DEFENSE)>0)",
        "assert(Duel.ChangePosition(subject,POS_FACEUP_ATTACK)>0)",
      ]);
      try {
        run(activate(ACTOR));
        if (format !== "1v1") run(pickOpponent("p1"));
        run(expectBoard({}));
        expect(fieldCard(game)).toBeNull();
        expect(ids(fieldCard(game, 1, 0))).toEqual([KNOWN]);
        act();
        for (const viewer of [0, 1, null]) expect(game.view(viewer).seats[1].monsters[0]?.hints).toBeUndefined();
        expect(game.view(null).seats[1].monsters[0]?.code).toBeUndefined();
        act();
        expect(fieldCard(game, 1, 0)?.name).toBe(SUBJECT);
        expect(fieldCard(game, 1, 0)?.hints).toBeUndefined();
        if (!legacy) {
          expect(messages.some(message => message.type === OcgMessageType.MOVE
            && message.from.controller === 0 && message.to.controller === 1)).toBe(true);
          expect(messages.some(message => message.type === OcgMessageType.POS_CHANGE)).toBe(true);
        }
      } finally { game.close(); }
    });

    for (const removal of ["send to Graveyard", "remove from duel"] as const) {
      it(`clears a departing instance (${removal}) before an identical copy reuses its old slot`, async () => {
        const departure = removal === "send to Graveyard" ? "assert(Duel.SendtoGrave(subject,REASON_EFFECT)>0)"
          : "Duel.RemoveCards(subject)";
        const { game, act, messages } = await open(format, legacy, `mark(subject,${KNOWN})`, [
          `${departure}\nassert(Duel.MoveSequence(Duel.GetFieldCard(0,LOCATION_MZONE,2),1))`,
        ], { p0: { monsters: [ACTOR, SUBJECT, SUBJECT] }, p1: {} });
        try {
          act();
          expect(fieldCard(game)?.name).toBe(SUBJECT);
          expect(fieldCard(game)?.hints).toBeUndefined();
          expect(game.view(null).seats[0].graveyard.find(card => card.name === SUBJECT)?.hints).toBeUndefined();
          if (!legacy && removal === "remove from duel") {
            expect(messages.some(message => message.type === OcgMessageType.REMOVE_CARDS)).toBe(true);
          }
        } finally { game.close(); }
      });
    }
  });
}

for (const format of ["ffa3", "ffa4"] as const) {
  describeWithCores(`real cyclic hint moves (${format})`, [needs.cards(), needs.scripts(), needs.installedMulti()], () => {
    it("binds new-destination removals to incoming cards while preserving every displaced instance", async () => {
      const seats = format === "ffa3" ? 3 : 4;
      const uniqueIds = Array.from({ length: seats }, (_, seat) => String(BigInt(UNKNOWN) - BigInt(seat + 1)));
      const board: BoardSpec = { p0: { monsters: [ACTOR, SUBJECT] },
        p1: { monsters: [null, "Blue-Eyes White Dragon"] }, p2: { monsters: [null, "Summoned Skull"] },
        ...(seats === 4 ? { p3: { monsters: [null, "Celtic Guardian"] } } : {}) };
      const { game, run, messages } = await open(format, false, `
        assert(type(Duel.MPRotateControl)=="function","Installed core needs Duel.MPRotateControl")
        local rotating=Group.CreateGroup()
        for seat=0,${seats - 1} do
          local c=Duel.GetFieldCard(seat,LOCATION_MZONE,1)
          rotating:AddCard(c)
          mark(c,${KNOWN})
        end
        ${uniqueIds.map((id, seat) => `mark(Duel.GetFieldCard(${seat},LOCATION_MZONE,1),${id})`).join("\n")}
        mark(subject,${KNOWN},RESETS_STANDARD|RESET_CONTROL)
      `, ["assert(Duel.MPRotateControl(rotating))"], board);
      try {
        const codes = Array.from({ length: seats }, (_, seat) => fieldCard(game, seat)?.code);
        for (let seat = 0; seat < seats; seat++) expect(ids(fieldCard(game, seat))).toEqual([KNOWN, uniqueIds[seat]]);
        run(activate(ACTOR));
        for (let seat = 0; seat < seats; seat++) run(zone(`p${seat}` as "p0" | "p1" | "p2" | "p3", "m1"));
        run(expectBoard({}));
        for (let source = 0; source < seats; source++) {
          const card = fieldCard(game, (source + 1) % seats);
          expect(card?.code).toBe(codes[source]);
          expect.soft(ids(card), `Card from seat ${source} moved to seat ${(source + 1) % seats}`).toEqual([KNOWN, uniqueIds[source]]);
        }
        // Feed the real core stream in batches ending at each MOVE. Rotations may yield
        // between moves; displaced occupants must survive the next beginBatch call.
        const rebuilt = new CardHints();
        let start = 0;
        for (let end = 0; end <= messages.length; end++) {
          if (end < messages.length && messages[end].type !== OcgMessageType.MOVE) continue;
          const batch = messages.slice(start, end + 1);
          rebuilt.beginBatch(batch);
          for (const message of batch) rebuilt.observe(message);
          start = end + 1;
        }
        for (let seat = 0; seat < seats; seat++) {
          const original = fieldCard(game, seat)!;
          const { hints: _hints, ...bare } = original;
          expect(ids(rebuilt.project(bare, loadCardDatabase(engineDataDirectory)))).toEqual(ids(original));
        }
        const removeIndex = messages.findIndex(message => message.type === OcgMessageType.CARD_HINT
          && message.card_hint === OcgCardHintType.DESC_REMOVE && message.description === BigInt(KNOWN));
        expect(removeIndex).toBeGreaterThanOrEqual(0);
        const remove = messages[removeIndex];
        assert(remove.type === OcgMessageType.CARD_HINT);
        const move = messages.slice(removeIndex + 1).find(message => message.type === OcgMessageType.MOVE);
        assert(move?.type === OcgMessageType.MOVE);
        expect([remove.controller, remove.location, remove.sequence]).toEqual([
          move.to.controller, OcgLocation.MZONE, move.to.sequence,
        ]);
      } finally { game.close(); }
    });
  });
}
