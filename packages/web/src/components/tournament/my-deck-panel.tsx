"use client";

import * as React from "react";
import Link from "next/link";
import { Layers, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deckSummaryText, parseMyDeckState, registerErrorText, type MyDeckState } from "./my-deck-model";
import type { TournamentDetail } from "./types";

const SELECT_CLASS =
  "native-select w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-60";

/**
 * "My deck" for a participant: the registered deck and its lock state, plus
 * registration. A draft tournament uses the player's draft deck; any other
 * tournament takes a saved deck.
 */
export function MyDeckPanel({
  tournament,
  tournamentSlug,
  onChanged,
}: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  onChanged: () => void;
}) {
  const [state, setState] = React.useState<MyDeckState | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [selected, setSelected] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedNote, setSavedNote] = React.useState(false);
  const latestRequest = React.useRef(0);

  const visible =
    tournament.isParticipant &&
    tournament.currentUserPlayerId !== null &&
    (tournament.status === "pending" || tournament.status === "active");

  const load = React.useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}/deck`);
      if (!res.ok || request !== latestRequest.current) return;
      const next = parseMyDeckState(await res.json());
      if (request === latestRequest.current) setState(next);
    } catch {
      // The panel stays on its last state; the next refetch tries again.
    } finally {
      if (request === latestRequest.current) setLoaded(true);
    }
  }, [tournamentSlug]);

  // The page refetches the tournament on websocket events; follow it so lock state stays current.
  React.useEffect(() => {
    if (visible) void load();
    return () => { latestRequest.current++; };
  }, [visible, load, tournament]);

  if (!visible || !loaded || !state) return null;

  const isDraft = state.draft !== null || tournament.draftId != null;
  const draftSlug = state.draft?.slug ?? tournament.draftSlug ?? null;
  const { registration, savedDeckOptions } = state;
  const locked = registration?.lockedAt != null;
  const registeredName =
    registration?.savedDeckId != null
      ? (savedDeckOptions.find((option) => option.id === registration.savedDeckId)?.name ?? null)
      : null;
  // A draft tournament has one deck to register: the player's draft deck.
  const draftDeckOption = isDraft ? (savedDeckOptions[0] ?? null) : null;
  const editDeckId = registration?.savedDeckId ?? draftDeckOption?.id ?? null;
  const currentId = registration?.savedDeckId ?? null;
  const selectValue = selected || (currentId !== null ? String(currentId) : "");
  const canSubmit = selected !== "" && Number(selected) !== currentId;

  async function handleRegister(savedDeckId: number) {
    setSaving(true);
    setError(null);
    setSavedNote(false);
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}/deck`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedDeckId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(registerErrorText(data, "Failed to register the deck"));
      }
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 2000);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register the deck");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="tournament-my-deck" data-testid="tournament-my-deck" className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 font-body text-sm font-semibold uppercase tracking-wider text-text-secondary">
        <Layers className="h-4 w-4 text-accent-primary" aria-hidden="true" />
        My deck
      </h2>

      {registration ? (
        <p className="text-sm text-text-primary">
          <span className="font-semibold text-accent-success">Registered</span>
          {" · "}
          {deckSummaryText(registeredName, registration.deck)}
        </p>
      ) : (
        <p className="text-sm text-accent-gold">No deck registered yet.</p>
      )}

      {locked ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-text-secondary">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Locked — your first tournament game started
        </p>
      ) : isDraft ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-text-secondary">Your draft deck is used.</p>
          <div className="flex flex-wrap items-center gap-3">
            {editDeckId !== null ? (
              // The pool editor enforces the draft pool limits; the generic editor does not.
              <Link href={draftSlug ? `/decks/draft/${draftSlug}` : `/decks/${editDeckId}`} className="text-sm font-medium text-accent-primary hover:underline">
                Edit draft deck
              </Link>
            ) : draftSlug ? (
              <Link href={`/draft/${draftSlug}`} className="text-sm font-medium text-accent-primary hover:underline">
                Build your deck from the draft
              </Link>
            ) : null}
            {registration == null && draftDeckOption !== null && (
              <Button size="sm" loading={saving} onClick={() => handleRegister(draftDeckOption.id)}>
                Register
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {savedDeckOptions.length === 0 ? (
            <p className="text-sm text-text-secondary">
              You have no saved decks.{" "}
              <Link href="/decks/new" className="font-medium text-accent-primary hover:underline">
                Build a deck
              </Link>{" "}
              and come back to register it.
            </p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="my-deck-select" className="mb-1 block text-sm font-medium text-text-primary">
                  Saved deck
                </label>
                <select
                  id="my-deck-select"
                  value={selectValue}
                  onChange={(e) => setSelected(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="" disabled>
                    Choose a deck
                  </option>
                  {savedDeckOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.mainCount !== null ? `${option.name} (${option.mainCount} main)` : option.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="md" loading={saving} disabled={!canSubmit} onClick={() => handleRegister(Number(selected))}>
                {savedNote ? "Saved" : registration ? "Change" : "Register"}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-accent-cta">
          {error}
        </p>
      )}
    </section>
  );
}
