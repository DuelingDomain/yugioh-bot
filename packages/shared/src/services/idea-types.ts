export const IDEA_AREAS = ["Ranked", "Duels", "Drafts", "Tournaments", "Decks & cubes", "Replays & watching", "Community", "App"] as const;
export const IDEA_DECLINE_REASONS = ["Already on the board", "It's a bug, reported for you", "Not for now"] as const;
export type IdeaArea = typeof IDEA_AREAS[number];
export type IdeaState = "waiting" | "open" | "in_progress" | "done" | "declined";
export type IdeaVoteValue = 1 | -1 | 0;
export type IdeaPromptAt = "duel" | "draft" | "tournament";
export type IdeaGateReason = "not_played_yet" | "daily_limit";
export interface Idea {
  id: number;
  title: string;
  pitch: string | null;
  area: IdeaArea;
  authorName: string | null;
  isOwn: boolean;
  showAuthor: boolean;
  team: boolean;
  state: IdeaState;
  declineReason: string | null;
  doneNote: string | null;
  shippedBeforeBoard: boolean;
  shippedWeek: string | null;
  createdAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  decidedByUserId: number | null;
  up: number;
  down: number;
  score: number;
  rank: number | null;
  viewerVote: IdeaVoteValue;
}
export interface IdeaNotice {
  id: number; ideaId: number; title: string; kind: "done" | "declined";
  note: string | null; createdAt: string;
}
export interface IdeaBoardResponse {
  inProgress: Idea[]; open: Idea[]; yourIdeas: Idea[]; notices: IdeaNotice[];
  canVote: boolean; canPost: boolean;
  voteReason: IdeaGateReason | null; postReason: IdeaGateReason | null;
}
export interface IdeaDoneWeek { week: string; ideas: Idea[] }
export interface IdeaDoneResponse { weeks: IdeaDoneWeek[] }
export interface IdeaPostInput { title: string; pitch?: string | null; area: IdeaArea; showAuthor: boolean }
export interface IdeaPostResponse { idea: Idea }
export interface IdeaVoteInput { value: IdeaVoteValue }
export interface IdeaVoteResponse { ideaId: number; up: number; down: number; score: number; rank: number; viewerVote: IdeaVoteValue }
export interface IdeaPrompt { idea: Idea; openTotal: number }
export type IdeaPromptResponse = IdeaPrompt | null;
export interface IdeaNoticesReadResponse { markedRead: number }
export interface IdeaQueueResponse {
  waiting: Idea[]; open: Idea[]; inProgress: Idea[]; recentDone: Idea[];
  counts: { waiting: number; open: number; inProgress: number; done: number };
}
export type IdeaDecisionInput =
  | { action: "approve" | "start" }
  | { action: "decline"; reason: string; line?: string }
  | { action: "done"; note?: string };
export interface IdeaDecisionResponse {
  status: "ok" | "already_decided" | "conflict"; idea: Idea; noticesSent: number;
}
