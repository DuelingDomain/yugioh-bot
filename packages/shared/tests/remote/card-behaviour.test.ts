import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCardBehaviour, type CardBehaviourData } from "../../src/remote/card-behaviour.js";

// The committed table is generated from the engine card scripts (build-card-behaviour.ts, checked in CI against the pinned data).
// These are real cards, so a script or scanner change that breaks a movement fact fails here.
const data = JSON.parse(readFileSync(new URL("../../../web/src/lib/remote/card-behaviour-data.json", import.meta.url), "utf8")) as CardBehaviourData;
const table = createCardBehaviour(data);

describe("card behaviour table", () => {
  it("knows how real cards move through the zones", () => {
    // Cyber Dragon Infinity takes material from either field; its negate detaches one. The alt art shares the record.
    expect(table.get(10443957)).toMatchObject({ cost: ["detach"], detach: { min: 1, max: 1 }, attach: { from: ["field", "opponentField"] } });
    expect(table.get(10443958)).toBe(table.get(10443957));
    // Number 41: Bagooska pays a material each of your Standby Phases.
    expect(table.get(90590303)).toMatchObject({ cost: expect.arrayContaining(["detach"]), detach: { min: 1, max: 1 } });
    // Hand traps: a quick effect from the hand, and the card itself goes to the GY as cost.
    expect(table.get(14558127)).toMatchObject({ handQuick: true, cost: ["discard"], leaves: [{ to: "gy", from: ["hand"] }] });
    expect(table.get(23434538)).toMatchObject({ handQuick: true, cost: ["toGY"], leaves: [{ to: "gy", from: ["hand"] }], draws: true });
    // Banish effects name the zone they take from: the opponent's GY, your Deck, the opponent's field face-down.
    expect(table.get(24224830)?.sends).toEqual([{ to: "banish", from: ["opponentGy"] }]);
    expect(table.get(65681983)?.sends).toEqual([{ to: "banish", from: ["deck"] }]);
    expect(table.get(33854624)?.sends).toContainEqual({ to: "banish", from: ["field", "gy", "opponentGy"] }); // Bystial Magnamhut
    expect(table.get(33854624)?.handQuick).toBe(true);
    expect(table.get(32909498)?.sends).toContainEqual({ to: "banishDown", from: ["opponentField"] }); // Kashtira Fenrir
    // A Pendulum Monster sent from the field goes to the Extra Deck face-up, not the GY.
    expect(table.get(16178681)?.leaves).toEqual([{ to: "extraUp", from: ["field"] }]); // Odd-Eyes Pendulum Dragon
    expect(table.get(70155677)?.leaves).toEqual([{ to: "extraUp", from: ["field"] }]);
    // Each move reads its own source: Dingirsu takes only banished cards as material (the opponent's field is the destroy target).
    expect(table.get(93854893)).toMatchObject({ attach: { from: ["banish"] }, sends: [{ to: "gy", from: ["opponentField"] }] });
    // A leave names the zone it leaves from; an effect that only registers on another card does not count as this card leaving.
    expect(table.get(98567237)?.leaves).toEqual([{ to: "banish", from: ["gy"] }]); // Fiendsmith's Tract
    expect(table.get(75500286)?.leaves).toBeUndefined(); // Gold Sarcophagus: the delayed effect belongs to the banished card
    // An alias with a script of its own is its own card (Odd-Eyes Arcray Dragon is not Z-ARC); a stub script loads the other one.
    expect(table.get(6218704)).toEqual(table.get(6218705));
    expect(table.get(6218704)?.partial).toBe(true);
    expect(table.get(35261759)).toMatchObject({ costOther: ["banishDown"], draws: true }); // Pot of Desires
    // A card the scan found nothing for is unknown.
    expect(table.get(0)).toBeUndefined();
    expect(table.get(undefined)).toBeUndefined();
  });
});
