/** Yu-Gi-Oh catalog adapter; full coverage includes Tokens, Skills and every alternate image. */
export type CatalogCard = {
  id: number; name: string; frameType: string; type: string;
  views: number; date: string; sets: string[];
  images: { id: number; cropped: string; full: string }[];
};

export const CATALOG_VERSION = 2;
export function catalogCards(parsed: any): CatalogCard[] {
  const rows = Array.isArray(parsed) ? parsed : parsed.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Catalog has no cards');
  return rows.flatMap((row: any) => {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.name !== 'string' || !Array.isArray(row.card_images)) return [];
    // Only the unnamed upstream placeholder lacks a usable card identity.
    if (row.name === '???') return [];
    const images = row.card_images.filter((im: any) => Number.isSafeInteger(im.id ?? row.id) && im.image_url)
      .map((im: any) => ({ id: im.id ?? row.id, full: im.image_url,
        cropped: im.image_url_cropped ?? `https://images.ygoprodeck.com/images/cards_cropped/${im.id ?? row.id}.jpg` }));
    if (!images.length) return [];
    const misc = row.misc_info?.[0] ?? {};
    const dates = [misc.tcg_date, misc.ocg_date].filter((date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
    return [{ id: row.id, name: row.name, frameType: row.frameType ?? '', type: row.type ?? '',
      views: Number(misc.views ?? 0), date: dates.sort()[0] ?? '0000-00-00',
      sets: (row.card_sets ?? []).map((set: any) => set.set_name).filter((name: unknown) => typeof name === 'string'), images }];
  });
}
