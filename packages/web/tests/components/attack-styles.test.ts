import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE,
  MAX_BATTLE_MS,
  NAME_RULES,
  RACE_STYLES,
  SIGNATURES,
  STYLE_IDS,
  STYLE_TIMING,
  TINTS,
  attackStyleFor,
  attributeName,
  battleKind,
  battleTiming,
} from "@/components/duel/attack-styles";

describe("attackStyleFor", () => {
  it("uses a signature attack by passcode, with its own tint and caption", () => {
    const blueEyes = attackStyleFor({ code: 89631139, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: ATTRIBUTE.LIGHT });
    expect(blueEyes).toMatchObject({ style: "lightning", caption: "White Lightning", tintName: "WHITE_BLUE" });
    expect(blueEyes.tint).toBe(TINTS.WHITE_BLUE);
    expect(attackStyleFor({ code: 46986414 }).style).toBe("arcane");
    expect(attackStyleFor({ code: 38033121 }).caption).toBe("Dark Burning Attack");
    expect(attackStyleFor({ code: 74677422 })).toMatchObject({ style: "flame", caption: "Inferno Fire Blast" });
    expect(attackStyleFor({ code: 70095154 })).toMatchObject({ style: "beam", caption: "Evolution Burst" });
    expect(attackStyleFor({ code: 70781052 })).toMatchObject({ style: "lightning", caption: "Lightning Strike" });
    expect(Object.keys(SIGNATURES)).toHaveLength(6);
  });

  it("lets a signature beat a name rule and the race table", () => {
    // "Dark Magician" would match the magician name rule (arcane) and Spellcaster (arcane); Cyber Dragon is
    // a "cyber" name (beam) and a Dragon (flame) but its signature is beam anyway. Prove precedence directly:
    expect(attackStyleFor({ code: 70781052, name: "Summoned Skull", race: "Fiend" }).rule).toBe("signature 70781052");
    expect(attackStyleFor({ code: 89631139, name: "Flame Swordsman", race: "Warrior" }).style).toBe("lightning");
  });

  it("lets a name keyword beat the race table", () => {
    expect(attackStyleFor({ code: 1, name: "Flame Swordsman", race: "Warrior", attribute: ATTRIBUTE.FIRE }).style).toBe("slash");
    expect(attackStyleFor({ code: 1, name: "Tiger Axe", race: "Beast-Warrior" }).style).toBe("slash"); // sword rule ("axe") before claw ("tiger")
    expect(attackStyleFor({ code: 1, name: "Silver Fang", race: "Beast" }).style).toBe("claw");
    expect(attackStyleFor({ code: 1, name: "Thunder Dragon", race: "Thunder" }).style).toBe("lightning");
    expect(attackStyleFor({ code: 1, name: "Cyber Ogre", race: "Warrior" }).style).toBe("beam");
    expect(attackStyleFor({ code: 1, name: "Apprentice Magician", race: "Fiend" }).style).toBe("arcane");
    expect(attackStyleFor({ code: 1, name: "Blaze Rock", race: "Rock" }).style).toBe("flame");
    for (const rule of NAME_RULES) expect(STYLE_IDS).toContain(rule.style);
  });

  it("falls back to the race table", () => {
    const cases: Array<[string, string]> = [
      ["Warrior", "slash"], ["Beast-Warrior", "slash"], ["Beast", "claw"], ["Dinosaur", "claw"], ["Winged Beast", "claw"],
      ["Machine", "beam"], ["Cyberse", "beam"], ["Spellcaster", "arcane"], ["Fiend", "arcane"], ["Thunder", "lightning"],
      ["Pyro", "flame"], ["Dragon", "flame"], ["Rock", "impact"], ["Aqua", "impact"], ["Divine-Beast", "impact"],
    ];
    for (const [race, style] of cases) {
      const result = attackStyleFor({ code: 999, name: "Plain Monster", race });
      expect(result.style).toBe(style);
      expect(result.rule).toBe(`race ${race}`);
    }
    for (const style of Object.values(RACE_STYLES)) expect(STYLE_IDS).toContain(style);
  });

  it("defaults to impact for an unknown race, or no card at all", () => {
    expect(attackStyleFor({ code: 1, name: "Clown Crew Biancaviso", race: "Illusion" })).toMatchObject({ style: "impact", rule: "default" });
    expect(attackStyleFor({})).toMatchObject({ style: "impact", tint: TINTS.LIGHT });
    expect(attackStyleFor(null).style).toBe("impact");
    expect(attackStyleFor(undefined).caption).toBeNull();
  });

  it("tints from the attribute unless the signature sets one", () => {
    expect(attackStyleFor({ code: 1, race: "Warrior", attribute: ATTRIBUTE.FIRE }).tint).toBe(TINTS.FIRE);
    expect(attackStyleFor({ code: 1, race: "Warrior", attribute: ATTRIBUTE.WATER }).tintName).toBe("WATER");
    expect(attackStyleFor({ code: 1, race: "Dragon", attribute: ATTRIBUTE.DARK }).tint).toBe(TINTS.DARK);
    expect(attackStyleFor({ code: 1, race: "Dragon" }).tint).toBe(TINTS.LIGHT);
    // A signature with a tint ignores the attribute (Blue-Eyes is LIGHT but white-blue).
    expect(attackStyleFor({ code: 89631139, attribute: ATTRIBUTE.DARK }).tint).toBe(TINTS.WHITE_BLUE);
  });

  it("names attribute bits, lowest bit first", () => {
    expect(attributeName(ATTRIBUTE.DIVINE)).toBe("DIVINE");
    expect(attributeName(0)).toBeNull();
    expect(attributeName(undefined)).toBeNull();
    expect(attributeName(ATTRIBUTE.LIGHT | ATTRIBUTE.DARK)).toBe("LIGHT");
  });
});

describe("battle timing", () => {
  it("classifies the fight from the destroyed cards", () => {
    expect(battleKind(true, { attacker: false, target: false })).toBe("direct");
    expect(battleKind(false, { attacker: false, target: true })).toBe("win");
    expect(battleKind(false, { attacker: true, target: false })).toBe("lose");
    expect(battleKind(false, { attacker: true, target: true })).toBe("tie");
    expect(battleKind(false, { attacker: false, target: false })).toBe("held");
  });

  it("keeps every single-strike attack at or under 1.6 s and the whole table sane", () => {
    for (const id of STYLE_IDS) {
      const t = battleTiming("win", id, "impact");
      expect(t.impactMs).toBe(STYLE_TIMING[id].impact);
      expect(t.totalMs).toBeLessThanOrEqual(1600);
      expect(t.impactMs).toBeLessThan(t.totalMs);
    }
  });

  it("keeps a counter-strike fight under the battle ceiling, and rolls the attacker's LP at the counter's impact", () => {
    for (const a of STYLE_IDS) {
      for (const d of STYLE_IDS) {
        const t = battleTiming("lose", a, d);
        expect(t.totalMs).toBeLessThanOrEqual(MAX_BATTLE_MS);
        expect(t.attackerDamageMs).toBeGreaterThan(t.impactMs);
        expect(t.attackerDamageMs).toBeLessThan(t.totalMs);
      }
      expect(battleTiming("tie", a, "slash").totalMs).toBeLessThanOrEqual(MAX_BATTLE_MS);
    }
  });
});
