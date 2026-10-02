import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LivePill, StationTrack } from "@/components/sheet";
import { draftProgressLabel, draftStatus, plural, tournamentFormatLabel } from "./dashboard-model";
import styles from "./dashboard.module.css";

export type DashboardTournament = {
  id: number;
  name: string;
  format: string;
  status: string;
  webSlug?: string;
  participantCount: number;
};

export type DashboardDraft = {
  id: number;
  name: string;
  status: string;
  webSlug?: string;
  currentPackRound: number;
  currentPickStep: number;
  playerCount: number;
};

const STATIONS = [
  { code: "LB", name: "Lobby" },
  { code: "PL", name: "Playing" },
  { code: "FN", name: "Final" },
];

function Dot() {
  return <span className="dot" aria-hidden="true" />;
}

/** Every row on the dashboard is one you play in, so every row carries the purple edge. */
export function TournamentRow({ tournament }: { tournament: DashboardTournament }) {
  const active = tournament.status === "active";
  return (
    <Link href={`/tournament/${tournament.webSlug ?? tournament.id}`} className={`db-row ${styles.row}`} data-you>
      <div>
        <p className="nm">{tournament.name}</p>
        <p className="mt">
          {active ? <LivePill>In progress</LivePill> : <span className="status">Open to join</span>}
          <Dot />
          {tournamentFormatLabel(tournament.format)}
          <Dot />
          {active ? plural(tournament.participantCount, "player") : `${tournament.participantCount} joined`}
        </p>
      </div>
      <div className={`rt ${styles.rt}`}>
        <StationTrack
          stations={STATIONS}
          current={active ? 1 : 0}
          tone="mine"
          size="sm"
          label={`${tournament.name} progress`}
        />
        <ChevronRight className="ic sm" aria-hidden="true" />
      </div>
    </Link>
  );
}

export function DraftRow({ draft }: { draft: DashboardDraft }) {
  const stage = draftStatus(draft.status);
  const progress = draftProgressLabel(draft.status, draft.currentPackRound, draft.currentPickStep);
  const body = (
    <>
      <div>
        <p className="nm">{draft.name}</p>
        <p className="mt">
          {stage.live ? <LivePill>{stage.label}</LivePill> : <span className="status">{stage.label}</span>}
          {progress && (
            <>
              <Dot />
              {progress}
            </>
          )}
          <Dot />
          {plural(draft.playerCount, "player")}
        </p>
      </div>
      <div className="rt">
        {stage.live ? (
          <span className="btn btn-secondary btn-sm">Back to draft</span>
        ) : (
          <ChevronRight className="ic sm" aria-hidden="true" />
        )}
      </div>
    </>
  );
  if (!draft.webSlug) {
    return <div className="db-row" data-you>{body}</div>;
  }
  return (
    <Link href={`/draft/${draft.webSlug}`} className={`db-row ${styles.row}`} data-you>
      {body}
    </Link>
  );
}
