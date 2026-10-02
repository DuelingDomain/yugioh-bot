"use client";

import { useState } from "react";
import { Pen } from "lucide-react";
import { SheetPanel } from "@/components/sheet";
import { formatLabel, rulesSummary } from "../sheet-rules";
import { formatWhen } from "../sheet-dates";
import { TournamentRulesForm } from "../tournament-rules-form";
import { TournamentSettingsForm } from "../tournament-settings-form";
import type { TournamentDetail } from "../types";

/**
 * The Rules sheet of the rail. Everything about how the event runs, once. The organizer edits in place:
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
  const format = `${formatLabel(tournament.format)}${summary ? ` · Best of ${summary.bestOf}` : ""}`;
  const done = () => {
    setEditing(null);
    onChanged();
  };
  const edit = (what: "rules" | "timing", label: string) => (
    <button type="button" className="edit" aria-expanded={editing === what} aria-label={label} onClick={() => setEditing(editing === what ? null : what)}>
      Edit
    </button>
  );

  return (
    <SheetPanel
      title="Rules"
      aside={canEdit ? <button type="button" className="edit-cap" aria-expanded={editing === "rules"} onClick={() => setEditing(editing === "rules" ? null : "rules")}>Edit rules</button> : undefined}
      footer={canEdit ? <><Pen className="ic sm" aria-hidden="true" />{tournament.rulesLocked ? "Rules are locked. A game has started." : "Every rule is open until the first online duel opens."}</> : undefined}
    >
      <dl className="rows">
        <div><dt>Format</dt><dd>{format}</dd></div>
        {summary?.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
        <div><dt>Closes</dt><dd>{closes}{canEdit && edit("timing", "Edit deadline")}</dd></div>
        <div><dt>Confirm window</dt><dd>{hours != null ? `${hours} hours` : "Default"}{canEdit && edit("timing", "Edit confirm window")}</dd></div>
      </dl>
      {canEdit && editing === "timing" && (
        <TournamentSettingsForm
          tournamentSlug={tournamentSlug}
          initialDeadlineAt={tournament.deadlineAt}
          initialReportConfirmWindowHours={tournament.reportConfirmWindowHours}
          onSaved={done}
        />
      )}
      {canEdit && editing === "rules" && <TournamentRulesForm tournament={tournament} tournamentSlug={tournamentSlug} onSaved={done} />}
    </SheetPanel>
  );
}
