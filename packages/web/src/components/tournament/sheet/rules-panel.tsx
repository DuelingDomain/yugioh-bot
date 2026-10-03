"use client";

import { useState } from "react";
import { formatLabel, rulesSummary } from "../sheet-rules";
import { formatWhen } from "../sheet-dates";
import { TournamentRulesForm } from "../tournament-rules-form";
import { TournamentSettingsForm } from "../tournament-settings-form";
import type { TournamentDetail } from "../types";
import { RailSection } from "./rail-section";
import styles from "./rail.module.css";

/**
 * The Rules section of the rail. Everything about how the event runs, once. The organizer edits in place:
 * the existing rules and settings forms open under the rows and call the same endpoints as before.
 */
export function RulesPanel({
  tournament,
  tournamentSlug,
  isHost,
  onChanged,
}: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  isHost: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<"rules" | "timing" | null>(null);
  const summary = rulesSummary(tournament);
  const open = tournament.status === "pending" || tournament.status === "active";
  const canEdit = isHost && open;
  const closes = formatWhen(tournament.deadlineAt) ?? "No deadline";
  const hours = tournament.reportConfirmWindowHours;
  const started = formatWhen(tournament.startedAt);
  const format = `${formatLabel(tournament.format)}${summary ? `, Best of ${summary.bestOf}` : ""}`;
  const done = () => {
    setEditing(null);
    onChanged();
  };
  const edit = (what: "rules" | "timing", label: string) => (
    <button type="button" className={styles.edit} aria-expanded={editing === what} aria-label={label} onClick={() => setEditing(editing === what ? null : what)}>
      Edit
    </button>
  );
  const locked = tournament.rulesLocked && tournament.status === "active";
  const aside = !open ? "As played."
    : locked && !canEdit ? "Locked since the first duel opened."
    : undefined;

  return (
    <RailSection title="Rules" aside={aside}>
      <dl className={styles.rules}>
        <dt>Format</dt><dd>{format}</dd>
        {summary?.rows.map((row) => <div key={row.label} style={{ display: "contents" }}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        {open && <><dt>Closes</dt><dd>{closes}{canEdit && edit("timing", "Edit deadline")}</dd></>}
        {open && <><dt>Confirm window</dt><dd>{hours != null ? `${hours} hours` : "Default"}{canEdit && edit("timing", "Edit confirm window")}</dd></>}
        {!open && started && <><dt>Started</dt><dd>{started}</dd></>}
      </dl>
      {canEdit && !tournament.rulesLocked && (
        <p className={styles.editNote}>
          Every rule is open until the first online duel opens.{" "}
          <button type="button" className={styles.edit} style={{ marginLeft: 0 }} aria-expanded={editing === "rules"} onClick={() => setEditing(editing === "rules" ? null : "rules")}>Edit rules</button>
        </p>
      )}
      {canEdit && tournament.rulesLocked && <p className={styles.editNote}>Only you can edit the last two. Duel rules stay locked once a duel has been opened.</p>}
      {canEdit && editing === "timing" && (
        <TournamentSettingsForm
          key={`${tournament.deadlineAt ?? ""}:${tournament.reportConfirmWindowHours ?? ""}`}
          tournamentSlug={tournamentSlug}
          initialDeadlineAt={tournament.deadlineAt}
          initialReportConfirmWindowHours={tournament.reportConfirmWindowHours}
          onSaved={done}
        />
      )}
      {canEdit && editing === "rules" && <TournamentRulesForm tournament={tournament} tournamentSlug={tournamentSlug} onSaved={done} />}
    </RailSection>
  );
}
