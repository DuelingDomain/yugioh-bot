import { readFileSync } from "node:fs";

// A complete verified mapping keeps process tests deterministic and offline.
const official = JSON.parse(readFileSync(new URL("../../../shared/tests/fixtures/genesys-official-2026-10-05.json", import.meta.url), "utf8"));
const names = Object.keys(official);
const data = Array.from({ length: 14615 }, (_, i) => {
  const id = 10000000 + i;
  return { id, name: names[i] ?? `Zero point fixture ${i}`, type: "Effect Monster", frameType: "effect",
    card_images: [{ id, image_url: `https://example.test/${id}.jpg`, image_url_small: `https://example.test/${id}.jpg` }],
    misc_info: [i < names.length ? { genesys_points: official[names[i]] } : {}] };
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => String(input) === "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes"
  ? Promise.resolve(Response.json({ data })) : originalFetch(input, init);
