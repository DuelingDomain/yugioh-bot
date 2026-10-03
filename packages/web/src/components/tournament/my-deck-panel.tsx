"use client";

import * as React from "react";
import Link from "next/link";
import { DeckMark, StatusLine, SvButton } from "@/components/sheet";
import { deckSummaryText, parseMyDeckState, registerErrorText, type MyDeckState } from "./my-deck-model";
import type { TournamentDetail } from "./types";
import styles from "./my-deck.module.css";

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
    <section id="tournament-my-deck" data-testid="tournament-my-deck" className={styles.panel}>
      <h2 className={styles.h}>My deck</h2>

      {registration ? (
        <p className={styles.line}>
          <DeckMark state="in" locked={locked} />
          <span className={styles.summary}>{deckSummaryText(registeredName, registration.deck)}</span>
        </p>
      ) : (
        <p className={styles.line}><DeckMark state="none" /></p>
      )}

      {locked ? (
        <p className={styles.note}>Locked. Your first tournament game started.</p>
      ) : isDraft ? (
        <div className={styles.stack}>
          <p className={styles.note}>Your draft deck is used.</p>
          <div className={styles.row}>
            {editDeckId !== null ? (
              // The pool editor enforces the draft pool limits; the generic editor does not.
              <Link href={draftSlug ? `/decks/draft/${draftSlug}` : `/decks/${editDeckId}`} className={styles.link}>
                Edit draft deck
              </Link>
            ) : draftSlug ? (
              <Link href={`/draft/${draftSlug}`} className={styles.link}>
                Build your deck from the draft
              </Link>
            ) : null}
            {registration == null && draftDeckOption !== null && (
              <SvButton variant="primary" disabled={saving} aria-busy={saving} onClick={() => handleRegister(draftDeckOption.id)}>
                Register
              </SvButton>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.stack}>
          {savedDeckOptions.length === 0 ? (
            <p className={styles.note}>
              You have no saved decks.{" "}
              <Link href="/decks/new" className={styles.link}>
                Build a deck
              </Link>{" "}
              and come back to register it.
            </p>
          ) : (
            <div className={styles.pick}>
              <div className={styles.field}>
                <label htmlFor="my-deck-select" className={styles.label}>
                  Saved deck
                </label>
                <select
                  id="my-deck-select"
                  value={selectValue}
                  onChange={(e) => setSelected(e.target.value)}
                  className={styles.select}
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
              <SvButton variant="primary" disabled={saving || !canSubmit} aria-busy={saving} onClick={() => handleRegister(Number(selected))}>
                {savedNote ? "Saved" : registration ? "Change" : "Register"}
              </SvButton>
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className={styles.err}>
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      )}
    </section>
  );
}
