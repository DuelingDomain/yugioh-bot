export type DuelMode = "normal" | "domain";
export type DuelStatus = "lobby" | "active" | "completed" | "interrupted" | "cancelled";
export type DuelActorRole = "player" | "spectator";
export type DuelMasterRule = 1 | 2 | 3 | 4 | 5;

export interface DuelDeck {
  main: number[];
  extra: number[];
  side: number[];
  deckMaster?: number;
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

export interface DuelEvent {
  id: number;
  kind: "summon" | "set" | "activate" | "chain-resolving" | "chain-resolved" | "chain-negated" | "chain-end" | "attack";
  seat?: number;
  card?: DuelCardInfo;
  chainIndex?: number;
  text: string;
  description?: string;
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
  metadataOnly: boolean;
  error?: string;
}

export interface DuelCommand {
  promptId: string;
  revision: number;
  answer: DuelAnswer;
}
