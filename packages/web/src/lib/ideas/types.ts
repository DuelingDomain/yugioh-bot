/** Browser-safe Ideas HTTP types. The shared service owns the response contracts. */
export type {
  Idea, IdeaArea, IdeaState, IdeaVoteValue, IdeaPromptAt, IdeaGateReason, IdeaNotice,
  IdeaBoardResponse, IdeaDoneWeek, IdeaDoneResponse, IdeaPostInput, IdeaPostResponse,
  IdeaVoteInput, IdeaVoteResponse, IdeaPrompt, IdeaPromptResponse, IdeaNoticesReadResponse,
  IdeaQueueResponse, IdeaDecisionInput, IdeaDecisionResponse,
} from "@yugidraft/shared/services";

import type { IdeaDecisionResponse } from "@yugidraft/shared/services";

export type IdeaApiErrorCode =
  | "unauthorized" | "session_unavailable" | "not_configured" | "not_found"
  | "invalid_origin" | "invalid_id" | "invalid_body" | "invalid_at"
  | "not_played_yet" | "daily_limit" | "own_idea" | "not_open"
  | "already_decided" | "conflict";
export interface IdeaApiError { error: IdeaApiErrorCode | "Something went wrong" }
/** Owner decisions return the current idea as well as the safe error code on HTTP 409. */
export type IdeaDecisionConflictResponse = IdeaDecisionResponse & { error: "already_decided" | "conflict" };
