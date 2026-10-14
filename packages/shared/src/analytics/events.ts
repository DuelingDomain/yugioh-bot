import type { DuelFormat, DuelMode } from "../duels/index.js";
import type { TournamentFormat } from "../services/tournaments.js";

type EmptyProps = Record<string, never>;
type DraftProps = { mode?: "theme" | "booster"; seatCount?: number };
type DuelProps = { mode?: DuelMode; format?: DuelFormat; seatCount?: number; engine?: "legacy" | "pinned" | "multi" };
type TournamentProps = { format?: TournamentFormat; participantCount?: number };

export interface ProductEventProps {
  waitlist_joined: EmptyProps;
  account_created: EmptyProps;
  first_sign_in: EmptyProps;
  draft_created: DraftProps;
  draft_started: DraftProps;
  draft_completed: DraftProps & { durationSeconds?: number };
  duel_started: DuelProps;
  duel_finished: DuelProps & { endedBy?: "completed" | "interrupted" | "cancelled"; turnCount?: number; durationSeconds?: number };
  tournament_created: TournamentProps;
  tournament_joined: TournamentProps;
  tournament_finished: TournamentProps & { durationSeconds?: number };
  cube_created: EmptyProps;
  deck_saved: { mode?: DuelMode };
  bug_reported: EmptyProps;
  $delete_person: EmptyProps;
}

export type ProductEventName = keyof ProductEventProps;

export const propertyKeys: { [N in ProductEventName]: readonly (keyof ProductEventProps[N])[] } = {
  waitlist_joined: [], account_created: [], first_sign_in: [],
  draft_created: ["mode", "seatCount"], draft_started: ["mode", "seatCount"],
  draft_completed: ["mode", "seatCount", "durationSeconds"],
  duel_started: ["mode", "format", "seatCount", "engine"],
  duel_finished: ["mode", "format", "seatCount", "engine", "endedBy", "turnCount", "durationSeconds"],
  tournament_created: ["format", "participantCount"], tournament_joined: ["format", "participantCount"],
  tournament_finished: ["format", "participantCount", "durationSeconds"],
  cube_created: [], deck_saved: ["mode"], bug_reported: [], $delete_person: [],
};
