import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

/** Local metadata is evidence of availability, never evidence that the engine accepts a passcode. */
export async function withArtworkImages(family: CardArtworkFamily): Promise<CardArtworksResponse> {
  const lookup = getDb().prepare("select image_url, image_url_small, image_url_cropped from card_artworks where artwork_id = ? and source = 'api'");
  const cached = async (filename: string) => {
    try {
      await validateCardImage(await readFile(join(process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images", filename)));
      return true;
    } catch { return false; }
  };
  const artworks = await Promise.all(family.artworks.map(async art => {
    const row = lookup.get(art.passcode) as { image_url: string; image_url_small: string; image_url_cropped: string | null } | undefined;
    const base = `/api/cards/${art.passcode}/image`;
    const [full, small, cropped] = await Promise.all([
      row?.image_url || cached(`${art.passcode}.jpg`),
      row?.image_url_small || cached(`${art.passcode}-small.jpg`),
      row?.image_url_cropped || cached(`${art.passcode}-cropped.jpg`),
    ]);
    return { ...art, imageUrl: full ? base : null, smallUrl: small ? `${base}?variant=small` : null, croppedUrl: cropped ? `${base}?variant=cropped` : null };
  }));
  return { passcode: family.passcode, artworks };
}
