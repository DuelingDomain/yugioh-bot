/**
 * Classify a stall from a host `debug-trace` JSON (op `debug-trace`, DUEL_SCENARIOS=1) and, when known, the state of the page.
 * Pure function. Classes:
 *   transport  the server revision is higher than the revision the page shows
 *   ui         the server view has an open prompt for a seat, the page does not show it (same revision)
 *   bot        a bot seat holds the open prompt and has not answered
 *   core       an answer was given and no seat has a prompt after it (the core did not return one)
 *   none       a human seat holds the prompt and the page shows it: the duel waits for a person
 *   unknown    the data is too short to tell
 */
export interface DebugTrace {
  revision: number;
  wasmSha?: string | null;
  seats?: Array<{ seat: number; prompt?: unknown }>;
  worker?: { busy?: boolean; lastOp?: string | null; lastOpAt?: number | null; callsSinceLastPrompt?: number; messagesSinceLastPrompt?: number };
  bot?: { seats?: Array<{ seat: number; policy?: string | null; lastTrace?: unknown }> };
}

export interface PageState {
  revision: number;
  promptVisible: boolean;
}

export type StallClass = "core" | "bot" | "ui" | "transport" | "none" | "unknown";

export interface StallVerdict {
  class: StallClass;
  /** One sentence for a human. */
  reason: string;
  /** The seat that holds the open prompt, when there is one. */
  seat?: number;
}

/** A policy that answers without a person. Anything else with a name counts as a bot too, except these. */
const HUMAN_POLICIES = new Set(["human", "none", "manual", ""]);

export function isBotPolicy(policy: string | null | undefined): boolean {
  if (policy == null) return false;
  return !HUMAN_POLICIES.has(policy.toLowerCase());
}

export function classifyStall(trace: DebugTrace, page?: PageState): StallVerdict {
  if (!trace || typeof trace.revision !== "number") return { class: "unknown", reason: "The trace has no revision." };
  if (page && trace.revision > page.revision) {
    return { class: "transport", reason: `The server is at revision ${trace.revision}, the page shows ${page.revision}. A frame did not reach the page.` };
  }
  const holders = (trace.seats ?? []).filter((entry) => entry.prompt != null);
  const holder = holders[0];
  if (holder) {
    const policy = trace.bot?.seats?.find((entry) => entry.seat === holder.seat)?.policy;
    if (isBotPolicy(policy)) {
      return { class: "bot", seat: holder.seat, reason: `Seat ${holder.seat} is a bot (${policy}) and holds the open prompt at revision ${trace.revision}.` };
    }
    if (page && !page.promptVisible) {
      return { class: "ui", seat: holder.seat, reason: `The view of seat ${holder.seat} has an open prompt at revision ${trace.revision}. The page does not show it.` };
    }
    if (page) return { class: "none", seat: holder.seat, reason: `Seat ${holder.seat} is a person with a visible prompt. The duel waits for them.` };
    return { class: "unknown", seat: holder.seat, reason: `Seat ${holder.seat} holds the open prompt and is not a bot. Give the page state to tell UI from a person who waits.` };
  }
  const worker = trace.worker;
  if (!worker) return { class: "unknown", reason: "No seat has a prompt and the trace has no worker state." };
  const calls = worker.callsSinceLastPrompt ?? 0;
  const messages = worker.messagesSinceLastPrompt ?? 0;
  if (worker.busy || calls > 0 || messages > 0) {
    return {
      class: "core",
      reason: `No seat has a prompt. The worker ${worker.busy ? "is busy" : "is idle"} after ${calls} call(s) and ${messages} message(s) since the last prompt (last op ${worker.lastOp ?? "none"}). The core gave no prompt after the answer.`,
    };
  }
  return { class: "unknown", reason: "No seat has a prompt and the worker shows no activity since the last prompt. The duel may have ended." };
}

/** True when a parsed JSON has the shape of a host `debug-trace` (revision, seats, worker). */
export function isDebugTrace(value: unknown): value is DebugTrace {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.revision === "number" && Array.isArray(v.seats) && typeof v.worker === "object" && v.worker !== null;
}
