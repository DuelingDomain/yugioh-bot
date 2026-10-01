import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

const CACHE_DIR = process.env.CARD_IMAGE_CACHE_DIR ?? "./data/card-images";
const YGOPRODECK_IMAGE_URL = "https://images.ygoprodeck.com/images/cards";
const YGOPRODECK_SMALL_URL = "https://images.ygoprodeck.com/images/cards_small";

class ImageMissingError extends Error {}

/** The image for one passcode from YGOPRODeck, or null when YGOPRODeck has none. */
async function fetchImage(passcode: number, size: "full" | "small"): Promise<Buffer | null> {
  const baseUrl = size === "small" ? YGOPRODECK_SMALL_URL : YGOPRODECK_IMAGE_URL;
  const response = await fetch(`${baseUrl}/${passcode}.jpg`);
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
  size: "full" | "small"
): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });

  const filename = size === "small" ? `${passcode}-small.jpg` : `${passcode}.jpg`;
  const cachePath = join(CACHE_DIR, filename);

  try {
    return await readFile(cachePath);
  } catch {
    let image = await fetchImage(passcode, size);
    if (!image) {
      const alias = await aliasOf(passcode);
      if (alias != null) image = await fetchImage(alias, size);
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
    const size = searchParams.get("size") === "small" ? "small" : "full";

    const image = await getCachedImage(Number(raw), size);

    return new Response(image.buffer as ArrayBuffer, {
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
