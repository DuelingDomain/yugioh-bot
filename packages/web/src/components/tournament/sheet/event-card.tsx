import Link from "next/link";
import sheet from "@/components/sheet/sheet.module.css";
import { formatWhen } from "../sheet-dates";
import { formatLabel, rulesSummary } from "../sheet-rules";
import type { TournamentDetail } from "../types";
import type { TournamentProgress } from "./sheet-model";
import styles from "./tournament-sheet.module.css";

export function EventCard({ tournament, progress }: { tournament: TournamentDetail; progress: TournamentProgress }) {
  const rules = rulesSummary(tournament);
  const rows = [...(rules?.rows ?? []), { label: "Started", value: formatWhen(tournament.startedAt) ?? "—" }];
  return <section className={sheet.card} aria-label="Event details">
    <div><p className={sheet["card-kind"]}>{formatLabel(tournament.format)}{rules && ` · Best of ${rules.bestOf}`}</p></div>
    <dl className={sheet.tally}>
      <div><dd>{progress.done}<span>/{progress.total}</span></dd><dt>Decided</dt></div>
      <div><dd>{progress.live}</dd><dt>Live</dt></div>
      <div><dd>{progress.toConfirm}</dd><dt>To confirm</dt></div>
    </dl>
    <dl className={sheet.rows}>
      {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
      {tournament.draftSlug && <div><dt>Draft</dt><dd><Link className={`${sheet.link} ${styles["draft-link"]}`} href={`/draft/${tournament.draftSlug}`}>View draft</Link></dd></div>}
    </dl>
  </section>;
}
