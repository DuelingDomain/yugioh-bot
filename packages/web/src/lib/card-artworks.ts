import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import type { CardArtworkFamily, CardArtworksResponse } from "@yugidraft/shared/duels";
import { validateCardImage } from "@yugidraft/shared/services";
import { callDuelHost } from "@/lib/duel-host";
import { getDb } from "@/lib/db";

export function isPasscode(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}

export async function loadCardArtworkFamily(actor: { guildId: string; playerId: number }, passcode: number): Promise<
  { ok: true; family: CardArtworkFamily } | { ok: false; response: NextResponse }
> {
  const result = await callDuelHost({ op: "card-artworks", ...actor, codes: [passcode] });
  if (!result.ok) return result;
  const family = result.data as CardArtworkFamily | null;
  if (!family || !isPasscode(family.passcode) || !Array.isArray(family.artworks) || !family.artworks.length
    || family.artworks.some(art => !art || !isPasscode(art.passcode) || art.isMain !== (art.passcode === family.passcode))
    || family.artworks[0].passcode !== family.passcode || !family.artworks.some(art => art.passcode === passcode)
    || new Set(family.artworks.map(art => art.passcode)).size !== family.artworks.length) {
    return { ok: false, response: NextResponse.json({ error: "Invalid engine response" }, { status: 502 }) };
  }
  return { ok: true, family };
}

// Bound memory and coalesce concurrent requests; include the directory in the key.
// Keep full validation, but avoid decoding every variant on every no-store request.
const imageChecks = new Map<string, { expires: number; present: Promise<boolean> }>();
function cachedImage(filename: string): Promise<boolean> {
  const path = resolve(process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images", filename);
  const now = Date.now();
  const previous = imageChecks.get(path);
  if (previous && previous.expires > now) return previous.present;
  imageChecks.delete(path);
  if (imageChecks.size >= 2048) imageChecks.delete(imageChecks.keys().next().value!);
  const present = readFile(path).then(validateCardImage).then(() => true, () => false);
  const entry = { expires: now + 30_000, present };
  imageChecks.set(path, entry);
  // Concurrent requests share the in-flight check, but a failure must not stay cached: the image may arrive any moment.
  void present.then(ok => { if (!ok && imageChecks.get(path) === entry) imageChecks.delete(path); });
  return present;
}

/** Local metadata is evidence of availability, never evidence that the engine accepts a passcode. */
export async function withArtworkImages(family: CardArtworkFamily): Promise<CardArtworksResponse> {
  const lookup = getDb().prepare("select image_url, image_url_small, image_url_cropped from card_artworks where artwork_id = ? and source = 'api'");
  const artworks = await Promise.all(family.artworks.map(async art => {
    const row = lookup.get(art.passcode) as { image_url: string; image_url_small: string; image_url_cropped: string | null } | undefined;
    const base = `/api/cards/${art.passcode}/image`;
    const [full, small, cropped] = await Promise.all([
      row?.image_url || cachedImage(`${art.passcode}.jpg`),
      row?.image_url_small || cachedImage(`${art.passcode}-small.jpg`),
      row?.image_url_cropped || cachedImage(`${art.passcode}-cropped.jpg`),
    ]);
    return { ...art, imageUrl: full ? base : null, smallUrl: small ? `${base}?variant=small` : null, croppedUrl: cropped ? `${base}?variant=cropped` : null };
  }));
  return { passcode: family.passcode, artworks };
}
