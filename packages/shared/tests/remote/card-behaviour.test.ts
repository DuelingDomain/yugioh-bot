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
    expect(table.get(14558127)).toMatchObject({ handQuick: true, cost: ["discard"], leaves: ["gy"] });
    expect(table.get(23434538)).toMatchObject({ handQuick: true, cost: ["toGY"], draws: true });
    // Banish effects name the zone they take from: the opponent's GY, your Deck, the opponent's field face-down.
    expect(table.get(24224830)?.sends).toEqual([{ to: "banish", from: ["opponentGy"] }]);
    expect(table.get(65681983)?.sends).toEqual([{ to: "banish", from: ["deck"] }]);
    expect(table.get(33854624)?.sends).toContainEqual({ to: "banish", from: ["field", "gy", "opponentGy"] }); // Bystial Magnamhut
    expect(table.get(33854624)?.handQuick).toBe(true);
    expect(table.get(32909498)?.sends).toContainEqual({ to: "banishDown", from: ["opponentField"] }); // Kashtira Fenrir
    // A Pendulum Monster that returns itself to the Extra Deck face-up.
    expect(table.get(70155677)?.leaves).toEqual(["extraUp"]);
    // A card the scan found nothing for is unknown.
    expect(table.get(0)).toBeUndefined();
    expect(table.get(undefined)).toBeUndefined();
  });
});
