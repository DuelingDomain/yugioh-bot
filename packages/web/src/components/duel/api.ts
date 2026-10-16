import type {
  DuelBestOf,
  DuelChainMode,
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelFirstChoice,
  DuelDeckValidation,
  DuelFormat,
  DuelHistoryPage,
  DuelHistoryScope,
  DuelListItem,
  DuelReplay,
  DuelReplayV2,
  ReplayErrorResponse,
  ReplayForkRequest,
  ReplayForkResult,
  ReplayUnverifiedReason,
  ReplayVisibility,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelRpsMove,
  DuelSeriesSummary,
  DuelSession,
  DuelSettings,
  SandboxBotMode,
} from "@yugidraft/shared/duels";
import { EMPTY_HISTORY_FILTERS, historyQuery, type HistoryFilters } from "./history-filters";

/** The extra fields of a REPLAY_UNVERIFIED (409) answer. Both are optional: an older server sends neither. */
export type ReplayErrorDetail = Pick<ReplayErrorResponse, "canOpenUnchecked" | "reason">;

export class DuelRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Replay errors only: whether the saved final board can still be opened. Absent on older servers. */
  readonly finalBoard?: "available" | "none";
  /** Replay errors only: why the replay could not be checked, and whether the owner may open it anyway. */
  readonly detail?: ReplayErrorDetail;

  constructor(message: string, status: number, code?: string, finalBoard?: "available" | "none", detail?: ReplayErrorDetail) {
    super(message);
    this.name = "DuelRequestError";
    this.status = status;
    this.code = code;
    this.finalBoard = finalBoard;
    this.detail = detail;
  }
}

const UNVERIFIED_REASONS: readonly string[] = ["board_mismatch", "command_mismatch", "no_saved_board"];

/** Access failures invalidate cached private views, including expired sessions without an error code. */
export function isDuelAccessError(error: unknown): error is DuelRequestError {
  return error instanceof DuelRequestError && (error.code === "ACCESS_DENIED" || error.code === "ACCESS_UNAVAILABLE"
    || error.status === 401 || error.status === 403 || error.status === 404);
}

