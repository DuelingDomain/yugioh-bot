import { isOwnerUser } from "@/lib/owner-access";
import { auth } from "@/lib/auth";
import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { getDb } from "@/lib/db";
import { cardImageCachePath, type CardImageSource } from "@/lib/card-image-cache";
import { CardFetchError, CardFetchLimitError, CardImageValidationError, fetchCardImageResource, readCardImageResponse, trustedCardImageUrl, validateCardImage, type CardImageResource } from "@yugidraft/shared/services";

const YGOPRODECK_IMAGE_URL = "https://images.ygoprodeck.com/images/cards";
const YGOPRODECK_SMALL_URL = "https://images.ygoprodeck.com/images/cards_small";
const YGOPRODECK_CROPPED_URL = "https://images.ygoprodeck.com/images/cards_cropped";
export type ImageVariant = "full" | "small" | "cropped" | "thumb";
export type CachedImage = { image: Buffer; cacheControl: string };
type FetchedImage = CardImageResource<Buffer>;
type ArtworkRow = { card_id: number; image_url: string; image_url_small: string; image_url_cropped: string | null; source: "api" | "engine" };
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_RETRY_MS = 10 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const ALIAS_TTL_MS = 10 * 60 * 1000;
const inFlight = new Map<string, Promise<CachedImage>>();
const missingImages = new Map<string, number>();
// Prewarm cannot resolve aliases, so its misses must not hide an alias-only card from a viewer: a separate map, read only by prewarm.
const prewarmMisses = new Map<string, number>();
const PREWARM_ERROR_TTL_MS = 60 * 1000;
const NEGATIVE_CACHE_LIMIT = 4096;

/** Remember a miss. A full map drops expired entries only: live entries are never pushed out, so a flood of made-up ids cannot cycle them. */
function rememberMiss(misses: Map<string, number>, key: string, ttlMs: number): void {
  const now = Date.now();
  if (misses.size >= NEGATIVE_CACHE_LIMIT) for (const [name, expires] of misses) if (expires <= now) misses.delete(name);
  if (misses.size < NEGATIVE_CACHE_LIMIT) misses.set(key, now + ttlMs);
}
const aliases = new Map<number, { alias: number | null; expires: number }>();
// The URL carries no version, so an art fix must reach people within a week: no `immutable`, and not longer than 7 days.
const OWN_CACHE_CONTROL = "public, max-age=604800";
/** Tile-size WebP made from the small image: about a quarter of its bytes, for grids of hundreds of cards. */
const THUMB_WIDTH = 200;
const FALLBACK_CACHE_CONTROL = "public, max-age=3600";

function artworkOf(passcode: number): ArtworkRow | undefined {
  return getDb().prepare("select card_id, image_url, image_url_small, image_url_cropped, source from card_artworks where artwork_id = ?")
    .get(passcode) as ArtworkRow | undefined;
}

export class ImageMissingError extends Error {}
export class ImageInvalidError extends CardFetchError {}

