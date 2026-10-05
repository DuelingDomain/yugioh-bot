import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { CARD_BACK_SVG, fetchCardResource, trustedCardImageUrl } from "./card-fetch.js";

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<Pick<Response, "ok" | "arrayBuffer"> & Partial<Pick<Response, "status" | "headers">>>;

export type DraftImageCard = {
  ygoprodeckId: number;
  imageUrl: string;
  imageUrlSmall?: string;
};

export type DraftImageCardWithLabel = DraftImageCard & {
  label: string;
};

const COLUMNS = 4;
const ROWS = 2;
const CARD_WIDTH = 100;
const CARD_HEIGHT = 145;

const CARD_FULL_WIDTH = 240;
const CARD_FULL_HEIGHT = 350;

/** Decode the complete image before keeping upstream bytes in a durable cache. */
export async function validateCardImage(buffer: Buffer): Promise<Buffer> {
  await sharp(buffer).stats();
  return buffer;
}

function createNumberOverlay(number: number, width: number, height: number) {
  return Buffer.from(`
    <svg width="${width}" height="${height}">
      <rect x="6" y="6" width="26" height="26" rx="13" fill="rgba(0, 0, 0, 0.72)" />
      <text
        x="19"
        y="25"
        text-anchor="middle"
        font-family="Arial, sans-serif"
        font-size="16"
        font-weight="700"
        fill="#ffffff"
      >${number}</text>
    </svg>
  `);
}

export function createDraftImageService({
  cacheDir,
  fetch = globalThis.fetch,
}: {
  cacheDir: string;
  fetch?: FetchLike;
}) {
  const fetchImpl = fetch;

  const getImage = async (card: DraftImageCard, full: boolean) => {
    const cachePath = join(cacheDir, `${card.ygoprodeckId}${full ? "-full" : ""}.png`);
    try { return await readFile(cachePath); } catch { /* Fetch only a missing image. */ }
    const width = full ? CARD_FULL_WIDTH : CARD_WIDTH;
    const height = full ? CARD_FULL_HEIGHT : CARD_HEIGHT;
    try {
      const fallback = `https://images.ygoprodeck.com/images/${full ? "cards" : "cards_small"}/${card.ygoprodeckId}.jpg`;
      const url = trustedCardImageUrl(full ? card.imageUrl : card.imageUrlSmall ?? card.imageUrl, fallback);
      const buffer = await fetchCardResource(url, fetchImpl, async (response) => Buffer.from(await response.arrayBuffer()));
      const normalized = await sharp(buffer).resize(width, height, { fit: "cover", position: "center" }).png().toBuffer();
      try { await mkdir(cacheDir, { recursive: true }); await writeFile(cachePath, normalized); } catch { /* A full disk must not stop a pick. */ }
      return normalized;
    } catch {
      // Never persist a placeholder under a card ID. A later request can recover.
      return sharp(Buffer.from(CARD_BACK_SVG)).resize(width, height).png().toBuffer();
    }
  };
  const getCachedImage = (card: DraftImageCard) => getImage(card, false);
  const getCachedFullImage = (card: DraftImageCard) => getImage(card, true);

  return {
    async renderNumberedGrid(cards: DraftImageCard[]) {
      if (cards.length !== COLUMNS * ROWS) {
        throw new Error("Draft image grid requires exactly 8 cards");
      }

      const composites = await Promise.all(
        cards.flatMap(async (card, index) => {
          const left = (index % COLUMNS) * CARD_WIDTH;
          const top = Math.floor(index / COLUMNS) * CARD_HEIGHT;
          const image = await getCachedImage(card);

          return [
            { input: image, left, top },
            { input: createNumberOverlay(index + 1, CARD_WIDTH, CARD_HEIGHT), left, top },
          ];
        }),
      );

      const buffer = await sharp({
        create: {
          width: COLUMNS * CARD_WIDTH,
          height: ROWS * CARD_HEIGHT,
          channels: 4,
          background: "#000000",
        },
      })
        .composite(composites.flat())
        .png()
        .toBuffer();

      return {
        filename: "draft-picks.png",
        buffer,
      };
    },

    async renderCardImages(cards: DraftImageCardWithLabel[]) {
      const results = await Promise.all(
        cards.map(async (card) => {
          const image = await getCachedFullImage(card);
          const overlay = createNumberOverlay(Number(card.label), CARD_FULL_WIDTH, CARD_FULL_HEIGHT);
          const buffer = await sharp(image)
            .composite([{ input: overlay, left: 0, top: 0 }])
            .png()
            .toBuffer();

          return {
            filename: `draft-card-${card.ygoprodeckId}.png`,
            buffer,
          };
        }),
      );

      return results;
    },

    async renderPoolCards(cards: DraftImageCard[]) {
      const results = await Promise.all(
        cards.map(async (card) => {
          const buffer = await getCachedFullImage(card);

          return {
            filename: `draft-card-${card.ygoprodeckId}.png`,
            buffer,
          };
        }),
      );

      return results;
    },
  };
}

export type DraftImageService = ReturnType<typeof createDraftImageService>;
