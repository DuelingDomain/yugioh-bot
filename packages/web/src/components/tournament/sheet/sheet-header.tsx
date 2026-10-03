import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { MetaLine } from "@/components/meta-line/meta-line";
import { LivePill, StationTrack } from "@/components/sheet";
import { formatWhen } from "../sheet-dates";
import { formatLabel, rulesSummary } from "../sheet-rules";
import type { TournamentDetail } from "../types";
import type { TournamentProgress } from "./sheet-model";
import styles from "./sheet-header.module.css";

export type TournamentEnding = "finished" | "ended-early" | "cancelled" | null;

/** Completed with matches still unplayed means the organizer ended it, or the deadline passed. */
export function tournamentEnding(tournament: TournamentDetail): TournamentEnding {
  if (tournament.status === "cancelled") return "cancelled";
  if (tournament.status !== "completed") return null;
  return tournament.matches.some((match) => match.status !== "completed") ? "ended-early" : "finished";
}

function Lamp({ state }: { state: "done" | "off" | "open" }) {
  return <span className="lamp" data-s={state} aria-hidden="true" />;
}

export function SheetHeader({ tournament, progress, mine, ending, caption }: {
  tournament: TournamentDetail;
  progress: TournamentProgress;
  /** Whether the viewer has a move to make right now. */
  mine: boolean;
  ending: TournamentEnding;
  caption?: ReactNode;
}) {
  const rules = rulesSummary(tournament);
  const started = formatWhen(tournament.startedAt);
  const pending = tournament.status === "pending";
  const active = tournament.status === "active";
  const status = active ? <LivePill>In progress</LivePill>
    : <span className="status"><Lamp state={pending ? "open" : ending === "cancelled" ? "off" : "done"} />{pending ? "Open to join" : ending === "cancelled" ? "Cancelled" : ending === "ended-early" ? "Ended early" : "Completed"}</span>;
  const meta = [
    formatLabel(tournament.format),
    ...(rules && !active ? [`Best of ${rules.bestOf}`] : []),
    `${tournament.participants.length} players`,
    ...(started && !pending ? [`Started ${started}`] : []),
    ...(active && progress.currentRound !== null ? [`Round ${progress.currentRound} of ${progress.totalRounds}`] : []),
  ];

  // Station codes: Lobby, Play, Final. The plate lit is where the event is.
  const current = pending ? 0 : active ? 1 : ending === "cancelled" ? -1 : 2;
  const play = active || !pending ? `${progress.done} of ${progress.total}` : `${matchTotal(tournament)} matches`;
  const tone = active ? (mine ? "mine" : "theirs") : "theirs";
  const trackCaption = caption ?? defaultCaption({ tournament, progress, ending, pending, active });

  return (
    <>
      <Link href="/tournaments" className="crumb"><ChevronLeft className="ic sm" aria-hidden="true" />All tournaments</Link>
      <header className="t-head sheet-head">
        <div>
          <h1 className="t-title">{tournament.name}</h1>
          <MetaLine className="t-meta" items={[{ content: status }, ...meta.map((value) => ({ content: value }))]} />
        </div>
        <StationTrack
          className={styles.track}
          stations={[{ code: "LB", name: "Lobby" }, { code: "PL", name: play }, { code: "FN", name: "Final" }]}
          current={current}
          tone={tone}
          caption={trackCaption}
          label="Tournament progress"
        />
      </header>
    </>
  );
}

function matchTotal(tournament: TournamentDetail) {
  const n = tournament.participants.length;
  if (tournament.format === "single_elim") return Math.max(0, n - 1);
  return (n * (n - 1)) / 2;
}

function defaultCaption({ tournament, progress, ending, pending, active }: {
  tournament: TournamentDetail; progress: TournamentProgress; ending: TournamentEnding; pending: boolean; active: boolean;
}) {
  const n = tournament.participants.length;
  if (pending) return <><span className="at">Lobby</span><span className="sep">·</span><span>{n} joined</span></>;
  if (ending === "cancelled") return <span className="at">Cancelled</span>;
  if (ending === "ended-early") return <><span className="at">Ended early</span><span className="sep">·</span><span>{progress.done} of {progress.total} decided</span></>;
  if (!active) return <><span className="at">Finished</span><span className="sep">·</span><span>all {progress.total} decided</span></>;
  const parts = [`${progress.done} of ${progress.total} decided`];
  if (progress.live > 0) parts.push(`${progress.live} live`);
  if (progress.toConfirm > 0) parts.push(`${progress.toConfirm} to confirm`);
  if (progress.yours > 0) parts.push(`${progress.yours} ${progress.yours === 1 ? "is" : "are"} yours`);
  return <><span className="at">Playing</span>{parts.map((part) => <Fragment key={part}><span className="sep">·</span><span>{part}</span></Fragment>)}</>;
}
