import type Database from "better-sqlite3";
import * as sharedServices from "@yugidraft/shared/services";
import type {
  DraftAutoStartRequest, DraftLobbyResponse, DraftLobbyTickResult, DraftStartRequest,
} from "@yugidraft/shared/types";

/** Browser boundary. Keep T03 signature adaptation confined to this file. */
export interface BrowserDraftLobbyService {
  read(draftId: number, viewerUserId: string): DraftLobbyResponse;
  setReady(draftId: number, userId: string, ready: boolean): DraftLobbyResponse;
  leave(draftId: number, userId: string): DraftLobbyResponse;
  removePlayer(draftId: number, userId: string, playerId: number): DraftLobbyResponse;
  scheduleStart(draftId: number, userId: string, input: DraftStartRequest): DraftLobbyResponse;
  stopStart(draftId: number, userId: string, token: string): DraftLobbyResponse;
  setAutoStart(draftId: number, userId: string, input: DraftAutoStartRequest): DraftLobbyResponse;
  invalidate(draftId: number, options?: { clearReady?: boolean; playerIds?: readonly number[] }): void;
  /** Optional draftId confines the browser recovery sweep to one authorized slug. */
  tick(now: number, draftId?: number): DraftLobbyTickResult;
}

export function createDraftLobbyApi(db: Database.Database): BrowserDraftLobbyService {
  // T01 is available before T03. Do not substitute a browser state machine when
  // the shared service is absent. The coordinator must verify this boundary
  // against T03 before runtime rollout (including scoped tick support).
  const factory = (sharedServices as unknown as {
    createDraftLobbyService?: (database: Database.Database) => Omit<BrowserDraftLobbyService, "tick"> & {
      tick(now: Date, draftId?: number): DraftLobbyTickResult;
    };
  }).createDraftLobbyService;
  if (!factory) throw new Error("Draft lobby service is unavailable; T03 integration is required");
  const service = factory(db);
  return { ...service, tick: (now, draftId) => service.tick(new Date(now), draftId) };
}
