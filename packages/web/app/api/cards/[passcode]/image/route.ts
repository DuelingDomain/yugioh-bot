import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { getDb } from "@/lib/db";
import { cardImageCachePath, type CardImageSource } from "@/lib/card-image-cache";
import { CARD_BACK_SVG, CardFetchError, CardImageValidationError, PROJECT_IGNIS_IMAGE_URL, fetchCardResource, isCardFetchError, readCardImageResponse, trustedCardImageUrl, validateCardImage } from "@yugidraft/shared/services";

export const runtime = "nodejs";

const YGOPRODECK_IMAGE_URL = "https://images.ygoprodeck.com/images/cards";
const YGOPRODECK_SMALL_URL = "https://images.ygoprodeck.com/images/cards_small";
const YGOPRODECK_CROPPED_URL = "https://images.ygoprodeck.com/images/cards_cropped";
type ImageVariant = "full" | "small" | "cropped";
type CachedImage = { image: Buffer; cacheControl: string };
type FetchedImage = { image: Buffer | null; source: CardImageSource; ignisError?: unknown };
type ArtworkRow = { card_id: number; image_url: string; image_url_small: string; image_url_cropped: string | null; source: "api" | "engine" };
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const ALIAS_TTL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<CachedImage>>();
const missingImages = new Map<string, number>();
const aliases = new Map<number, { alias: number | null; expires: number }>();
const OWN_CACHE_CONTROL = "public, max-age=86400, immutable";
const FALLBACK_CACHE_CONTROL = "public, max-age=3600";

function artworkOf(passcode: number): ArtworkRow | undefined {
  return getDb().prepare("select card_id, image_url, image_url_small, image_url_cropped, source from card_artworks where artwork_id = ?")
    .get(passcode) as ArtworkRow | undefined;
}

class ImageMissingError extends Error {}
class ImageInvalidError extends CardFetchError {}

/** Try Ignis for missing full/small cards before considering the engine alias. */
async function fetchImage(passcode: number, variant: ImageVariant): Promise<FetchedImage> {
  const artwork = artworkOf(passcode);
  const baseUrl = variant === "cropped" ? YGOPRODECK_CROPPED_URL : variant === "small" ? YGOPRODECK_SMALL_URL : YGOPRODECK_IMAGE_URL;
  const storedUrl = variant === "cropped" ? artwork?.image_url_cropped : variant === "small" ? artwork?.image_url_small : artwork?.image_url;
  const url = trustedCardImageUrl(storedUrl, `${baseUrl}/${passcode}.jpg`);
  const readImage = async (response: Response) => {
    try { return await readCardImageResponse(response); }
    catch (error) {
      if (error instanceof CardImageValidationError) throw new ImageInvalidError();
      throw error;
    }
  };
  const readOrMiss = (response: Response) => response.status === 404 ? Promise.resolve(null) : readImage(response);
  const image = await fetchCardResource(url, fetch, readOrMiss, [404]);
  if (image || variant === "cropped") return { image, source: "ygoprodeck" };
  // Ignis only has 177x254 full-card JPEGs, with no HQ or cropped endpoint.
  // Its separate disk cache lets later YGOPRODeck/HQ art replace it.
  try {
    return { image: await fetchCardResource(`${PROJECT_IGNIS_IMAGE_URL}/${passcode}.jpg`, fetch, readOrMiss, [404]), source: "ignis" };
  } catch (ignisError) {
    return { image: null, source: "ignis", ignisError };
  }
}

/**
 * The engine alias, null for a confirmed absence, or undefined without verification.
 * A card such as the
 * Normal Monster "Black Luster Soldier" (10000100) has no YGOPRODeck image of its own,
 * but its alias (the Ritual Monster, 5405694) does.
 */
async function aliasOf(passcode: number): Promise<number | null | undefined> {
  const cached = aliases.get(passcode);
  if (cached && cached.expires > Date.now()) return cached.alias;
  aliases.delete(passcode);
  const artwork = artworkOf(passcode);
  if (artwork && artwork.card_id !== passcode) return rememberAlias(passcode, artwork.card_id);
  const actor = await requireDuelActor();
  if (!actor.ok) {
    if (actor.response.status === 401 || actor.response.status === 403) return undefined;
    throw new CardFetchError(1, actor.response.status);
  }
  const result = await callDuelHost({ op: "card-details", guildId: actor.guildId, playerId: actor.playerId, codes: [passcode] });
  if (!result.ok) throw new CardFetchError(1, result.response.status);
  const cards = (result.data as { cards?: { code: number; alias: number }[] }).cards ?? [];
  const alias = cards.find((card) => card.code === passcode)?.alias ?? 0;
  return rememberAlias(passcode, alias > 0 && alias !== passcode ? alias : null);
}

function rememberAlias(passcode: number, alias: number | null): number | null {
  if (aliases.size >= 1024) aliases.delete(aliases.keys().next().value!);
  aliases.set(passcode, { alias, expires: Date.now() + ALIAS_TTL_MS });
  return alias;
}

function imageFilename(passcode: number, variant: ImageVariant): string {
  return variant === "full" ? `${passcode}.jpg` : `${passcode}-${variant}.jpg`;
}

