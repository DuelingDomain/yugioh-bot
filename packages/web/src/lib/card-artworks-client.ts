import type { CardArtworksResponse, SelectableCardArtwork } from "@yugidraft/shared/duels";

export type { CardArtworksResponse, SelectableCardArtwork };

/** Families are tiny and change only when a sync adds art, so a short in-memory cache is enough. */
const TTL_MS = 5 * 60_000;
type Entry = { at: number; family: Promise<CardArtworksResponse>; value?: CardArtworksResponse };
const cache = new Map<number, Entry>();

export class ArtworksRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ArtworksRequestError";
    this.status = status;
  }
}

function isArtwork(value: unknown): value is SelectableCardArtwork {
  if (!value || typeof value !== "object") return false;
  const art = value as Record<string, unknown>;
  return typeof art.passcode === "number" && typeof art.isMain === "boolean"
    && [art.imageUrl, art.smallUrl, art.croppedUrl].every((url) => url === null || typeof url === "string");
}

async function load(passcode: number): Promise<CardArtworksResponse> {
  const res = await fetch(`/api/cards/${passcode}/artworks`, { cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Request failed (${res.status})`;
    throw new ArtworksRequestError(message, res.status);
  }
  const family = body as Partial<CardArtworksResponse> | null;
  if (!family || typeof family.passcode !== "number" || !Array.isArray(family.artworks)
    || family.artworks.length === 0 || !family.artworks.every(isArtwork)) {
    throw new ArtworksRequestError("The server returned an invalid art list.", 502);
  }
  return { passcode: family.passcode, artworks: family.artworks };
}

/** The family when an earlier request already loaded it, so a picker can draw it on its first render. */
export function peekCardArtworks(passcode: number): CardArtworksResponse | null {
  const hit = cache.get(passcode);
  return hit?.value && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

/** Every art of the card's family, main first. One request serves any member of the family. */
export function fetchCardArtworks(passcode: number): Promise<CardArtworksResponse> {
  const hit = cache.get(passcode);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.family;
  const family = load(passcode);
  const entry: Entry = { at: Date.now(), family };
  cache.set(passcode, entry);
  void family.then(
    (value) => {
      entry.value = value;
      for (const art of value.artworks) {
        const existing = cache.get(art.passcode);
        if (!existing || existing === entry || Date.now() - existing.at >= TTL_MS) cache.set(art.passcode, { at: entry.at, family, value });
      }
    },
    (reason: unknown) => {
      // A card with no family stays "no family" for the cache time; any other failure may be a hiccup, so the next ask retries.
      const missing = reason instanceof ArtworksRequestError && reason.status === 404;
      if (!missing && cache.get(passcode) === entry) cache.delete(passcode);
    },
  );
  return family;
}

/** For tests. */
export function clearCardArtworksCache(): void {
  cache.clear();
}
