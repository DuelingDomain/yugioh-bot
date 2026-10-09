export interface DraftConfig {
  /** Integer seat target, 2–8. New web drafts default 4; absence stays legacy/unbounded/manual-only. */
  lobbySeats?: number;
  setNames?: string[];
  customCardIds?: number[];
  /** Normal draft Extra pool: one ID per copy. An explicit [] overrides the source cube. */
  customExtraCardIds?: number[];
  includeNames?: string[];
  excludeNames?: string[];
  packSize?: number;
  packsPerPlayer?: number;
  cardsPerPlayer?: number;
  /** Optional Main Deck draft target, integer 20–60. Overrides legacy main totals and booster round count. */
  mainPicksPerPlayer?: number;
  pickSeconds?: number;
  /** Normal drafts: sequential timed picks from each pack before passing; 1 (default) or 2. */
  picksPerStep?: number;
  alternatePassDirection?: boolean;
  randomizeSeats?: boolean;
  /** Limit picks to three copies, with booster swaps or forced picks when needed. Default true. */
  copyLimit?: boolean;
  /** Internal: saved cubes keep authored quantities, including their catalog selections. */
  preservePoolCopies?: boolean;
  cubeCardIds?: number[];
  /** @deprecated legacy key, still read for drafts created before the rename */
  poolCardIds?: number[];
  /** Source cube for display/reset and the normal Extra pool when customExtraCardIds is absent. */
  poolSource?: { cubeId: number; cubeName: string };

  /** Run an Extra Deck phase. Normal drafts default false; theme drafts default true. */
  extraDeckEnabled?: boolean;
  /** Extra cards per player (default 15). Normal drafts: integer 0–15, one extra pack per seat. */
  extraDeckSize?: number;

  // ----- theme mode -----
  /** Draft mode. Absent or "booster" => existing behavior. */
  mode?: "booster" | "theme";
  /** Cube ids the host allows for this draft (the "X" pool). */
  allowedCubeIds?: number[];
  /** How each player's theme is chosen. Default "player_pick". */
  themeSelection?: "host_assigned" | "random" | "player_pick";
  /** Complete player-ID -> cube-ID map for host_assigned; filtered from non-host views. */
  themeAssignments?: Record<string, number>;
  /** If true (default), every player gets a distinct cube, capping players at allowedCubeIds.length. */
  uniqueThemes?: boolean;
  /** Number of choices shown per pick. Admin-set; default 3, any X >= 2. */
  themePackSize?: number;
  /** Theme choices and leftovers at a booster Main cap: true discards unpicked cards; false returns them. */
  burnUnpicked?: boolean;

  // ----- cube metadata (kept in a saved cube's config; a draft ignores it) -----
  /** What a cube is for: theme drafts, cube (booster) drafts, or either. Absent means "any". */
  draftType?: "theme" | "booster" | "any";
}

export type DraftVisibility = "open" | "private";

export interface Draft {
  id: number;
  guildId: string;
  channelId: string | null;
  name: string;
  status: "pending" | "active" | "cancelled" | "completed";
  visibility: DraftVisibility;
  createdByUserId: number;
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

export type TournamentVisibility = "open" | "private";

export interface Tournament {
  visibility: TournamentVisibility;
  id: number;
  guildId: string;
  name: string;
  format: "round_robin" | "single_elim";
  status: "pending" | "active" | "cancelled" | "completed";
  createdByUserId: number;
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
  createdByUserId: number;
}

export type {
  EngineDataSource, DataStatus, EngineSourcePin, EngineDataStatus, CatalogSetStatus,
  CardCatalogStatus, CardDataGapCard, CardDataSetGapStatus, CardDataGapStatus, UpstreamSourceStatus,
  EngineUpdateWorkflowStatus, CardDataStatus, LocalCardDataStatus,
} from "./card-data-status.js";
export * from "./draft-lobby.js";
