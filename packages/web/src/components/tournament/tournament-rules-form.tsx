"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuelRulesFields } from "./duel-rules-fields";
import {
  buildRulesPayload,
  isDraftTournament,
  rulesValueFromTournament,
  type DuelRulesValue,
} from "./duel-rules";
import type { TournamentDetail } from "./types";

/**
 * Organizer form for the Best of and basic duel rules of a tournament.
 * Read-only once the server reports the rules locked (a game started or the tournament closed).
 */
export function TournamentRulesForm({
  tournament,
  tournamentSlug,
  onSaved,
}: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  onSaved: () => void;
}) {
  const draft = isDraftTournament(tournament);
  const locked = tournament.rulesLocked === true;
  const serverValue = rulesValueFromTournament(tournament);
  const [value, setValue] = React.useState<DuelRulesValue>(serverValue);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // A websocket refetch brings the stored rules; follow them unless the form is being edited.
  const serverKey = JSON.stringify(serverValue);
  const lastServerKey = React.useRef(serverKey);
  React.useEffect(() => {
    if (lastServerKey.current === serverKey) return;
    lastServerKey.current = serverKey;
    setValue(serverValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      // A draft tournament accepts only bestOf; its other rules are fixed.
      const body = draft ? { bestOf: value.bestOf } : buildRulesPayload(value);
      const res = await fetch(`/api/tournaments/${tournamentSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save duel rules");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Duel rules"
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <h3 className="font-body text-sm font-semibold uppercase tracking-wider text-text-secondary">
        Duel rules
      </h3>
      {error && <p className="text-sm text-accent-cta">{error}</p>}
      <DuelRulesFields
        idPrefix="settings-rules"
        value={value}
        onChange={setValue}
        draft={draft}
        disabled={locked}
      />
      {locked ? (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Locked — the first online game has started, or the event is over.
        </p>
      ) : (
        <Button type="submit" loading={saving} size="sm">
          {saved ? "Saved" : "Save duel rules"}
        </Button>
      )}
    </form>
  );
}