/** The room left the lobby while a deck check was pending. Refresh the room; no report applies. */
export class DeckValidationSkippedError extends Error {
  constructor() {
    super("Deck validation is no longer needed outside the lobby.");
    this.name = "DeckValidationSkippedError";
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed (${status})`;
}

function replayErrorDetail(body: unknown): ReplayErrorDetail | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const detail: ReplayErrorDetail = {};
  if (typeof raw.canOpenUnchecked === "boolean") detail.canOpenUnchecked = raw.canOpenUnchecked;
  if (typeof raw.reason === "string" && UNVERIFIED_REASONS.includes(raw.reason)) detail.reason = raw.reason as ReplayUnverifiedReason;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.redirected) throw new DuelRequestError("Your session expired. Sign in again to return to this table.", 401);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : undefined;
    const finalBoard = body && typeof body === "object" && "finalBoard" in body
      && (body.finalBoard === "available" || body.finalBoard === "none") ? body.finalBoard : undefined;
    throw new DuelRequestError(errorMessage(body, res.status), res.status, code, finalBoard, replayErrorDetail(body));
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DuelRequestError("The server returned an invalid response. Your last game state is unchanged.", 502);
  }
  return body as T;
}

export const DUEL_LIST_KEY = "/api/duels";

/**
 * Replay fork views only. `as` is the seat the fork shows and answers for; the websocket identity stays at seat 0.
 * An ordinary table rejects both flags, so they are sent only after the room says it is a fork.
 */
export interface ForkViewControl {
  /** Null follows the seat the engine waits on; the host picks it on every read. */
  as: number | null;
  /** Reveal hands is on at the host unless a view asks for off. */
  reveal: boolean;
}

export function duelRoomKey(slug: string, spectate = false, fork: ForkViewControl | null = null): string {
  const query = new URLSearchParams();
  if (spectate) query.set("spectate", "1");
  if (fork) {
    if (fork.as != null) query.set("as", String(fork.as));
    if (!fork.reveal) query.set("reveal", "0");
  }
  const text = query.toString();
  return `/api/duels/${slug}${text ? `?${text}` : ""}`;
}

/** Live lists answer `{ duels }` only; history pages add the cursor and the admin flag. */
export interface DuelListPage extends Partial<Omit<DuelHistoryPage, "duels">> {
  duels: DuelListItem[];
}

export function duelHistoryKey(
  scope: DuelHistoryScope = "mine",
  filters: HistoryFilters = EMPTY_HISTORY_FILTERS,
  cursor?: string | null,
): string {
  return `${DUEL_LIST_KEY}?${historyQuery(scope, filters, cursor)}`;
}

export async function listDuels(
  archived = false,
  scope: DuelHistoryScope = "mine",
  filters: HistoryFilters = EMPTY_HISTORY_FILTERS,
  cursor?: string | null,
): Promise<DuelListPage> {
  const url = archived ? duelHistoryKey(scope, filters, cursor) : DUEL_LIST_KEY;
  return parseBody(await fetch(url, { cache: "no-store" }));
}

export function duelReplayKey(slug: string): string {
  return `/api/duels/${slug}/replay`;
}

export async function getDuelReplay(slug: string): Promise<DuelReplay> {
  return parseBody(await fetch(duelReplayKey(slug), { cache: "no-store" }));
}

/**
 * The ordinary viewer asks only for the contract version and the card visibility. Camera position, seat
 * overrides and reveal flags never travel: the server rejects them for ordinary viewers. A server that
 * does not know version 2 yet answers with the v1 shape, which the replay controller converts.
 */
export function duelReplayUrl(slug: string, visibility: ReplayVisibility, unchecked = false): string {
  return `${duelReplayKey(slug)}?version=2&visibility=${visibility}${unchecked ? "&unchecked=1" : ""}`;
}

/** `unchecked` asks the server to open a replay it could not check. It is the owner's choice; the server refuses anyone else. */
export async function getDuelReplayFrames(
  slug: string,
  visibility: ReplayVisibility,
  signal?: AbortSignal,
  unchecked = false,
): Promise<DuelReplay | DuelReplayV2> {
  return parseBody(await fetch(duelReplayUrl(slug, visibility, unchecked), { cache: "no-store", signal }));
}

/** The private views an owner may ask for. `seat` shows that seat's cards; `reveal` fills every hand. */
export interface OwnerReplayView {
  visibility: ReplayVisibility;
  seat?: number | null;
  reveal?: boolean;
  /** Open the replay without the check against the saved final board. */
  unchecked?: boolean;
}

export function ownerReplayUrl(slug: string, view: OwnerReplayView): string {
  const query = new URLSearchParams({ version: "2", visibility: view.visibility });
  if (view.seat != null) query.set("seat", String(view.seat));
  if (view.reveal) query.set("reveal", "1");
  if (view.unchecked) query.set("unchecked", "1");
  return `/api/admin/duels/${encodeURIComponent(slug)}/replay?${query.toString()}`;
}

/** Owner only. The server checks the owner list again; a private source needs no seat or grant. */
export async function getOwnerReplayFrames(
  slug: string,
  view: OwnerReplayView,
  signal?: AbortSignal,
): Promise<DuelReplayV2> {
  return parseBody(await fetch(ownerReplayUrl(slug, view), { cache: "no-store", signal }));
}

/** Owner only. The retry key in `request` makes a repeated click or a network retry one fork. */
export async function postReplayFork(slug: string, request: ReplayForkRequest): Promise<ReplayForkResult> {
  return parseBody(await fetch(`/api/admin/duels/${encodeURIComponent(slug)}/replay/fork`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }));
}

/** Fork creator only: run the copied prefix again and drop what was played after it. */
export async function restartReplayFork(slug: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/fork/restart`, { method: "POST", cache: "no-store" }),
  ));
}

