import type { RemoteAction, RemoteActionProposal, TwinCard } from "./actions.js";
import type { AttackHints, AttackResolution } from "./attack-resolver.js";
import type { RemoteDeckChecks, RemoteDeckRegistration, RemoteFormat, RemoteReductionContext } from "./deck-checks.js";

import type { RemoteEffectTracking } from "./effect-tracking.js";
import type { RemoteBestOf, RemoteMatch } from "./match-contract.js";

export type SeatCount = 2 | 3 | 4;
export type RemoteRevealedHand = 'until-played' | 'one-turn';
export type RemoteVisibility = 'public' | 'private';
export type RemoteKnownHandCard = {
  id: string; cardId: number; source: 'deck' | 'gy' | 'banish' | 'extra' | 'field' | 'unknown';
  by?: {cardId: number; name: string}; at: number; revealed: true;
  /** An explicit owner reveal can publish a Deck addition even when automatic Deck publicity is off. */
  publicIdentity?: true;
};
export type RemoteSeatState = {
  knownHand?: RemoteKnownHandCard[];
  /** Public count. Absent until a movement or an owner correction sets it. */
  handCount?: number;
  /** Private count; only the owner receives it. */
  deckCount?: number;
  seat: number; resources: Record<string, number>; eliminated: boolean; twin: TwinCard[];
};
export type RemoteTwinConfirmation = {
  seat:number;cardRef:string;existingRefs:string[];message:string;anotherCopyAllowed:boolean;
  options?:{ref?:string;label:string}[];placement?:Extract<RemoteAction,{type:"twin.place"}>;
};
export type RemotePosition = {
  /** Fixed at table creation. Legacy and casual tables omit this flag. */
  tournament?: boolean;
  match: RemoteMatch;
  gameId: string; seatCount: SeatCount; phase: string; turn: number; turnSeat: number;
  /** Same-turn phase corrections preserve this; Undo restores it. Absent in legacy snapshots. */
  battleEntered?: boolean;
  /** The automatic draw of this turn. A voice "draw" in the Draw Phase uses it once, so a draw is not counted twice. */
  turnDraw?: { turn: number; seat: number; used?: boolean };
  startedSeats: number[]; seats: RemoteSeatState[]; ended: boolean; winnerSeat: number | null;
  attack: { id: string; attackerSeat: number; attackerCardRef?: string; targetSeat: number; targetCardRef?: string; direct?: boolean } | null;
  identified: { seat: number; cardRef?: string; private?: boolean; cardId?: number; passcode?: number; zone?: string; source: "click" | "auto" | "voice" | "typed"; name?: string; notInDecklist?: boolean; addErrors: string[] } | null;
  deckChecks: RemoteDeckChecks;
  effectTracking?: RemoteEffectTracking;
  /** Older JSON snapshots omit this default-on table rule. */
  showCardsSetFromDeck?: boolean;
  revealedHand?: RemoteRevealedHand;
  /** Pending physical origin choice. No pile is changed until the owner answers. */
  twinConfirmation?: RemoteTwinConfirmation;
  twinConfirmationQueue?: RemoteTwinConfirmation[];
};
export type RemoteUndoEntry = {
  actionId: string; actorSeat: number; at: number; turn: number; order: number; action: RemoteAction; cards: string[];
  /** Server-only snapshots and dependency tracking; omitted from client history. */
  before?: RemotePosition; after?: RemotePosition; blockedBy?: string[]; blocked?: boolean;
  undone?: boolean; reason?: string;
};
export type RemoteState = RemotePosition & {
  updatedAt: number;
  undoHistory?: RemoteUndoEntry[];
  undo: { actionId: string; at: number; before: RemotePosition } | null;
};
export interface GameModule {
  id: string;
  name: string;
  phases: readonly { id: string; name: string }[];
  seatsAllowed: readonly SeatCount[];
  resources: readonly { id: string; name: string; start: number; min: number; loseAtZero: boolean }[];
  zones: readonly { id: string; name: string; shape: "row" | "pile" | "single" }[];
  initialState(input: { seatCount: SeatCount; firstSeat?: number; bestOf?: RemoteBestOf; tournament?: boolean }): RemoteState;
  /** Pure. No clocks, I/O, randomness, or catalog/engine calls. `action.at` is the injected clock. */
  reduce(state: RemoteState, action: RemoteAction, context?: RemoteReductionContext): RemoteState;
  /** Null means no proposal. An empty effect source asks the UI which card; it must not be submitted. */
  parseCommand(input: {
    text: string; actorSeat: number; state: RemoteState;
    /** Inject the current clock so an idle table cannot keep a recent card alive indefinitely. */
    now?: number;
    /** Already loaded catalog facts; parsing performs no I/O. */
    lookupCard?: (code: number) => { name: string; type?: string } | undefined;
  }): RemoteActionProposal | null;
  /** Pure board-based suggestions, never execution. Multiple fitting pairs require a quick pick. */
  resolveAttack(state: RemoteState, input: string | AttackHints, actorSeat: number): AttackResolution;
}
export type RemoteStatus = "lobby" | "active" | "ended";
export type RemoteSeat = { seat: number; userId: number | null; bot: boolean; displayName: string; ready: boolean; deckRegistered?: boolean; deck?: RemoteDeckRegistration | null };
export type RemoteSystemAction =
  | { type: "table.created"; gameId: string; seatCount: SeatCount; tournament?: boolean; bestOf?: RemoteBestOf; solo?: boolean; format?: RemoteFormat; showCardsSetFromDeck?: boolean; revealedHand?: RemoteRevealedHand }
  | { type: "table.configured"; format: RemoteFormat; bestOf?: RemoteBestOf; registrations: RemoteDeckChecks["registrations"]; showCardsSetFromDeck?: boolean; revealedHand?: RemoteRevealedHand }
  | { type: "seat.deck"; seat: number; registration: RemoteDeckRegistration | null }
  | { type: "seat.joined"; seat: number; userId: number | null; bot?: boolean }
  | { type: "seat.left"; seat: number; userId: number }
  | { type: "seat.ready"; seat: number; ready: boolean }
  | { type: "table.started"; handCounts?: 1 }
  | { type: "idle.warning"; closesAt: number }
  | { type: "table.ended"; reason: "idle" | "creator-left" };
