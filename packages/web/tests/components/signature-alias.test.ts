import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attackStyleFor } from "../../src/components/duel/attack-styles";
import { learnArtworkFamily, primeSignatureAliases, resetSignatureAliases, signatureCode } from "../../src/components/duel/signature-alias";
import { clearCardArtworksCache } from "../../src/lib/card-artworks-client";

const BLUE_EYES = 89631139;
const ALT = 89631140;
const art = (passcode: number) => ({ passcode, isMain: passcode === BLUE_EYES, imageUrl: null, smallUrl: null, croppedUrl: null });

beforeEach(() => {
  resetSignatureAliases();
  clearCardArtworksCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("signature alias", () => {
  it("plays no signature for an alternate art until its family is known", () => {
    expect(attackStyleFor({ code: ALT, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 }).rule).not.toMatch(/^signature/);
  });

  it("sends an alternate art back to the original signature card", () => {
    learnArtworkFamily({ passcode: BLUE_EYES, artworks: [art(BLUE_EYES), art(ALT)] });
    expect(signatureCode(ALT)).toBe(BLUE_EYES);
    expect(signatureCode(BLUE_EYES)).toBe(BLUE_EYES);
    const style = attackStyleFor({ code: ALT, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 });
    expect(style.rule).toBe(`signature ${ALT}`);
    expect(style.caption).toBe("White Lightning");
  });

  it("learns the families from the artworks API and survives a failed lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes(`/${BLUE_EYES}/`)
      ? Response.json({ passcode: BLUE_EYES, artworks: [art(BLUE_EYES), art(ALT)] })
      : Response.json({ error: "down" }, { status: 502 }))));
    await primeSignatureAliases([BLUE_EYES, 46986414]);
    expect(signatureCode(ALT)).toBe(BLUE_EYES);
  });
});