/** Fork creator only: end the fork. The source duel never changes. The host answers with the session only. */
export async function cancelReplayFork(slug: string): Promise<{ session: DuelSession }> {
  return parseBody<{ session: DuelSession }>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/fork/cancel`, { method: "POST", cache: "no-store" }),
  );
}

/** One open replay fork of the owner, as the list route answers it. The times are UTC, "YYYY-MM-DD HH:MM:SS". */
export interface OpenReplayFork {
  slug: string;
  sourceSlug: string;
  format: DuelFormat;
  createdAt: string;
  lastActivityAt: string;
}

export interface OpenReplayForkList {
  forks: OpenReplayFork[];
  /** How many forks an owner may keep open. */
  limit: number;
}

/** Owner only. The server checks the owner list; any other user gets an access error. */
export async function getOpenReplayForks(signal?: AbortSignal): Promise<OpenReplayForkList> {
  const body = await parseBody<Partial<OpenReplayForkList>>(await fetch("/api/admin/duels/forks", { cache: "no-store", signal }));
  if (!Array.isArray(body.forks) || typeof body.limit !== "number") {
    throw new DuelRequestError("The server returned an invalid list of forks.", 502);
  }
  return { forks: body.forks, limit: body.limit };
}

export interface CreateDuelOptions {
  /** Reuse this key when retrying the same creation request. */
  requestKey?: string;
  /** A named opponent makes a private challenge; empty is an open table. */
  opponentPlayerId?: number | null;
  bestOf?: DuelBestOf;
  ranked?: boolean;
  /** Table format: 1v1 (default), Tag, or a 3 or 4 player free-for-all. */
  format?: DuelFormat;
}

export async function createDuel(
  name: string,
  mode: DuelMode,
  masterRule: DuelMasterRule,
  settings: DuelSettings,
  options: CreateDuelOptions = {},
): Promise<{ session: DuelSession; series?: DuelSeriesSummary; notified?: boolean }> {
  const { opponentPlayerId, bestOf, ranked, format, requestKey } = options;
  return parseBody(
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
      body: JSON.stringify({
        name, mode, masterRule, settings,
        ...(format != null ? { format } : {}),
        ...(opponentPlayerId != null ? { opponentPlayerId } : {}),
        ...(bestOf != null ? { bestOf } : {}),
        ...(ranked != null ? { ranked } : {}),
      }),
    }),
  );
}

export async function getHostedWaitingTable(): Promise<{ table: (Pick<DuelSession, "slug" | "name"> & { canReplace: boolean; canCancel: boolean; reason: "empty" | "challenge" | "protected"; opponentName?: string }) | null }> {
  return parseBody(await fetch("/api/duels?hostedWaiting=1", { cache: "no-store" }));
}

export async function cancelWaitingDuel(slug: string): Promise<ReceivedDuelRoom> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/cancel-waiting`, { method: "POST" }));
}

export interface DuelPlayerOption {
  id: number;
  displayName: string;
}

/** Guild players for the opponent picker (the caller is excluded, at most 20). */
export async function searchPlayers(q: string, signal?: AbortSignal): Promise<{ players: DuelPlayerOption[] }> {
  return parseBody(await fetch(`/api/players?${new URLSearchParams({ q }).toString()}`, { cache: "no-store", signal }));
}

export type ReceivedDuelRoom = DuelRoom & { receivedAt: number };

/** Keep the original client receive time with the room when SWR caches it. */
export function withRoomReceivedAt(room: DuelRoom & { receivedAt?: number }): ReceivedDuelRoom {
  return { ...room, receivedAt: room.receivedAt ?? performance.now() };
}

/** The acting seat and hidden-hand visibility for a developer sandbox. */
export interface SandboxView {
  as?: number;
  reveal?: boolean;
}

