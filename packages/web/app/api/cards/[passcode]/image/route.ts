import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const CACHE_DIR = process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images";
const YGOPRODECK_IMAGE_URL = "https://images.ygoprodeck.com/images/cards";
const YGOPRODECK_SMALL_URL = "https://images.ygoprodeck.com/images/cards_small";
const YGOPRODECK_CROPPED_URL = "https://images.ygoprodeck.com/images/cards_cropped";
type ImageVariant = "full" | "small" | "cropped";
type ArtworkRow = { card_id: number; image_url: string; image_url_small: string; image_url_cropped: string | null };

function artworkOf(passcode: number): ArtworkRow | undefined {
  return getDb().prepare("select card_id, image_url, image_url_small, image_url_cropped from card_artworks where artwork_id = ?")
    .get(passcode) as ArtworkRow | undefined;
}

class ImageMissingError extends Error {}

/** The image for one passcode from YGOPRODeck, or null when YGOPRODeck has none. */
async function fetchImage(passcode: number, variant: ImageVariant): Promise<Buffer | null> {
  const artwork = artworkOf(passcode);
  const baseUrl = variant === "cropped" ? YGOPRODECK_CROPPED_URL : variant === "small" ? YGOPRODECK_SMALL_URL : YGOPRODECK_IMAGE_URL;
  const storedUrl = variant === "cropped" ? artwork?.image_url_cropped : variant === "small" ? artwork?.image_url_small : artwork?.image_url;
  const response = await fetch(storedUrl || `${baseUrl}/${passcode}.jpg`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch card image: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The passcode the engine database gives as this card's alias, or null. A card such as the
 * Normal Monster "Black Luster Soldier" (10000100) has no YGOPRODeck image of its own,
 * but its alias (the Ritual Monster, 5405694) does.
 */
async function aliasOf(passcode: number): Promise<number | null> {
  const artwork = artworkOf(passcode);
  if (artwork && artwork.card_id !== passcode) return artwork.card_id;
  const actor = await requireDuelActor();
  if (!actor.ok) return null;
  const result = await callDuelHost({ op: "card-details", guildId: actor.guildId, playerId: actor.playerId, codes: [passcode] });
  if (!result.ok) return null;
  const cards = (result.data as { cards?: { code: number; alias: number }[] }).cards ?? [];
  const alias = cards.find((card) => card.code === passcode)?.alias ?? 0;
  return alias > 0 && alias !== passcode ? alias : null;
}

async function getCachedImage(
  passcode: number,
  variant: ImageVariant
): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });

  const filename = variant === "full" ? `${passcode}.jpg` : `${passcode}-${variant}.jpg`;
  const cachePath = join(CACHE_DIR, filename);

  try {
    return await readFile(cachePath);
  } catch {
    let image = await fetchImage(passcode, variant);
    if (!image) {
      const alias = await aliasOf(passcode);
      if (alias != null) image = await fetchImage(alias, variant);
    }
    if (!image) throw new ImageMissingError(`No card image for ${passcode}`);

    await writeFile(cachePath, image);
    return image;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ passcode: string }> }
) {
  try {
    const { passcode: raw } = await params;
    if (!/^\d{1,10}$/.test(raw)) {
      return NextResponse.json({ error: "Invalid card passcode" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const variant = searchParams.get("variant") ?? (searchParams.get("size") === "small" ? "small" : "full");
    if (variant !== "full" && variant !== "small" && variant !== "cropped") {
      return NextResponse.json({ error: "Invalid image variant" }, { status: 400 });
    }

    const image = await getCachedImage(Number(raw), variant);

    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (error) {
    if (error instanceof ImageMissingError) {
      return NextResponse.json({ error: "Card image not found" }, { status: 404 });
    }
    console.error("[api/cards/image] error:", error);
    return NextResponse.json(
      { error: "Failed to load card image" },
      { status: 500 }
    );
  }
}
