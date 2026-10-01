import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { optionParts } from "@/components/duel/card-interactions";

const name = "Blue-Eyes Jet Dragon";

describe("optionParts", () => {
  it("drops the card name and the dangling 'with' from attack labels", () => {
    expect(optionParts({ id: "attack:0", label: `Attack directly with ${name}` }, name).main).toBe("Attack directly");
    expect(optionParts({ id: "attack:1", label: `Attack with ${name}` }, name).main).toBe("Attack");
  });

  it("drops the card name from other labels", () => {
    expect(optionParts({ id: "summon:0", label: `Normal Summon ${name}` }, name).main).toBe("Normal Summon");
    expect(optionParts({ id: "pos:0", label: `Change ${name} to` }, name).main).toBe("Change");
  });

  it("moves an activation's effect text into the note", () => {
    expect(optionParts({ id: "activate:0", label: `Activate ${name}: Special Summon this card` }, name)).toEqual({
      main: "Activate",
      note: "Special Summon this card",
    });
  });
});
