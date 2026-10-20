import { workerResponseError } from "./worker-error.js";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import type { JournalTargetViews } from "./journal-runner.js";
import { buildReplayData, type ReplayBuildData, type ReplayBuildOptions } from "./replay-builder.js";
import type { DuelGameWorker } from "./worker-client.js";
import type { DuelWorkerRequest, DuelWorkerResponse } from "./worker-protocol.js";

export { ReplayBuildError } from "./replay-builder.js";

/** Only data crosses the worker boundary. Verification and authorization remain in the host. */
export type ReplayWorkerOptions = Omit<ReplayBuildOptions,
  "codec" | "createWorker" | "signal" | "encodeView" | "verifyFinalViews">;
export interface ReplayWorkerResult {
  data: ReplayBuildData;
  /** Internal only: the host compares every final projection before caching or serving frames. */
  finalViews: JournalTargetViews;
}

/** Run the existing runner and builder next to the engine, without per-command structured clones.
 * This adapter owns no thread: close destroys the game; the caller terminates the detached worker.
 */
export async function runReplayInWorker(options: ReplayWorkerOptions,
  dispatch: (request: DuelWorkerRequest) => Promise<DuelWorkerResponse>): Promise<ReplayWorkerResult> {
  let running = true;
  const request = async <T>(command: object): Promise<T> => {
    const response = await dispatch({ ...command, id: 0 } as DuelWorkerRequest);
    if (!response.ok) throw workerResponseError(response);
    return response.value as T;
  };
  const local: DuelGameWorker = {
    get running() { return running; },
    create: options => request({ op: "create", options }),
    view: (seat, history) => request<DuelEngineView>({ op: "view", seat, history }),
    answer: (seat, promptId, answer) => request({ op: "answer", seat, promptId, answer }),
    search: (query, seat) => request({ op: "search", query, seat }),
    eliminate: (seat, reason, atTurnEnd) => request({ op: "eliminate", seat, reason, atTurnEnd }),
    setChainMode: (seat, mode) => request({ op: "chain-mode", seat, mode }),
    close: async () => { running = false; await request({ op: "close" }); },
  };
  let finalViews: JournalTargetViews | undefined;
  const data = await buildReplayData({ ...options, createWorker: () => local,
    verifyFinalViews: views => { finalViews = views; },
    encodeView: async view => {
      const json = JSON.stringify(view);
      return { json, bytes: Buffer.byteLength(json) };
    },
  });
  return { data, finalViews: finalViews! };
}