export type RemoteEvent = {
  id: string; seq: number; actorSeat: number | null; userId: number | null; at: number;
  action: RemoteAction | RemoteSystemAction;
  effects?: RemoteReductionContext;
  messages?: string[];
};
export type RemoteTable = {
  tournamentMatchId?: number;
  /** Tournament default overrides the device preference; U4 applies it per table. */
  detectionDefault?: "auto";
  bestOf?: RemoteBestOf;
  slug: string; guildId: string; gameId: string; seatCount: SeatCount; status: RemoteStatus; solo: boolean;
  createdBy: number; createdAt: number; startedAt: number | null; endedAt: number | null;
  lastEventAt: number; lastSeq: number; endReason: string | null; idleWarningAt: number | null;
  seats: RemoteSeat[];
  format?: RemoteFormat;
  showCardsSetFromDeck?: boolean;
  revealedHand?: RemoteRevealedHand;
  /** Same words as normal duels. Public tables can be watched; private tables take no spectators. */
  visibility?: RemoteVisibility;
};
/** `isDeveloper` is decided on the server (owner list); the browser only reads it to show developer tools. */
export type RemoteRoom = RemoteTable & { state: RemoteState; events: RemoteEvent[]; mySeat: number; isDeveloper?: boolean;
  /** This viewer watches: mySeat is -1 and state/events are the spectator projection. */ spectator?: boolean;
  /** People who watch now. */ spectatorCount?: number };
