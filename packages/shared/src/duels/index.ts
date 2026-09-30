import type { DuelClock, DuelSettings } from "./settings.js";

export type DuelMode = "normal" | "domain";
export type DuelStatus = "lobby" | "active" | "completed" | "interrupted" | "cancelled";
export type DuelActorRole = "player" | "spectator";
export type DuelMasterRule = 1 | 2 | 3 | 4 | 5;

export type {
  DuelCardPool,
  DuelClock,
  DuelClockState,
  DuelSettings,
  DuelTimeout,
  DuelVisibility,
} from "./settings.js";
export {
  DUEL_CLOCK_INCREMENT_MS,
  DUEL_CLOCK_REGAIN_FRACTION,
  DUEL_CLOCK_REGAIN_MIN_MS,
  defaultDuelSettings,
  duelClockBankMs,
  duelClockRegainMs,
  duelClockRulesText,
  isCustomDomain,
  legacyDuelSettings,
  normalizeDuelSettings,
  NO_BANLIST_ID,
  PINNED_TCG_BANLIST_ID,
} from "./settings.js";
export type { DuelBanlistOption } from "./banlist-options.js";
export { DUEL_BANLIST_OPTIONS } from "./banlist-options.js";

export interface DuelDeck {
  main: number[];
  extra: number[];
  side: number[];
  deckMaster?: number;
}

export interface DuelDeckCardRef {
  section: "main" | "extra" | "side" | "deckMaster";
  index: number;
  code: number;
  name?: string;
}

export interface DuelDeckIssue {
  message: string;
  cards: DuelDeckCardRef[];
}

export interface DuelDeckValidation {
  issues: DuelDeckIssue[];
}

export interface DuelCardInfo {
  code: number;
  name: string;
  description: string;
  type: number;
  attack: number;
  defense: number;
  level: number;
  attribute: number;
  race: string;
}

/** Hidden cards omit identity and stats; never serialize raw core queries. */
export interface DuelCard {
  controller: number;
  location: number;
  sequence: number;
  position: number;
  code?: number;
  name?: string;
  description?: string;
  attack?: number;
  defense?: number;
  level?: number;
  type?: number;
  attribute?: number;
  race?: string;
  rank?: number;
  linkRating?: number;
  linkMarker?: number;
  counters?: Array<{ type: number; count: number }>;
  materials?: DuelCard[];
}

export interface DuelPromptOption {
  id: string;
  label: string;
  card?: DuelCardInfo;
  controller?: number;
  location?: number;
  sequence?: number;
  values?: number[];
  max?: number;
  selected?: boolean;
  /** Full printed text of the card this option is bound to (absent when the card is hidden from the viewer). */
  cardText?: string;
  /**
   * The specific effect this option activates or applies, resolved from the card's strings
   * (no printf placeholders). Often a short label such as "Take control"; show `cardText` for the
   * accurate wording, including costs.
   */
  effectText?: string;
}

/** The card whose effect a prompt is about. `text` is its full printed text. */
export interface DuelPromptSource {
  code: number;
  name: string;
  /**
   * Seat that controls the card. When the engine gave no location (a card hint before a yes/no or
   * option prompt) this is the answering seat, which is the effect's controller in practice.
   */
  seat: number;
  /** Where the card is; absent when the engine only hinted the card code. */
  zone?: DuelZoneRef;
  text: string;
}

export type DuelPromptContext =
  | { type: "action"; phase: "main" | "battle" }
  | { type: "chain"; forced: boolean }
  | { type: "position" }
  | { type: "deck-master-recall"; card: DuelCardInfo; returns: number; nextCost: number };

export interface DuelPrompt {
  id: string;
  seat: number;
  kind: "choice" | "cards" | "tribute" | "places" | "order" | "counters" | "number" | "announce-card" | "sum" | "toggle";
  title: string;
  description?: string;
  options: DuelPromptOption[];
  min?: number;
  max?: number;
  target?: number;
  mandatory?: string[];
  cancelable?: boolean;
  finishable?: boolean;
  context?: DuelPromptContext;
  /**
   * Present for prompts tied to one card: yes/no effect prompts, trigger prompts, option prompts
   * from an effect, and selections made while that card's effect resolves. Never names a card
   * the answering seat cannot see.
   */
  source?: DuelPromptSource;
}

export interface DuelAnswer {
  choice?: string;
  selected?: string[];
  counts?: Record<string, number>;
  value?: number;
  cardCode?: number;
  cancel?: boolean;
  finish?: boolean;
}

export interface DuelSeatView {
  seat: number;
  lp: number;
  hand: DuelCard[];
  deckCount: number;
  extraCount: number;
  extra: DuelCard[];
  monsters: Array<DuelCard | null>;
  spells: Array<DuelCard | null>;
  graveyard: DuelCard[];
  banished: DuelCard[];
  deckMaster?: { card: DuelCardInfo; inZone: boolean; returns: number; nextCost: number };
}

/** A board position, in the same terms as DuelCard (controller, location bitmask, sequence). */
export interface DuelZoneRef {
  controller: number;
  location: number;
  sequence: number;
}

export type DuelMoveReason =
  | "summon" | "set" | "activate" | "destroy" | "send" | "return" | "banish" | "draw" | "discard" | "other";

/**
 * How a monster arrived on the field. "tribute" is a Normal Summon that used Tributes. The Extra
 * Deck kinds ("fusion", "synchro", "xyz", "link") are Special Summons of a monster of that type
 * from the Extra Deck (or the Domain Deck Master Zone); "ritual" is a Ritual Monster Special
 * Summoned from the hand; "pendulum" is a Pendulum Summon started from a Pendulum Zone card.
 * Everything else is "special".
 */
