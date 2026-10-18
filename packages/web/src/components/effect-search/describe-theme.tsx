"use client";

import { confirmSeed, previewDraftSeed, type BatchEntry, type SeedPreview } from "./effect-api";
import { PhraseSeed, type SeedOutcome } from "./phrase-seed";

/** A cube name from the phrase: the first words, not past 60 letters. */
export function themeNameFrom(phrase: string): string {
  const clean = phrase.replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

/**
 * "Describe a theme" for the theme lobby. The preview reads the catalog only, so nothing exists in the lobby
 * or the library until the host confirms. Confirm then makes the theme cube, fills it and keeps it.
 */
export function DescribeTheme({
  slug,
  create,
  discard,
  onAdded,
  busy,
}: {
  /** The draft the theme is for. */
  slug: string;
  /** Makes a blank theme cube named for the phrase and puts it in the draft. Resolves its id, or null when it failed. */
  create: (name: string) => Promise<number | null>;
  /** Takes a cube that could not be filled out of the draft and the library. */
  discard: (cubeId: number) => Promise<void>;
  /** The cube now holds the kept cards. */
  onAdded: (name: string, outcome: SeedOutcome) => void;
  busy?: boolean;
}) {
  const preview = (phrase: string, options: { targetCount: number; signal: AbortSignal }): Promise<SeedPreview> =>
    previewDraftSeed(slug, phrase, options);

  const confirm = async (entries: BatchEntry[], phrase: string): Promise<SeedOutcome> => {
    const name = themeNameFrom(phrase);
    const id = await create(name);
    if (id === null) throw new Error("Could not make a theme for that phrase. A cube with that name may already exist.");
    let outcome: SeedOutcome;
    try {
      outcome = await confirmSeed(id, entries);
    } catch (error) {
      // Do not leave an empty theme in the lobby when the cards were refused.
      await discard(id).catch(() => {});
      throw error;
    }
    onAdded(name, outcome);
    return outcome;
  };

  return <PhraseSeed label="Describe a theme" preview={preview} confirm={confirm} busy={busy} />;
}
