"use client";

import * as React from "react";

export type TournamentFormat = "round_robin" | "single_elim";

/** The tournament made from a draft. The name and slug are null when only the id is known. */
export interface LinkedTournament {
  name: string | null;
  webSlug: string | null;
}

export interface DraftTournament {
  /** The tournament made from this draft, whether it existed before or was just created. */
  linked: LinkedTournament | null;
  format: TournamentFormat;
  setFormat: (format: TournamentFormat) => void;
  bestOf: 1 | 3;
  setBestOf: (bestOf: 1 | 3) => void;
  creating: boolean;
  error: string | null;
  /** POST the chosen format to `/api/drafts/[slug]/tournament`. Only the draft host may do this. */
  create: () => Promise<void>;
}

/**
 * Who can see the tournament made from a draft. It keeps the draft's setting; the draft's own invite link does not carry
 * over, so the host shares the tournament's link. Null when the draft sent no setting.
 */
export function inheritedVisibilityNote(visibility: "open" | "private" | undefined): string | null {
  if (visibility === "private") return "It is private, like this draft. Only the drafters and people you invite to the tournament can see it.";
  if (visibility === "open") return "It is open, like this draft. Anyone can see it and join while entries are open.";
  return null;
}

/**
 * The "make a tournament from this draft" state, shared by the finale and the results page so
 * a tournament made in one shows up in the other.
 */
export function useDraftTournament(
  slug: string,
  known: { tournamentId?: number | null; tournamentName?: string | null; tournamentSlug?: string | null },
): DraftTournament {
  const [format, setFormat] = React.useState<TournamentFormat>("round_robin");
  const [bestOf, setBestOf] = React.useState<1 | 3>(3);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<LinkedTournament | null>(null);

  const create = React.useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${slug}/tournament`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, bestOf }),
      });
      const data = await res.json();
      // 409: the draft already has a tournament (made on another tab); link to it.
      if (res.ok || (res.status === 409 && data.webSlug)) {
        setCreated({ name: data.name ?? null, webSlug: data.webSlug ?? null });
        return;
      }
      throw new Error(data.error ?? "Failed to create tournament");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tournament");
    } finally {
      setCreating(false);
    }
  }, [slug, format, bestOf]);

  const linked =
    created ??
    (known.tournamentId != null ? { name: known.tournamentName ?? null, webSlug: known.tournamentSlug ?? null } : null);

  return { linked, format, setFormat, bestOf, setBestOf, creating, error, create };
}
