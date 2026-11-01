import type { RemoteAction, RemoteActionProposal, TwinCard } from "./actions.js";
import type { AttackHints, AttackResolution } from "./attack-resolver.js";
import type { RemoteDeckChecks, RemoteDeckRegistration, RemoteFormat, RemoteReductionContext } from "./deck-checks.js";

import type { RemoteEffectTracking } from "./effect-tracking.js";

export type SeatCount = 2 | 3 | 4;
export type RemoteSeatState = { seat: number; resources: Record<string, number>; eliminated: boolean; twin: TwinCard[] };
export type RemotePosition = {
  gameId: string; seatCount: SeatCount; phase: string; turn: number; turnSeat: number;
  startedSeats: number[]; seats: RemoteSeatState[]; ended: boolean; winnerSeat: number | null;
  attack: { id: string; attackerSeat: number; attackerCardRef?: string; targetSeat: number; targetCardRef?: string; direct?: boolean } | null;
  identified: { seat: number; cardRef?: string; private?: boolean; cardId?: number; passcode?: number; zone?: string; source: "click" | "auto" | "voice" | "typed"; name?: string; notInDecklist?: boolean; addErrors: string[] } | null;
  deckChecks: RemoteDeckChecks;
  effectTracking?: RemoteEffectTracking;
};
export type RemoteState = RemotePosition & {
  updatedAt: number;
  undo: { actionId: string; at: number; before: RemotePosition } | null;
};
export interface GameModule {
  id: string;
  name: string;
  phases: readonly { id: string; name: string }[];
  seatsAllowed: readonly SeatCount[];
  resources: readonly { id: string; name: string; start: number; min: number; loseAtZero: boolean }[];
  zones: readonly { id: string; name: string; shape: "row" | "pile" | "single" }[];
  initialState(input: { seatCount: SeatCount; firstSeat?: number }): RemoteState;
  /** Pure. No clocks, I/O, randomness, or catalog/engine calls. `action.at` is the injected clock. */
  reduce(state: RemoteState, action: RemoteAction, context?: RemoteReductionContext): RemoteState;
  /** Extension point for the speech worker. Null means no proposal; never executes an action. */
  parseCommand(input: { text: string; actorSeat: number; state: RemoteState }): RemoteActionProposal | null;
  /** Pure board-based suggestions, never execution. Multiple fitting pairs require a quick pick. */
  resolveAttack(state: RemoteState, input: string | AttackHints, actorSeat: number): AttackResolution;
}
export type RemoteStatus = "lobby" | "active" | "ended";
export type RemoteSeat = { seat: number; userId: number | null; bot: boolean; displayName: string; ready: boolean; deckRegistered?: boolean; deck?: RemoteDeckRegistration | null };
export type RemoteSystemAction =
  | { type: "table.created"; gameId: string; seatCount: SeatCount; solo?: boolean; format?: RemoteFormat }
  | { type: "table.configured"; format: RemoteFormat; registrations: RemoteDeckChecks["registrations"] }
  | { type: "seat.deck"; seat: number; registration: RemoteDeckRegistration | null }
  | { type: "seat.joined"; seat: number; userId: number | null; bot?: boolean }
  | { type: "seat.left"; seat: number; userId: number }
  | { type: "seat.ready"; seat: number; ready: boolean }
  | { type: "table.started" }
  | { type: "idle.warning"; closesAt: number }
  | { type: "table.ended"; reason: "idle" | "creator-left" };
export type RemoteEvent = {
  id: string; seq: number; actorSeat: number | null; userId: number | null; at: number;
  action: RemoteAction | RemoteSystemAction;
  effects?: RemoteReductionContext;
  messages?: string[];
};
export type RemoteTable = {
  slug: string; guildId: string; gameId: string; seatCount: SeatCount; status: RemoteStatus; solo: boolean;
  createdBy: number; createdAt: number; startedAt: number | null; endedAt: number | null;
  lastEventAt: number; lastSeq: number; endReason: string | null; idleWarningAt: number | null;
  seats: RemoteSeat[];
  format?: RemoteFormat;
};
export type RemoteRoom = RemoteTable & { state: RemoteState; events: RemoteEvent[]; mySeat: number };
