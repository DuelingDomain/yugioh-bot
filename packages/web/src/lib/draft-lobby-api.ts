import type Database from "better-sqlite3";
import { createDraftLobbyService, type DraftLobbyService } from "@yugidraft/shared/services";
import type { DraftLobbyTickResult } from "@yugidraft/shared/types";

/** Preserve the shared contract, adapting the browser's millisecond tick clock. */
export type BrowserDraftLobbyService = Omit<DraftLobbyService, "tick"> & {
  /** Optional draftId confines the browser recovery sweep to one authorized slug. */
  tick(now: number, draftId?: number): DraftLobbyTickResult;
};

export function createDraftLobbyApi(db: Database.Database): BrowserDraftLobbyService {
  const service = createDraftLobbyService(db);
  return { ...service, tick: (now, draftId) => service.tick(new Date(now), draftId) };
}
