"use client";

import { useId, useState, type FormEvent } from "react";
import { AlertCircle, Flag, Lock, X } from "lucide-react";
import sheet from "@/components/sheet/sheet.module.css";
import { formatWhen, parseDbTime } from "../sheet-dates";
import { TournamentRulesForm } from "../tournament-rules-form";
import type { TournamentDetail } from "../types";
import { useOptionalRouter } from "../use-optional-router";
import styles from "./tournament-sheet.module.css";

type TimingField = "deadlineAt" | "reportConfirmWindowHours";

// The settings form's datetime-local conversion, using the shared UTC parser for DB times.
function localDeadline(value: string | undefined): string {
  const date = parseDbTime(value);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function TimingRow({ field, tournament, tournamentSlug, onChanged }: {
  field: TimingField; tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = field === "deadlineAt";
  const label = deadline ? "Deadline" : "Confirm window";
  const display = deadline ? (formatWhen(tournament.deadlineAt) ?? "Not set") : `${tournament.reportConfirmWindowHours ?? 24} hours`;

  function beginEdit() {
    setValue(deadline ? localDeadline(tournament.deadlineAt) : String(tournament.reportConfirmWindowHours ?? 24));
    setError(null);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      // Same optional fields, parsing, method and headers as TournamentSettingsForm.
      // Sending just the edited field preserves a concurrent update to the other row.
      const parsed = deadline ? (value ? new Date(value).toISOString() : null) : (value.trim() ? Number(value) : null);
      if (!deadline && parsed !== null && (!Number.isInteger(parsed) || Number(parsed) < 1 || Number(parsed) > 720)) {
        throw new Error("Confirm window must be a whole number from 1 to 720 hours");
      }
      const res = await fetch(`/api/tournaments/${tournamentSlug}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: parsed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save settings");
      }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSaving(false);
    }
  }

  return <div className={styles["setting-row"]} data-editing={editing}>
    <dt>{editing ? <label htmlFor={id}>{label}</label> : label}</dt>
    <dd>{editing ? <form className={styles.editor} onSubmit={save} aria-label={`Edit ${label.toLowerCase()}`}>
      <input id={id} className={sheet.input} type={deadline ? "datetime-local" : "number"}
        aria-label={deadline ? "Deadline" : "Confirm window (hours)"} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
        min={deadline ? undefined : 1} max={deadline ? undefined : 720} step={deadline ? undefined : 1}
        placeholder={deadline ? undefined : "24"} value={value} disabled={saving} onChange={(event) => setValue(event.target.value)} />
      <div className={`${sheet.acts} ${styles["editor-acts"]}`}>
        <button type="submit" className={`${sheet.btn} ${sheet["btn-secondary"]} ${sheet["btn-sm"]} ${styles.button}`} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className={`${sheet.btn} ${sheet["btn-quiet"]} ${sheet["btn-sm"]} ${styles.button} ${styles.quiet}`} disabled={saving} onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className={styles.error}>{error}</p>}
    </form> : <>{display}<button type="button" className={sheet.edit} aria-label={`Edit ${label.toLowerCase()}`} onClick={beginEdit}>Edit</button></>}</dd>
  </div>;
}

export function OrganizerPanel({ tournament, tournamentSlug, onChanged }: {
  tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void;
}) {
  const titleId = useId();
  const rulesId = useId();
  const router = useOptionalRouter();
  const [showRules, setShowRules] = useState(false);
  const [confirm, setConfirm] = useState<"complete" | "cancel" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (!confirm || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournamentSlug}${confirm === "complete" ? "/complete" : ""}`, {
        method: confirm === "complete" ? "POST" : "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? (confirm === "complete" ? "Failed to end tournament" : "Failed to cancel"));
      }
      if (confirm === "cancel") router?.push("/tournaments");
      else { setConfirm(null); onChanged(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : (confirm === "complete" ? "Failed to end tournament" : "Failed to cancel"));
    } finally {
      setLoading(false);
    }
  }

  if (tournament.status !== "active") return null;
  return <section className={`${sheet.panel} ${sheet["panel-pad"]} ${styles.organizer}`} aria-labelledby={titleId}>
    <h2 className={sheet["panel-t"]}><span id={titleId}>Organizer</span><small>only you see this</small></h2>
    <dl className={sheet.rows}>
      <TimingRow field="deadlineAt" tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
      <TimingRow field="reportConfirmWindowHours" tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
    </dl>
    {tournament.rulesLocked ? <p className={styles.lockline}><Lock className={`${styles.ic} ${styles.sm}`} aria-hidden="true" />Duel rules are locked. The first online duel has been opened.</p> : <>
      <button type="button" className={`${sheet.btn} ${sheet["btn-quiet"]} ${sheet["btn-sm"]} ${styles.button} ${styles.quiet} ${styles["rules-toggle"]}`} aria-expanded={showRules} aria-controls={rulesId} onClick={() => setShowRules(!showRules)}>Edit rules</button>
      {showRules && <div id={rulesId}><TournamentRulesForm tournament={tournament} tournamentSlug={tournamentSlug} onSaved={onChanged} /></div>}
    </>}
    <div className={styles["org-end"]}>
      {confirm ? <div className={styles.confirm}>
        <div className={`${sheet.banner} ${sheet["banner-warn"]}`}><AlertCircle aria-hidden="true" /><div>
          {confirm === "complete" ? <><strong>End the tournament now?</strong> Unplayed matches stay unplayed and no champion is recorded.</> : <><strong>Cancel this tournament?</strong> It closes for everyone and can&apos;t be reopened.</>}
        </div></div>
        <div className={`${sheet.acts} ${styles["confirm-acts"]}`}>
          <button type="button" className={`${sheet.btn} ${sheet["btn-quiet"]} ${sheet["btn-sm"]} ${styles.button} ${styles.quiet}`} disabled={loading} onClick={() => { setConfirm(null); setError(null); }}>Keep playing</button>
          <button type="button" className={`${sheet.btn} ${sheet["btn-danger"]} ${sheet["btn-sm"]} ${styles.button} ${styles.danger}`} disabled={loading} onClick={finish}>{loading ? (confirm === "complete" ? "Ending…" : "Cancelling…") : (confirm === "complete" ? "End tournament" : "Cancel tournament")}</button>
        </div>
      </div> : <>
        <button type="button" className={`${sheet.btn} ${sheet["btn-quiet"]} ${sheet["btn-sm"]} ${styles.button} ${styles.quiet}`} onClick={() => { setConfirm("complete"); setError(null); }}><Flag aria-hidden="true" />End tournament now</button>
        <button type="button" className={`${sheet.btn} ${sheet["btn-danger-quiet"]} ${sheet["btn-sm"]} ${styles.button} ${styles.quiet}`} onClick={() => { setConfirm("cancel"); setError(null); }}><X aria-hidden="true" />Cancel tournament</button>
      </>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </section>;
}
