import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtworksRequestError, clearCardArtworksCache, fetchCardArtworks, peekCardArtworks } from "../../src/lib/card-artworks-client";

const family = { passcode: 1, artworks: [1, 2].map((passcode) => ({ passcode, isMain: passcode === 1, imageUrl: null, smallUrl: null, croppedUrl: null })) };

beforeEach(() => clearCardArtworksCache());
afterEach(() => vi.unstubAllGlobals());

describe("fetchCardArtworks", () => {
  it("keeps a 404 for the cache time, so a card with no family is not asked about again", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "No such card." }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCardArtworks(9)).rejects.toMatchObject({ status: 404 });
    await expect(fetchCardArtworks(9)).rejects.toBeInstanceOf(ArtworksRequestError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not keep another failure", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "down" }, { status: 502 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCardArtworks(9)).rejects.toMatchObject({ status: 502 });
    await expect(fetchCardArtworks(9)).rejects.toMatchObject({ status: 502 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("answers a loaded family at once, for every member of it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(family)));
    expect(peekCardArtworks(2)).toBeNull();
    await fetchCardArtworks(1);
    expect(peekCardArtworks(1)).toEqual(family);
    expect(peekCardArtworks(2)).toEqual(family);
  });
});