function withSandboxQuery(url: string, sandbox?: { as?: number | null; reveal?: boolean }): string {
  if (!sandbox || (sandbox.as === undefined && sandbox.reveal === undefined)) return url;
  const query = new URLSearchParams();
  if (sandbox.as != null) query.set("as", String(sandbox.as));
  if (sandbox.reveal !== undefined) query.set("reveal", sandbox.reveal ? "1" : "0");
  return `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
}

export async function getDuelRoom(slug: string, spectate = false, fork: ForkViewControl | null = null, sandbox?: SandboxView): Promise<ReceivedDuelRoom> {
  const url = fork ? duelRoomKey(slug, spectate, fork) : withSandboxQuery(duelRoomKey(slug, spectate), sandbox);
  return withRoomReceivedAt(await parseBody<DuelRoom>(await fetch(url, { cache: "no-store" })));
}

export async function acceptDuelInvite(slug: string, inviteCode: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(await fetch(`/api/duels/${encodeURIComponent(slug)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  })));
}

export async function takeDuelSeat(slug: string, seat: number): Promise<{ session: DuelSession }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/seat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seat }),
  }));
}

/** `seat` is the 0-based empty seat to fill; leave it out to take the first empty seat. */
export async function addPracticeBot(slug: string, seat?: number): Promise<{ session: DuelSession }> {
  const url = `/api/duels/${encodeURIComponent(slug)}/bot`;
  if (seat === undefined) return parseBody(await fetch(url, { method: "POST" }));
  return parseBody(
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat }) }),
  );
}

/** `seat` is the bot's 0-based seat; leave it out to remove every practice bot at the table. */
export async function removePracticeBot(slug: string, seat?: number): Promise<{ session: DuelSession }> {
  const url = `/api/duels/${encodeURIComponent(slug)}/bot`;
  if (seat === undefined) return parseBody(await fetch(url, { method: "DELETE" }));
  return parseBody(
    await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat }) }),
  );
}

export async function setDuelDeck(
  slug: string,
  deck: DuelDeck,
): Promise<{ session: DuelSession; startBlocked?: string }> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/deck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
    }),
  );
}

export async function validateDuelDeck(
  slug: string,
  deck: DuelDeck,
  signal: AbortSignal,
): Promise<DuelDeckValidation> {
  const report = await parseBody<DuelDeckValidation | { skipped: true }>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/deck/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
      signal,
    }),
  );
  if ("skipped" in report) throw new DeckValidationSkippedError();
  return report;
}

/** A seated player clicks Ready in a series game lobby (tournament games use the registered deck). */
export async function markDuelReady(slug: string): Promise<{ session: DuelSession; startBlocked?: string }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/ready`, { method: "POST" }));
}

export async function markDuelUnready(slug: string): Promise<{ session: DuelSession; startBlocked?: string }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/unready`, { method: "POST" }));
}

/** Save the side-deck swaps for the next game; `slug` is any game of the series. */
export async function saveSeriesSideDeck(slug: string, deck: DuelDeck): Promise<{ series: DuelSeriesSummary }> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/series/side`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deck }),
    }),
  );
}

/** Ready for the next game. `nextSlug` is set once the next game exists. */
export async function readySeries(slug: string): Promise<{ series: DuelSeriesSummary; nextSlug: string | null; startBlocked?: string }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/series/ready`, { method: "POST" }));
}

/** Take back Ready while editing the side deck. `nextSlug` is set when the next game already exists. */
export async function unreadySeries(slug: string): Promise<{ series: DuelSeriesSummary; nextSlug: string | null }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/series/unready`, { method: "POST" }));
}

/** The loser of the last game chooses to go first or second in the next game; `slug` is any game of the series. */
export async function chooseSeriesFirst(slug: string, choice: DuelFirstChoice): Promise<{ series: DuelSeriesSummary; nextSlug: string | null }> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/series/first`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice }),
    }),
  );
}

/** Cancel a series (casual: either player; tournament: the tournament creator). The body is not used. */
export async function cancelSeries(seriesId: number): Promise<void> {
  const res = await fetch(`/api/duels/series/${seriesId}/cancel`, { method: "POST" });
  if (res.redirected) throw new DuelRequestError("Your session expired. Sign in again to return to this table.", 401);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new DuelRequestError(errorMessage(body, res.status), res.status);
  }
}

