import { describe, expect, it } from "vitest";
import { OcgLocation } from "ocgcore-wasm";
import { attributeName, fillPlaceholders, hasPlaceholders, locationLabel, positionLabel, raceName } from "../src/text.js";

describe("fillPlaceholders", () => {
  it("fills card name and location in order for the trigger-effect string", () => {
    const text = fillPlaceholders('Activate the Trigger Effect of "%ls" from [%ls]?', ["Giant Rat", "Graveyard"]);
    expect(text).toBe('Activate the Trigger Effect of "Giant Rat" from [Graveyard]?');
    expect(hasPlaceholders(text)).toBe(false);
  });

  it("fills numbers and mixed specifiers from the same queue", () => {
    expect(fillPlaceholders('Remove %d "%ls"', [2, "Spell Counter"])).toBe('Remove 2 "Spell Counter"');
    expect(fillPlaceholders('"%ls" [%ls (%d)] targeted', ["Sangan", "Monster Zone", 3])).toBe('"Sangan" [Monster Zone (3)] targeted');
    expect(fillPlaceholders("Gain %d LP (%d%%)", [500, 10])).toBe("Gain 500 LP (10%)");
  });

  it("drops placeholders it cannot fill and tidies the sentence", () => {
    expect(fillPlaceholders('Activate the Trigger Effect of "%ls" from [%ls]?', ["Giant Rat"])).toBe('Activate the Trigger Effect of "Giant Rat"?');
    expect(fillPlaceholders('Use the effect of "%ls"?', [])).toBe("Use the effect?");
    expect(fillPlaceholders('Select the zone to place "%ls"', [undefined])).toBe("Select the zone to place");
    expect(fillPlaceholders("Plain text", ["ignored"])).toBe("Plain text");
    expect(fillPlaceholders("", ["x"])).toBe("");
  });
});

describe("labels", () => {
  it("names locations the way the core's [%ls] expects", () => {
    expect(locationLabel(OcgLocation.GRAVE)).toBe("Graveyard");
    expect(locationLabel(OcgLocation.HAND)).toBe("hand");
    expect(locationLabel(OcgLocation.DECK)).toBe("Deck");
    expect(locationLabel(OcgLocation.EXTRA)).toBe("Extra Deck");
    expect(locationLabel(OcgLocation.REMOVED)).toBe("banished");
    expect(locationLabel(OcgLocation.MZONE, 2)).toBe("Monster Zone");
    expect(locationLabel(OcgLocation.MZONE, 5)).toBe("Extra Monster Zone");
    expect(locationLabel(OcgLocation.SZONE, 1)).toBe("Spell & Trap Zone");
    expect(locationLabel(OcgLocation.SZONE, 5)).toBe("Field Zone");
    expect(locationLabel(OcgLocation.SZONE, 6)).toBe("Pendulum Zone");
    expect(locationLabel(0x4000)).toBe("Deck Master Zone");
    expect(locationLabel(OcgLocation.OVERLAY)).toBe("Xyz Material");
  });

  it("gives readable position, attribute and type names", () => {
    expect(positionLabel(0x1)).toBe("Face-up Attack");
    expect(positionLabel(0x2)).toBe("Face-down Attack");
    expect(positionLabel(0x4)).toBe("Face-up Defense");
    expect(positionLabel(0x8)).toBe("Face-down Defense");
    expect(attributeName(0x20)).toBe("DARK");
    expect(attributeName(0x1)).toBe("EARTH");
    expect(raceName(1n)).toBe("Warrior");
    expect(raceName(0x8000n)).toBe("Beast-Warrior");
    expect(raceName(0x200)).toBe("Winged Beast");
  });
});
