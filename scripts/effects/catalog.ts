import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Card, TaggedCard } from "@yugidraft/shared/cards/effects";
import { engineInsightCard } from "@yugidraft/shared/cards/effects";
import { CARD_EFFECT_TEXT_NORMALIZATION, DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY, hashCardEffectSourceText, verifyCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import type { DeckCardInfo } from "@yugidraft/shared/duels";

export function exampleCards(): Card[] {
  return JSON.parse(readFileSync(new URL("./tagging-example-cards.json", import.meta.url), "utf8")).cards;
}
export function readPinnedArtifact(directory = DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY) {
  verifyCardEffectArtifact(directory);
  const tags = gunzipSync(readFileSync(join(directory, "tags.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line) as TaggedCard);
  const profiles = gunzipSync(readFileSync(join(directory, "profiles.jsonl.gz"))).toString("utf8").trim().split("\n").map(line => JSON.parse(line) as import("./profile-archetypes.js").StoredProfile);
  const sidecar = JSON.parse(gunzipSync(readFileSync(join(directory, "source-hashes.json.gz"))).toString("utf8"));
  if (sidecar.normalization !== CARD_EFFECT_TEXT_NORMALIZATION) throw new Error("Unknown source text normalization");
  return { tags, profiles, hashes: sidecar.hashes as Record<string, string | null>, manifest: JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) };
}
export function isTaggable(card: Card): boolean {
  return !card.subtypes.includes("token") && Boolean(hashCardEffectSourceText(card)) &&
    !(card.kind === "monster" && card.subtypes.includes("normal") && !card.subtypes.includes("pendulum"));
}

/** Explicit CI alignment: existing engine main IDs win, then known artworks,
 * then an exact unique printed name for IDs absent from that engine snapshot.
 */
export function alignArtifactToCatalog(artifact: ReturnType<typeof readPinnedArtifact>, cards: Card[]) {
  const known = new Set(cards.map(card => card.id)), aliases = new Map<number, number>();
  const names = new Map<string, number | null>();
  for (const card of cards) {
    for (const alias of card.aliases ?? []) aliases.set(alias, card.id);
    const prior = names.get(card.name);
    names.set(card.name, prior === undefined || prior === card.id ? card.id : null);
  }
  const selected = new Map<number, { sourceId: number; hash: string | null }>();
  for (const row of artifact.tags) {
    const id = known.has(row.id) ? row.id : aliases.get(row.id) ?? names.get(row.name) ?? row.id;
    const current = selected.get(id);
    if (!current || row.id === id || (current.sourceId !== id && row.id < current.sourceId)) selected.set(id, { sourceId: row.id, hash: artifact.hashes[row.id] ?? null });
  }
  return { tagIds: new Set(selected.keys()), hashes: new Map([...selected].map(([id, row]) => [id, row.hash])) };
}

/** Reads the existing catalog loader; no engine preparation, scripts or cores run. */
export async function loadTaggingCatalog(directory: string): Promise<Card[]> {
  const loaderPath = "../../packages/duel-server/src/cards.js";
  const { loadCardDatabase } = await import(loaderPath);
  const database = loadCardDatabase(directory);
  try {
    const popularity = JSON.parse(gunzipSync(readFileSync(join(DEFAULT_CARD_EFFECT_ARTIFACT_DIRECTORY, "popularity.json.gz"))).toString("utf8"));
    const all: DeckCardInfo[] = [...database.all()], aliases = new Map<number, number[]>();
    for (const raw of all) if (raw.canonicalPasscode && raw.canonicalPasscode !== raw.code) aliases.set(raw.canonicalPasscode, [...(aliases.get(raw.canonicalPasscode) ?? []), raw.code]);
    return all.filter((raw: DeckCardInfo) => !raw.canonicalPasscode || raw.canonicalPasscode === raw.code).map((raw: DeckCardInfo) => {
      const card = engineInsightCard(raw, database.setnames(), popularity[raw.code] ?? 0);
      card.aliases = aliases.get(card.id);
      card.typeLine = `${card.subtypes.map(type => type.replace(/_/g, " ")).join(" ")} ${card.kind}`;
      if (card.subtypes.includes("pendulum")) {
        const sections = card.text.match(/^\s*\[\s*Pendulum Effect\s*\]([\s\S]*?)\[\s*(?:Monster Effect|Flavor Text)\s*\]([\s\S]*)$/i);
        if (sections) {
          card.pendulumText = sections[1].replace(/\s*-{3,}\s*$/, "").trim();
          card.text = sections[2].trim();
        }
        card.scale = raw.lscale;
      }
      return card;
    });
  } finally { database.close(); }
}