export type DuelSummonKind =
  | "normal" | "tribute" | "special" | "flip"
  | "fusion" | "synchro" | "xyz" | "link" | "ritual" | "pendulum";

/**
 * Where the Battle Phase is. "start" = Start Step, "battle" = Battle Step (attacks are declared
 * here), "damage" = Damage Step (before or after damage calculation), "damage-calculation" =
 * damage calculation inside the Damage Step, "end" = End Step. null outside the Battle Phase.
 */
export type DuelBattleStep = "start" | "battle" | "damage" | "damage-calculation" | "end";

export interface DuelEvent {
  id: number;
  kind:
    | "summon" | "set" | "activate" | "chain-resolving" | "chain-resolved" | "chain-negated" | "chain-end"
    | "attack" | "phase" | "damage" | "destroy" | "move" | "position";
  seat?: number;
  card?: DuelCardInfo;
  chainIndex?: number;
  text: string;
  description?: string;
  /**
   * summon / set / activate: the zone the card is in.
   * attack: the attacking monster's zone.
   * destroy: the zone the card left.
   * move: the destination zone (the card's controller after the move is `seat`).
   */
  zone?: DuelZoneRef;
  /** move: the zone the card left. Board positions are public even when the card is hidden. */
  from?: DuelZoneRef;
  /**
   * move: best-effort cause of the move, derived from the engine messages around it.
   * `card` on a move event is present only when the card is public at the source or destination
   * for the viewer, or the viewer controls the hand/deck it moved from or to.
   */
  reason?: DuelMoveReason;
  /** move: the card arrived face-down (Set, or banished/returned face-down). */
  faceDown?: boolean;
  /** attack: the attacked monster's zone; absent for a direct attack. */
  target?: DuelZoneRef;
  /** damage: LP lost by `seat` (positive number). */
  amount?: number;
  /**
   * damage: "battle" for battle damage, "effect" for effect damage, "cost" for paid LP.
   * destroy / move (reason "destroy"): why the card was destroyed. "battle" = lost a battle,
   * "effect" = a card effect (see sourceCode), "rule" = a game rule, "cost" = paid as a cost,
   * "other" = anything else. Absent on events recorded before this field existed.
   */
  cause?: "battle" | "effect" | "cost" | "rule" | "other";
  /** destroy / move: passcode of the card that caused the destruction (the effect's card, or the opposing battler). */
  sourceCode?: number;
  /** destroy / move: card type of the source when it activated (monster, spell or trap). */
  sourceKind?: "monster" | "spell" | "trap";
  /** destroy / move: seat that controlled the reason (the player the destruction is attributed to). */
  sourceSeat?: number;
  /** summon: how the monster arrived. */
  summonKind?: DuelSummonKind;
  /**
   * position: the battle position the card left and the one it is in now (POS_* bitmasks:
   * 0x1 face-up Attack, 0x2 face-down Attack, 0x4 face-up Defense, 0x8 face-down Defense).
   * `zone` is the card's zone; `card` follows the move-event rule (present when the card is
   * face-up before or after the change, or the viewer controls it).
   */
  fromPosition?: number;
  toPosition?: number;
  /** position: the card turned face-up (a flip reveal). */
  flip?: true;
}

export interface DuelChainLink {
  index: number;
  seat: number;
  code?: number;
  name?: string;
  description?: string;
}

export interface DuelEngineView {
  revision: number;
  turn: number;
  turnSeat: number;
  phase: string;
  /** The current Battle Phase step; null outside the Battle Phase. Best effort from core messages. */
  battleStep?: DuelBattleStep | null;
  seats: DuelSeatView[];
  prompt: DuelPrompt | null;
  chain: DuelChainLink[];
  events: DuelEvent[];
  log: Array<{ id: number; text: string }>;
  result: { winnerSeat: number | null; reason: string } | null;
}

export interface DuelSeat {
  seat: number;
  playerId: number | null;
  displayName: string;
  ready: boolean;
  isBot: boolean;
  deckMaster?: number;
}

export interface DuelSession {
  id: number;
  slug: string;
  name: string;
  guildId: string;
  organizerPlayerId: number;
  mode: DuelMode;
  masterRule: DuelMasterRule;
  status: DuelStatus;
  settings: DuelSettings;
  seats: DuelSeat[];
  createdAt: string;
  endedAt: string | null;
  archivedAt: string | null;
  winnerPlayerId: number | null;
  winnerSeat: number | null;
  resultReason: string | null;
}

export interface DuelRoom {
  session: DuelSession;
  role: DuelActorRole;
  mySeat: number | null;
  myDeck: DuelDeck | null;
  engine: DuelEngineView | null;
  clock: DuelClock | null;
  metadataOnly: boolean;
  error?: string;
  inviteCode?: string;
}

/** A table row in the lobby list or match history, as seen by one viewer. */
export interface DuelListItem extends DuelSession {
  /** The viewer's seat, or null when the viewer is not seated. */
  mySeat: number | null;
  /** Last start or accepted input; falls back to creation time. */
  lastActivityAt: string;
}

/** `mine` lists only duels the viewer played; `all` lists every duel the viewer may open. */
export type DuelHistoryScope = "mine" | "all";

export interface DuelReplayFrame {
  /** 0 is the opening board; n is the board after the nth accepted input. */
  step: number;
  /** Seat whose accepted input produced this frame; null for the opening and saved final frames. */
  actorSeat: number | null;
  /**
   * Board for the viewer's role, with `prompt` always null. `log` and `events`
   * hold only entries new since the previous frame; clients concatenate them.
   */
  view: DuelEngineView;
}

export interface DuelReplay {
  session: DuelSession;
  role: DuelActorRole;
  mySeat: number | null;
  frames: DuelReplayFrame[];
}

export interface DuelCommand {
  promptId: string;
  revision: number;
  answer: DuelAnswer;
}