/** Full-card fallback for missing crops is reserved for engine artwork. */
async function fetchImage(passcode: number, variant: ImageVariant, memberId?: number): Promise<FetchedImage> {
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
  // API artwork must try its main-art crop before substituting a framed card.
  return fetchCardImageResource(url, passcode, fetch, readImage, variant !== "cropped" || artwork?.source === "engine", memberId);
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
  const session = await auth();
  // Owner watch must not register gameplay identity; normal image readers keep alias fallback.
  const owner = !!session && isOwnerUser(Number(session.user.id));
  const actor = await requireDuelActor({ createPlayer: !owner });
  if (!actor.ok) {
    if (actor.response.status === 401 || actor.response.status === 403 || actor.response.status === 404) return undefined;
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
  return variant === "full" ? `${passcode}.jpg` : variant === "thumb" ? `${passcode}-thumb.webp` : `${passcode}-${variant}.jpg`;
}

// Decoding a file with sharp costs about 10 ms. Do it once per file version, not on every hit of a 240-tile page.
const validatedFiles = new Set<string>();
async function readValidated(path: string): Promise<Buffer> {
  const info = await stat(path);
  const key = `${path}:${info.size}:${info.mtimeMs}`;
  const image = await readFile(path);
  if (validatedFiles.has(key)) return image;
  await validateCardImage(image);
  if (validatedFiles.size >= 8192) validatedFiles.clear();
  validatedFiles.add(key);
  return image;
}

async function readCachedImage(passcode: number, variant: ImageVariant, filename: string): Promise<CachedImage | null> {
  const primaryPath = cardImageCachePath(filename, "ygoprodeck");
  try {
    return { image: await readValidated(primaryPath), cacheControl: OWN_CACHE_CONTROL };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const legacyPath = join(dirname(primaryPath), filename);
        const legacy = await readFile(legacyPath);
        // Pre-artwork API catalog rows are safe too; engine writers always add
        // artwork rows, so their potentially poisoned alias art still stays out.
        const artwork = artworkOf(passcode);
        const apiCard = artwork ? artwork.source === "api"
          : !!getDb().prepare("select 1 from card_catalog where ygoprodeck_id = ?").get(passcode);
        // Without crop metadata, legacy crops may contain full-card fallback art.
        if (apiCard && (variant !== "cropped" || artwork?.image_url_cropped != null)) {
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
      return { image: await readValidated(path), cacheControl: FALLBACK_CACHE_CONTROL };
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

/** Resolved only when the image must be fetched: a cache hit needs no session lookup. */
export type MemberIdProvider = () => Promise<number | undefined>;
type LoadOptions = { memberId?: MemberIdProvider; /** Prewarm has no session, so it cannot ask the duel host for aliases. */ noAlias?: boolean };

async function loadImage(passcode: number, variant: ImageVariant, filename: string, options: LoadOptions): Promise<CachedImage> {
  const cached = await readCachedImage(passcode, variant, filename);
  if (cached) return cached;
  if ((missingImages.get(filename) ?? 0) > Date.now()) throw new ImageMissingError();
  missingImages.delete(filename);
  if (options.noAlias && (prewarmMisses.get(filename) ?? 0) > Date.now()) throw new ImageMissingError();

  let fetched: FetchedImage | undefined;
  let memberId: number | undefined;
  let upstreamError: unknown;
  let fallbackError: unknown;
  try {
    memberId = await options.memberId?.();
    fetched = await fetchImage(passcode, variant, memberId);
    fallbackError = fetched.fallbackError;
  } catch (error) {
    if (error instanceof CardFetchLimitError) throw error;
    upstreamError = error;
  }
  if (fetched?.image) {
    await writeCachedImage(filename, fetched.source, fetched.image);
    return { image: fetched.image, cacheControl: fetched.source === "ignis" ? FALLBACK_CACHE_CONTROL : OWN_CACHE_CONTROL };
  }

  // A failed refresh must preserve this passcode's art before considering aliases.
  const expired = await readCachedIgnis(filename, true);
  if (expired) {
    const retryMtime = new Date(Date.now() - FALLBACK_TTL_MS + FALLBACK_RETRY_MS);
    await utimes(cardImageCachePath(filename, "ignis"), retryMtime, retryMtime).catch(() => {});
    return expired;
  }

  if (options.noAlias) {
    // Confirmed absent for the passcode itself: 10 minutes. After an upstream error: a short pause, not a retry on every cube read.
    rememberMiss(prewarmMisses, filename, upstreamError || fallbackError ? PREWARM_ERROR_TTL_MS : MISSING_TTL_MS);
    throw upstreamError ?? fallbackError ?? new ImageMissingError(`No card image for ${passcode}`);
  }
  let alias: number | null | undefined;
  try { alias = await aliasOf(passcode); }
  catch (error) { throw upstreamError ?? fallbackError ?? error; }
  if (alias != null) {
    const cachedAlias = await readCachedImage(alias, variant, imageFilename(alias, variant));
    let image = cachedAlias?.image;
    // A primary 404 always permits alias fetching, even after an Ignis error.
    if (!image && !upstreamError) {
      const fetchedAlias = await fetchImage(alias, variant, memberId);
      image = fetchedAlias.image ?? undefined;
      fallbackError ??= fetchedAlias.fallbackError;
    }
    // Alias art must never become this passcode's durable art.
    if (image) return { image, cacheControl: upstreamError || fallbackError ? "no-store" : FALLBACK_CACHE_CONTROL };
  }
  if (upstreamError || fallbackError) throw upstreamError ?? fallbackError;
  if (alias === null) {
    rememberMiss(missingImages, filename, MISSING_TTL_MS);
  }
  throw new ImageMissingError(`No card image for ${passcode}`);
}

/** A viewer must not inherit a prewarm result: prewarm gives up on alias-only cards, a viewer resolves them. */
function dedupe(key: string, load: () => Promise<CachedImage>): Promise<CachedImage> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = load();
  inFlight.set(key, pending);
  return pending.finally(() => inFlight.delete(key));
}

async function loadThumb(passcode: number, filename: string, options: LoadOptions): Promise<CachedImage> {
  const cached = await readCachedImage(passcode, "thumb", filename);
  if (cached) return cached;
  const small = await getCardImage(passcode, "small", options);
  const image = await sharp(small.image).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  // Alias art and fallback art must not become this passcode's durable thumbnail, as for the small image.
  if (small.cacheControl !== OWN_CACHE_CONTROL) return { image, cacheControl: small.cacheControl };
  await writeCachedImage(filename, "ygoprodeck", image);
  return { image, cacheControl: OWN_CACHE_CONTROL };
}

export function getCardImage(passcode: number, variant: ImageVariant, options: LoadOptions = {}): Promise<CachedImage> {
  const filename = imageFilename(passcode, variant);
  return dedupe(options.noAlias ? `${filename}:prewarm` : filename, () => variant === "thumb" ? loadThumb(passcode, filename, options) : loadImage(passcode, variant, filename, options));
}

const prewarming = new Set<string>();
/**
 * Fill the disk cache for cards a page is about to show, so the first view does not queue behind the upstream fetch budget.
 * Four at a time, so a user's own image request never waits behind more than a few of these. Never throws.
 */
export async function prewarmCardImages(passcodes: Iterable<number>, variants: ImageVariant[] = ["thumb"]): Promise<void> {
  const jobs = [...new Set(passcodes)].flatMap(passcode => variants.map(variant => ({ passcode, variant })))
    .filter(({ passcode, variant }) => Number.isSafeInteger(passcode) && passcode > 0 && !prewarming.has(`${passcode}:${variant}`));
  for (const { passcode, variant } of jobs) prewarming.add(`${passcode}:${variant}`);
  const next = jobs[Symbol.iterator]();
  const worker = async () => {
    for (let step = next.next(); !step.done; step = next.next()) {
      const { passcode, variant } = step.value;
      try { await getCardImage(passcode, variant, { noAlias: true }); } catch { /* Best effort: a viewer's request retries it. */ }
      finally { prewarming.delete(`${passcode}:${variant}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
}

/** Fire and forget. `CARD_IMAGE_PREWARM=0` turns it off (the test setup does, so no test reaches the network). */
export function warmCardImages(passcodes: Iterable<number>, variants: ImageVariant[] = ["thumb"], max = 600): void {
  if (process.env.CARD_IMAGE_PREWARM === "0") return;
  const ids = [...new Set(passcodes)].slice(0, max);
  // Every cube read and edit calls this: the same card set within a few minutes is already warm or being warmed.
  const key = createHash("sha1").update(`${variants.join()}:${ids.sort((a, b) => a - b).join()}`).digest("hex");
  const now = Date.now();
  if ((recentlyWarmed.get(key) ?? 0) > now) return;
  if (recentlyWarmed.size >= 256) for (const [name, expires] of recentlyWarmed) if (expires <= now) recentlyWarmed.delete(name);
  if (recentlyWarmed.size >= 256) recentlyWarmed.delete(recentlyWarmed.keys().next().value!);
  recentlyWarmed.set(key, now + WARM_REPEAT_MS);
  void prewarmCardImages(ids, variants);
}
const recentlyWarmed = new Map<string, number>();
const WARM_REPEAT_MS = 5 * 60 * 1000;
