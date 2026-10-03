import { FloorRow, LiveDot, svButtonClass } from "@/components/sheet";
import { TournamentRow as TournamentFloorRow } from "@/components/tournament/tournament-row";
import { draftProgressLabel, draftStatus, plural } from "./dashboard-model";
import type { TournamentRounds } from "./tournament-rounds";
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

/** Every row on the dashboard is one you play in, so every row carries the "you" underlay. */
export function TournamentRow({
  tournament,
  rounds,
  viewerId,
}: {
  tournament: DashboardTournament;
  rounds?: TournamentRounds;
  viewerId?: number | null;
}) {
  return (
    <TournamentFloorRow
      tournament={tournament}
      variant={tournament.status === "active" ? "running" : "open"}
      rounds={rounds}
      viewerId={viewerId}
      you
    />
  );
}

export function DraftRow({ draft }: { draft: DashboardDraft }) {
  const stage = draftStatus(draft.status);
  const progress = draftProgressLabel(draft.status, draft.currentPackRound, draft.currentPickStep);
  const body = (
    <>
      <div className={styles.draftId}>
        <p className={styles.draftName}>{draft.name}</p>
        <p className={styles.draftMeta}>
          {stage.live ? <LiveDot you label={stage.label} /> : <span>{stage.label}</span>}
          {progress && <span>{progress}</span>}
          <span>{plural(draft.playerCount, "player")}</span>
        </p>
      </div>
      {stage.live && <span className={`${svButtonClass("ghost")} ${styles.draftGo}`}>Back to draft</span>}
    </>
  );
  const cols = "minmax(0, 1fr) auto";
  return draft.webSlug ? (
    <FloorRow you href={`/draft/${draft.webSlug}`} cols={cols} phoneCols={cols}>
      {body}
    </FloorRow>
  ) : (
    <FloorRow you cols={cols} phoneCols={cols}>
      {body}
    </FloorRow>
  );
}
