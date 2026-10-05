export interface DraftConfig {
  setNames?: string[];
  customCardIds?: number[];
  includeNames?: string[];
  excludeNames?: string[];
  packSize?: number;
  packsPerPlayer?: number;
  cardsPerPlayer?: number;
  pickSeconds?: number;
  alternatePassDirection?: boolean;
  randomizeSeats?: boolean;
  /** Limit picks to three copies, with booster swaps or forced picks when needed. Default true. */
  copyLimit?: boolean;
  /** Internal: saved cubes keep authored quantities, including their catalog selections. */
  preservePoolCopies?: boolean;
  cubeCardIds?: number[];
  /** @deprecated legacy key, still read for drafts created before the rename */
  poolCardIds?: number[];
  /** The saved cube a cube draft's pool started from (display and Reset only; the pool itself is customCardIds). */
  poolSource?: { cubeId: number; cubeName: string };

  // ----- theme mode -----
  /** Draft mode. Absent or "booster" => existing behavior. */
  mode?: "booster" | "theme";
  /** Cube ids the host allows for this draft (the "X" pool). */
  allowedCubeIds?: number[];
  /** How each player's theme is chosen. Default "player_pick". */
  themeSelection?: "host_assigned" | "random" | "player_pick";
  /** Optional explicit player -> theme map for host_assigned. */
  themeAssignments?: Record<string, number>;
  /** If true (default), every player gets a distinct cube, capping players at allowedCubeIds.length. */
  uniqueThemes?: boolean;
  /** Number of choices shown per pick. Admin-set; default 3, any X >= 2. */
  themePackSize?: number;
  /** Whether to run the Extra Deck draft phase at all. Default true. */
  extraDeckEnabled?: boolean;
  /** Extra Deck cards to draft in phase 2 (ignored when extraDeckEnabled is false). Default 15. */
  extraDeckSize?: number;
  /** If true, the (themePackSize - 1) unpicked cards are discarded each round; if false (default) they return. */
  burnUnpicked?: boolean;

  // ----- cube metadata (kept in a saved cube's config; a draft ignores it) -----
  /** What a cube is for: theme drafts, cube (booster) drafts, or either. Absent means "any". */
  draftType?: "theme" | "booster" | "any";
}

export interface Draft {
  id: number;
  guildId: string;
  channelId: string;
  name: string;
  status: "pending" | "active" | "cancelled" | "completed";
  createdByUserId: string;
  config: DraftConfig;
  currentPackRound: number;
  currentPickStep: number;
  pickDeadlineAt: string | null;
  statusMessageId: string | null;
  webSlug?: string;
  tournamentId?: number | null;
  completeMessageId?: string | null;
}

export interface DraftPlayer {
  playerId: number;
  displayName: string;
  seatIndex?: number;
}

export interface DraftCard {
  id: number;
  draftId: number;
  waveNumber: number;
  catalogCardId: number;
  pickedByPlayerId: number | null;
  /** This booster pack has no legal copy and no legal undealt replacement. */
  forced?: boolean;
}

export interface DraftPack {
  id: number;
  draftId: number;
  packRound: number;
  originSeatIndex: number;
  currentHolderSeatIndex: number;
  passDirection: number;
}

export interface DraftPick {
  id: number;
  draftId: number;
  playerId: number;
  draftCardId: number;
  waveNumber: number;
  pickStep: number;
  pickMethod?: "manual" | "auto";
  /** A capped booster pick with no legal replacement; adds one draft deck copy. */
  forced?: boolean;
  pickedAt: string;
}

export interface Tournament {
  id: number;
  guildId: string;
  name: string;
  format: "round_robin" | "single_elim";
  status: "pending" | "active" | "cancelled" | "completed";
  createdByUserId: string;
  webSlug?: string;
  deadlineAt?: string; // ISO timestamp; undefined = no deadline
  reportConfirmWindowHours?: number; // undefined = use DEFAULT_REPORT_CONFIRM_HOURS
}

export interface TournamentPlayer {
  playerId: number;
  displayName: string;
}

export interface TournamentMatch {
  id: number;
  tournamentId: number;
  matchId: number | null;
  playerOneId: number;
  playerTwoId: number | null;
  roundNumber: number;
  status: "open" | "pending_approval" | "completed";
  metadata: Record<string, unknown>;
}

export interface Card {
  ygoprodeckId: number;
  canonicalCardId?: number;
  name: string;
  type: string;
  frameType: string;
  effectText: string;
  atk?: number;
  def?: number;
  attribute?: string;
  level?: number;
  imageUrl: string;
  imageUrlSmall: string;
  imageUrlCropped?: string;
  cardSets: Array<{ set_name: string }>;
  cachedAt: string;
  archetype?: string;
}

export type CubePool = "main" | "extra";

export interface CubeCard {
  catalogCardId: number;
  pool: CubePool;
  maxCopies: number;
  source?: string;
}

export interface CubePools {
  main: CubeCard[];
  extra: CubeCard[];
}

export interface Cube {
  id: number;
  guildId: string;
  name: string;
  archetype: string | null;
  banlist: string | null;
  /** Pack/mode defaults + set/passcode pool sources (bot templates & set draws). */
  config: DraftConfig;
  createdByUserId: string;
}