async function readCachedImage(passcode: number, filename: string): Promise<CachedImage | null> {
  const primaryPath = cardImageCachePath(filename, "ygoprodeck");
  try {
    return { image: await validateCardImage(await readFile(primaryPath)), cacheControl: OWN_CACHE_CONTROL };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const legacyPath = join(dirname(primaryPath), filename);
        const legacy = await readFile(legacyPath);
        // API artwork rows identify legacy files that can be reused safely.
        // Engine-only codes still skip potentially poisoned alias art.
        if (artworkOf(passcode)?.source === "api") {
          const image = await validateCardImage(legacy);
          await rename(legacyPath, primaryPath);
          return { image, cacheControl: OWN_CACHE_CONTROL };
        }
      } catch { /* Fetch if the legacy image cannot be migrated. */ }
    }
  }
  return readCachedIgnis(filename);
}

async function readCachedIgnis(filename: string, allowExpired = false): Promise<CachedImage | null> {
  try {
    const path = cardImageCachePath(filename, "ignis");
    if (allowExpired || Date.now() - (await stat(path)).mtimeMs < FALLBACK_TTL_MS) {
      return { image: await validateCardImage(await readFile(path)), cacheControl: FALLBACK_CACHE_CONTROL };
    }
  } catch { /* Fetch a missing, invalid or expired fallback image. */ }
  return null;
}

async function writeCachedImage(filename: string, source: CardImageSource, image: Buffer): Promise<void> {
  const cachePath = cardImageCachePath(filename, source);
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(temporaryPath, image);
    await rename(temporaryPath, cachePath);
  } catch { /* Serve a usable image if caching fails. */ }
  finally { await rm(temporaryPath, { force: true }).catch(() => {}); }
}

async function loadImage(passcode: number, variant: ImageVariant, filename: string): Promise<CachedImage> {
  const cached = await readCachedImage(passcode, filename);
  if (cached) return cached;
  if ((missingImages.get(filename) ?? 0) > Date.now()) throw new ImageMissingError();
  missingImages.delete(filename);

  let fetched: FetchedImage | undefined;
  let upstreamError: unknown;
  let ignisError: unknown;
  try {
    fetched = await fetchImage(passcode, variant);
    ignisError = fetched.ignisError;
  } catch (error) { upstreamError = error; }
  if (fetched?.image) {
    await writeCachedImage(filename, fetched.source, fetched.image);
    return { image: fetched.image, cacheControl: fetched.source === "ignis" ? FALLBACK_CACHE_CONTROL : OWN_CACHE_CONTROL };
  }

  // A failed refresh must preserve this passcode's art before considering aliases.
  const expired = await readCachedIgnis(filename, true);
  if (expired) return expired;

  let alias: number | null | undefined;
  try { alias = await aliasOf(passcode); }
  catch (error) { throw upstreamError ?? ignisError ?? error; }
  if (alias != null) {
    const cachedAlias = await readCachedImage(alias, imageFilename(alias, variant));
    let image = cachedAlias?.image;
    // A primary 404 always permits alias fetching, even after an Ignis error.
    if (!image && !upstreamError) {
      const fetchedAlias = await fetchImage(alias, variant);
      image = fetchedAlias.image ?? undefined;
      ignisError ??= fetchedAlias.ignisError;
    }
    // Alias art must never become this passcode's durable art.
    if (image) return { image, cacheControl: upstreamError || ignisError ? "no-store" : FALLBACK_CACHE_CONTROL };
  }
  if (upstreamError || ignisError) throw upstreamError ?? ignisError;
  if (alias === null) {
    const now = Date.now();
    for (const [key, expires] of missingImages) if (expires <= now) missingImages.delete(key);
    if (missingImages.size >= 1024) missingImages.delete(missingImages.keys().next().value!);
    missingImages.set(filename, now + MISSING_TTL_MS);
  }
  throw new ImageMissingError(`No card image for ${passcode}`);
}

async function getCachedImage(passcode: number, variant: ImageVariant): Promise<CachedImage> {
  const filename = imageFilename(passcode, variant);
  const existing = inFlight.get(filename);
  if (existing) return existing;
  const pending = loadImage(passcode, variant, filename);
  inFlight.set(filename, pending);
  try { return await pending; }
  finally { inFlight.delete(filename); }
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

    const { image, cacheControl } = await getCachedImage(Number(raw), variant);

    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    if (error instanceof ImageMissingError) {
      return NextResponse.json({ error: "Card image not found" }, { status: 404 });
    }
    if (error instanceof ImageInvalidError) {
      return NextResponse.json({ error: "Invalid card image" }, { status: 502 });
    }
    if (isCardFetchError(error)) {
      if (error.status == null || error.status === 429 || (error.status >= 500 && error.status < 600)) {
        return new Response(CARD_BACK_SVG, { headers: {
          "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=30",
        } });
      }
      return NextResponse.json({ error: "Could not load card image" }, { status: 502 });
    }
    return NextResponse.json({ error: "Could not load card image" }, { status: 500 });
  }
}
