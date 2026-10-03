import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { MetaLine } from "@/components/meta-line/meta-line";
import { LivePill, StationTrack } from "@/components/sheet";
import { draftProgressLabel, draftStatus, plural, tournamentFormatLabel } from "./dashboard-model";

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

/** Every row on the dashboard is one you play in, so every row carries the purple edge. */
export function TournamentRow({ tournament }: { tournament: DashboardTournament }) {
  const active = tournament.status === "active";
  return (
    <Link href={`/tournament/${tournament.webSlug ?? tournament.id}`} className={"db-row"} data-you>
      <div>
        <p className="nm">{tournament.name}</p>
        <MetaLine
          className="mt"
          items={[
            { content: active ? <LivePill>In progress</LivePill> : <span className="status">Open to join</span> },
            { content: tournamentFormatLabel(tournament.format) },
            { content: active ? plural(tournament.participantCount, "player") : `${tournament.participantCount} joined` },
          ]}
        />
      </div>
      <div className="rt">
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
        <MetaLine
          className="mt"
          items={[
            { content: stage.live ? <LivePill>{stage.label}</LivePill> : <span className="status">{stage.label}</span> },
            ...(progress ? [{ content: progress }] : []),
            { content: plural(draft.playerCount, "player") },
          ]}
        />
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
    <Link href={`/draft/${draft.webSlug}`} className={"db-row"} data-you>
      {body}
    </Link>
  );
}