/** Plays a rock-paper-scissors move in the opening. The pick is final. */
export async function pickOpeningMove(slug: string, move: DuelRpsMove): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/opening`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ move }),
    }),
  ));
}

/** The opening winner chooses to go first or second. */
export async function chooseOpeningOrder(slug: string, choice: DuelFirstChoice): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/opening`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice }),
    }),
  ));
}

export async function startDuel(slug: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/start`, { method: "POST" }),
  ));
}

/** `as` names the acting seat of a replay fork; leave it out at every ordinary table. */
export async function sendDuelAction(
  slug: string,
  command: DuelCommand,
  control?: number | SandboxView,
): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(withSandboxQuery(`/api/duels/${encodeURIComponent(slug)}/actions`, typeof control === "number" ? { as: control } : control), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }),
  ));
}

/** Replay forks bind a response change to one seat, one revision and, when the seat has one, one prompt. */
export interface ForkChainBinding {
  as: number;
  revision: number;
  promptId?: string;
}

/** Set your own chain response switch. The answer is your room view, like an action. */
export async function setChainResponseMode(slug: string, mode: DuelChainMode, fork?: ForkChainBinding): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/chain-mode${fork ? `?as=${fork.as}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fork
        ? { mode, revision: fork.revision, ...(fork.promptId !== undefined ? { promptId: fork.promptId } : {}) }
        : { mode }),
    }),
  ));
}

export async function surrenderDuel(slug: string, sandbox?: SandboxView): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(withSandboxQuery(`/api/duels/${encodeURIComponent(slug)}/surrender`, sandbox), { method: "POST" }),
  ));
}

