import { formatMatchTime } from "@/lib/format-date";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { isDraftTournament, rulesValueFromTournament } from "./duel-rules";
import type { TournamentDetail } from "./types";

function formatLabel(format: string): string {
  if (format === "round_robin") return "Round Robin";
  if (format === "single_elim") return "Single Elimination";
  return format;
}

export function OverviewInfo({ tournament }: { tournament: TournamentDetail }) {
  const started = formatMatchTime(tournament.startedAt);
  const rows: Array<{ label: string; value: string }> = [
    { label: "Format", value: formatLabel(tournament.format) },
    { label: "Started", value: started || "—" },
    { label: "Players", value: String(tournament.participants.length) },
  ];
  if (tournament.bestOf != null || tournament.duelRules) {
    const rules = rulesValueFromTournament(tournament);
    rows.push({ label: "Match length", value: `Best of ${rules.bestOf}` });
    if (isDraftTournament(tournament)) {
      rows.push({ label: "Rules", value: "Draft pool, no banlist" });
    } else {
      const banlist = DUEL_BANLIST_OPTIONS.find((option) => option.id === rules.banlist)?.label ?? rules.banlist;
      rows.push({ label: "Mode", value: rules.mode === "domain" ? "Domain" : "Normal" });
      rows.push({ label: "Banlist", value: banlist });
      rows.push({ label: "Turn time", value: rules.turnSeconds === 0 ? "Unlimited" : `${rules.turnSeconds} s` });
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-body text-sm font-semibold uppercase tracking-wider text-text-secondary">
        Details
      </h2>
      <dl className="space-y-2 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">{row.label}</dt>
            <dd className="text-text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
