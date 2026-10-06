// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attackStyleFor } from "../../src/components/duel/attack-styles";
import { pieceOf } from "../../src/components/duel/fx3d/scene-plan";
import { canonicalOf, learnArtworkFamily, primeSignatureAliases, resetSignatureAliases, signatureCode } from "../../src/components/duel/signature-alias";
import { clearCardArtworksCache } from "../../src/lib/card-artworks-client";

const BLUE_EYES = 89631139;
const ALT = 89631140;
const MIRROR_FORCE = 44095762;
const MIRROR_ALT = 44095763;
const art = (passcode: number, main: number) => ({ passcode, isMain: passcode === main, imageUrl: null, smallUrl: null, croppedUrl: null });
const blue = { passcode: BLUE_EYES, artworks: [art(BLUE_EYES, BLUE_EYES), art(ALT, BLUE_EYES)] };
const destroy = (sourceCode: number, extra: object = {}) => ({
  id: 1, kind: "destroy" as const, cause: "effect" as const, sourceCode, zone: { controller: 0, location: 4, sequence: 0 }, ...extra,
});

beforeEach(() => {
  resetSignatureAliases();
  clearCardArtworksCache();
  window.history.pushState({}, "", "/duels/abc");
});
afterEach(() => vi.unstubAllGlobals());

describe("signature alias", () => {
  it("plays no signature for an alternate art until its family is known", () => {
    expect(attackStyleFor({ code: ALT, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 }).rule).not.toMatch(/^signature/);
  });

  it("sends an alternate art back to the original signature card", () => {
    learnArtworkFamily(blue);
    expect(signatureCode(ALT)).toBe(BLUE_EYES);
    expect(signatureCode(BLUE_EYES)).toBe(BLUE_EYES);
    const style = attackStyleFor({ code: ALT, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 });
    expect(style.rule).toBe(`signature ${ALT}`);
    expect(style.caption).toBe("White Lightning");
  });

  it("uses the canonical passcode of the card first, with no lookup", () => {
    expect(signatureCode(ALT, BLUE_EYES)).toBe(BLUE_EYES);
    // The server's answer wins over what the lookup learned.
    learnArtworkFamily({ passcode: 1, artworks: [art(1, 1), art(ALT, 1)] });
    expect(signatureCode(ALT, BLUE_EYES)).toBe(BLUE_EYES);
    const style = attackStyleFor({ code: ALT, canonicalPasscode: BLUE_EYES, name: "Blue-Eyes White Dragon", race: "Dragon", attribute: 0x10 });
    expect(style.caption).toBe("White Lightning");
    expect(canonicalOf({ canonicalPasscode: BLUE_EYES })).toBe(BLUE_EYES);
    expect(canonicalOf({ canonicalPasscode: "x" })).toBeUndefined();
    expect(canonicalOf(undefined)).toBeUndefined();
  });

  it("picks the set piece of an alternate art of a destroy source, by lookup or by the canonical source code", () => {
    expect(pieceOf(destroy(MIRROR_ALT))).toBeNull();
    expect(pieceOf(destroy(MIRROR_ALT, { canonicalSourceCode: MIRROR_FORCE }))).toBe("mirror-force");
    learnArtworkFamily({ passcode: MIRROR_FORCE, artworks: [art(MIRROR_FORCE, MIRROR_FORCE), art(MIRROR_ALT, MIRROR_FORCE)] });
    expect(pieceOf(destroy(MIRROR_ALT))).toBe("mirror-force");
    expect(pieceOf(destroy(MIRROR_FORCE))).toBe("mirror-force");
  });
});

describe("primeSignatureAliases", () => {
  const answer = (url: string) => (url.includes(`/${BLUE_EYES}/`)
    ? Response.json(blue)
    : Response.json({ error: "down" }, { status: 502 }));

  it("learns the families from the artworks API and survives a failed lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url)));
    await primeSignatureAliases([BLUE_EYES, 46986414]);
    expect(signatureCode(ALT)).toBe(BLUE_EYES);
  });

  it("asks again after a failure and never twice for a family it has", async () => {
    const fetch = vi.fn(async (url: string) => answer(url));
    vi.stubGlobal("fetch", fetch);
    await primeSignatureAliases([BLUE_EYES, 46986414]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await primeSignatureAliases([BLUE_EYES, 46986414]);
    // Only the failed card is asked for again.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]![0]).toContain("/46986414/");
  });

  it("stops after the first request when there is no session", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "Unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await primeSignatureAliases([BLUE_EYES, 46986414, 44095762, 56120475]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await primeSignatureAliases([BLUE_EYES]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends no request on the public lab pages", async () => {
    window.history.pushState({}, "", "/dev/fx-lab");
    const fetch = vi.fn(async () => Response.json(blue));
    vi.stubGlobal("fetch", fetch);
    await primeSignatureAliases([BLUE_EYES, 46986414]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
