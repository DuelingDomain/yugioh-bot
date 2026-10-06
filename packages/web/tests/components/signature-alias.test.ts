import { describe, expect, it } from "vitest";
import { attackStyleFor } from "../../src/components/duel/attack-styles";
import { pieceOf } from "../../src/components/duel/fx3d/scene-plan";
import { signatureCode } from "../../src/components/duel/signature-alias";

const BLUE_EYES = 89631139;
const ALT = 89631140;
const MIRROR_FORCE = 44095762;
const MIRROR_ALT = 44095763;
const blueEyes = (code: number, canonicalPasscode?: number) => ({ code, canonicalPasscode, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 });
const destroy = (sourceCode: number, extra: object = {}) => ({
  id: 1, kind: "destroy" as const, cause: "effect" as const, sourceCode, zone: { controller: 0, location: 4, sequence: 0 }, ...extra,
});

describe("signature code", () => {
  it("is the canonical passcode the server names, else the card's own", () => {
    expect(signatureCode(ALT, BLUE_EYES)).toBe(BLUE_EYES);
    expect(signatureCode(BLUE_EYES, BLUE_EYES)).toBe(BLUE_EYES);
    expect(signatureCode(ALT)).toBe(ALT);
    expect(signatureCode(ALT, null)).toBe(ALT);
  });

  it("plays the signature of an alternate art from its canonical passcode", () => {
    const style = attackStyleFor(blueEyes(ALT, BLUE_EYES));
    expect(style.rule).toBe(`signature ${ALT}`);
    expect(style.caption).toBe("White Lightning");
  });

  it("falls back to the card's own passcode for an old replay with no canonical field", () => {
    expect(attackStyleFor(blueEyes(ALT)).rule).not.toMatch(/^signature/);
    expect(attackStyleFor(blueEyes(BLUE_EYES)).caption).toBe("White Lightning");
  });
});

describe("set piece of a destroy source", () => {
  it("uses sourceCanonicalCode for an alternate art", () => {
    expect(pieceOf(destroy(MIRROR_ALT, { sourceCanonicalCode: MIRROR_FORCE }))).toBe("mirror-force");
    expect(pieceOf(destroy(MIRROR_FORCE, { sourceCanonicalCode: MIRROR_FORCE }))).toBe("mirror-force");
  });

  it("keeps the source code when an old event has no canonical field", () => {
    expect(pieceOf(destroy(MIRROR_FORCE))).toBe("mirror-force");
    expect(pieceOf(destroy(MIRROR_ALT))).toBeNull();
  });
});
