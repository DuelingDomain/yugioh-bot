"use client";

import * as React from "react";
import { confirmSeed, previewSeed, type BatchEntry, type SeedPreview } from "./effect-api";
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
 * "Describe a theme" for the theme lobby: the preview needs a cube to read against, so the first preview makes a
 * blank theme cube for the draft. Cancel takes it out again. Confirm keeps it with the cards the player kept.
 */
export function DescribeTheme({
  create,
  discard,
  onAdded,
  busy,
}: {
  /** Makes a blank theme cube named for the phrase and puts it in the draft. Resolves its id, or null when it failed. */
  create: (name: string) => Promise<number | null>;
  /** Takes the unused cube out of the draft and the library. */
  discard: (cubeId: number) => Promise<void>;
  /** The cube now holds the kept cards. */
  onAdded: (name: string, outcome: SeedOutcome) => void;
  busy?: boolean;
}) {
  const made = React.useRef<{ id: number; name: string } | null>(null);
  const latest = React.useRef(discard);
  latest.current = discard;

  // Leaving the page with a preview open drops the empty cube as well.
  React.useEffect(
    () => () => {
      const open = made.current;
      made.current = null;
      if (open) void latest.current(open.id).catch(() => {});
    },
    [],
  );

  const preview = async (phrase: string, options: { targetCount: number; signal: AbortSignal }): Promise<SeedPreview> => {
    if (!made.current) {
      const name = themeNameFrom(phrase);
      const id = await create(name);
      if (id === null) throw new Error("Could not start a theme for that phrase.");
      made.current = { id, name };
    }
    return previewSeed(made.current.id, phrase, options);
  };

  const confirm = async (entries: BatchEntry[]): Promise<SeedOutcome> => {
    const open = made.current;
    if (!open) throw new Error("Preview the cards first.");
    const outcome = await confirmSeed(open.id, entries);
    made.current = null;
    onAdded(open.name, outcome);
    return outcome;
  };

  const cancel = () => {
    const open = made.current;
    made.current = null;
    if (open) void discard(open.id).catch(() => {});
  };

  return <PhraseSeed label="Describe a theme" preview={preview} confirm={confirm} busy={busy} onCancel={cancel} />;
}