export async function leaveDuel(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/leave`, { method: "POST" }));
}

/**
 * Leave a room that has not started. The host closes it for everyone; a guest gives up the seat.
 * One route for both: the server decides by the caller's role and refuses once the game has started.
 */
export async function leaveLobbyRoom(slug: string): Promise<void> {
  const res = await fetch(`/api/duels/${encodeURIComponent(slug)}/leave`, { method: "POST" });
  if (res.ok && !res.redirected) return;
  await parseBody(res);
}

export async function archiveDuel(slug: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(await fetch(`/api/duels/${encodeURIComponent(slug)}/archive`, { method: "POST" })));
}

export async function cancelDuel(slug: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(await fetch(`/api/duels/${encodeURIComponent(slug)}/cancel`, { method: "POST" })));
}

/** A replay fork searches for one prompt of one acting seat; the server checks all three. */
export interface ForkSearchBinding {
  as: number;
  promptId: string;
  revision: number;
}

export async function searchDuelCards(
  q: string,
  slug?: string,
  control?: ForkSearchBinding | SandboxView | null,
): Promise<{ cards: DuelCardInfo[] }> {
  const params = new URLSearchParams({ q });
  if (slug) params.set("slug", slug);
  if (slug && control) {
    if (control.as !== undefined) params.set("as", String(control.as));
    if ("reveal" in control && control.reveal !== undefined) params.set("reveal", control.reveal ? "1" : "0");
    if ("promptId" in control) {
    params.set("promptId", control.promptId);
    params.set("revision", String(control.revision));
    }
  }
  return parseBody(await fetch(`/api/duels/cards?${params.toString()}`, { cache: "no-store" }));
}

export async function getDuelCards(codes: number[]): Promise<{ cards: DuelCardInfo[]; missing: number[] }> {
  return parseBody(await fetch("/api/duels/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes }),
  }));
}

export interface DuelPresetIssue {
  sig: string;
  title: string;
  owner: string;
}

export interface DuelPreset {
  id: string;
  title: string;
  format: string;
  needsMultiCore: boolean;
  checklist: string[];
  /** Known problems for this scenario (may be missing on an older duel host). */
  issues?: DuelPresetIssue[];
  available?: boolean;
  unavailableReason?: string | null;
}

/** The multi-duelist core installed on the duel host. */
export interface DuelPresetCore {
  tag: string | null;
  sha: string | null;
}

/** Dev only. The server answers 404 when DUEL_SCENARIOS is off. */
export async function listDuelPresets(): Promise<{ presets: DuelPreset[]; core?: DuelPresetCore }> {
  return parseBody(await fetch("/api/duels/preset", { cache: "no-store" }));
}

export async function startDuelPreset(presetId: string): Promise<{ slug: string }> {
  return parseBody(await fetch("/api/duels/preset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId }),
  }));
}

export async function reportDuel(slug: string, note: string): Promise<{ path: string }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  }));
}

/** True only when the server runs with DUEL_SCENARIOS=1. */
export async function reportEnabled(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/duels/${encodeURIComponent(slug)}/report`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Dev sandbox controls (`POST /api/duels/[slug]/sandbox`). Listed developers only; the host checks the organizer.

export type SandboxWalkPhase = "standby" | "main1" | "battle" | "main2" | "end";

async function postSandbox<T>(slug: string, payload: Record<string, unknown>, sandbox?: SandboxView): Promise<T> {
  return parseBody<T>(await fetch(`/api/duels/${encodeURIComponent(slug)}/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      ...(sandbox?.as !== undefined ? { as: sandbox.as } : {}),
      ...(sandbox?.reveal !== undefined ? { reveal: sandbox.reveal } : {}),
    }),
  }));
}

/** Set one bot seat (1 to 3) to Auto-pass, Practice bot or Manual. The answer is the room as the acting seat sees it. */
export async function setSandboxSeatControl(
  slug: string, seat: number, control: SandboxBotMode, sandbox?: SandboxView,
): Promise<DuelRoom> {
  return postSandbox(slug, { action: "control", seat, control }, sandbox);
}

/** Walk the real engine through each phase (bots pass) until `phase`. The room tells where it stopped. */
export async function sandboxGoToPhase(slug: string, phase: SandboxWalkPhase, sandbox?: SandboxView): Promise<DuelRoom> {
  return postSandbox(slug, { action: "go-to-phase", phase }, sandbox);
}

/** Walk the real engine to the start of the next turn. */
export async function sandboxNextTurn(slug: string, sandbox?: SandboxView): Promise<DuelRoom> {
  return postSandbox(slug, { action: "next-turn" }, sandbox);
}

/** New duel with the same board, seed and bot modes. The old one is cancelled. */
export async function restartSandbox(slug: string, sandbox?: SandboxView): Promise<{ slug: string }> {
  return postSandbox(slug, { action: "restart" }, sandbox);
}

/** The part of a saved scenario the bar shows: its id (for the link) and name. */
export interface SandboxSavedScenario {
  id: number;
  name: string;
}

/** Answer of `save-state`: the saved scenario and what the board could not keep from the live duel. */
export interface SandboxSaveStateResult {
  scenario: SandboxSavedScenario;
  lost: string[];
}

/** FFA only: send one seat out through the real elimination path. The answer is the room as the acting seat sees it. */
export async function eliminateSandboxSeat(slug: string, seat: number, sandbox?: SandboxView): Promise<DuelRoom> {
  return postSandbox(slug, { action: "eliminate", seat }, sandbox);
}

/**
 * Snapshot the live duel and save it as a scenario. `scenarioId` updates one the caller owns; leave it out to make
 * a new one. Nothing changes in the live duel.
 */
export async function saveSandboxState(
  slug: string, options: { name: string; scenarioId?: number }, sandbox?: SandboxView,
): Promise<SandboxSaveStateResult> {
  return postSandbox(slug, {
    action: "save-state",
    name: options.name,
    ...(options.scenarioId !== undefined ? { scenarioId: options.scenarioId } : {}),
  }, sandbox);
}

/** End the sandbox duel and release its engine. Repeating it is safe. It saves nothing. */
export async function closeSandbox(slug: string, sandbox?: SandboxView): Promise<{ ok: true }> {
  return postSandbox(slug, { action: "close" }, sandbox);
}
