import type {
  DuelBestOf,
  DuelChainMode,
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelFirstChoice,
  DuelDeckValidation,
  DuelFormat,
  DuelHistoryScope,
  DuelListItem,
  DuelReplay,
  DuelReplayV2,
  ReplayForkRequest,
  ReplayForkResult,
  ReplayVisibility,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelRpsMove,
  DuelSeriesSummary,
  DuelSession,
  DuelSettings,
} from "@yugidraft/shared/duels";

export class DuelRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Replay errors only: whether the saved final board can still be opened. Absent on older servers. */
  readonly finalBoard?: "available" | "none";

  constructor(message: string, status: number, code?: string, finalBoard?: "available" | "none") {
    super(message);
    this.name = "DuelRequestError";
    this.status = status;
    this.code = code;
    this.finalBoard = finalBoard;
  }
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

async function parseBody<T>(res: Response): Promise<T> {
  if (res.redirected) throw new DuelRequestError("Your session expired. Sign in again to return to this table.", 401);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : undefined;
    const finalBoard = body && typeof body === "object" && "finalBoard" in body
      && (body.finalBoard === "available" || body.finalBoard === "none") ? body.finalBoard : undefined;
    throw new DuelRequestError(errorMessage(body, res.status), res.status, code, finalBoard);
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

export async function listDuels(
  archived = false,
  scope: DuelHistoryScope = "mine",
): Promise<{ duels: DuelListItem[] }> {
  const url = archived ? `${DUEL_LIST_KEY}?archived=1&scope=${scope}` : DUEL_LIST_KEY;
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
export function duelReplayUrl(slug: string, visibility: ReplayVisibility): string {
  return `${duelReplayKey(slug)}?version=2&visibility=${visibility}`;
}

export async function getDuelReplayFrames(
  slug: string,
  visibility: ReplayVisibility,
  signal?: AbortSignal,
): Promise<DuelReplay | DuelReplayV2> {
  return parseBody(await fetch(duelReplayUrl(slug, visibility), { cache: "no-store", signal }));
}

/** The private views an owner may ask for. `seat` shows that seat's cards; `reveal` fills every hand. */
export interface OwnerReplayView {
  visibility: ReplayVisibility;
  seat?: number | null;
  reveal?: boolean;
}

export function ownerReplayUrl(slug: string, view: OwnerReplayView): string {
  const query = new URLSearchParams({ version: "2", visibility: view.visibility });
  if (view.seat != null) query.set("seat", String(view.seat));
  if (view.reveal) query.set("reveal", "1");
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

/** A hint for the UI only: every owner route checks access again. Anything but a clear yes is no. */
export async function getAdminAccessHint(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/access", { cache: "no-store", signal });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => null);
    return body !== null && typeof body === "object" && (body as { admin?: unknown }).admin === true;
  } catch {
    return false;
  }
}

export interface CreateDuelOptions {
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
): Promise<{ session: DuelSession; series?: DuelSeriesSummary; shareUrl: string }> {
  const { opponentPlayerId, bestOf, ranked, format } = options;
  return parseBody(
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

export async function getDuelRoom(slug: string, spectate = false, fork: ForkViewControl | null = null): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(await fetch(duelRoomKey(slug, spectate, fork), { cache: "no-store" })));
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
): Promise<{ session: DuelSession }> {
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
export async function markDuelReady(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/ready`, { method: "POST" }));
}

export async function markDuelUnready(slug: string): Promise<{ session: DuelSession }> {
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
export async function readySeries(slug: string): Promise<{ series: DuelSeriesSummary; nextSlug: string | null }> {
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
  as?: number,
): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/actions${as === undefined ? "" : `?as=${as}`}`, {
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

export async function surrenderDuel(slug: string): Promise<ReceivedDuelRoom> {
  return withRoomReceivedAt(await parseBody<DuelRoom>(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/surrender`, { method: "POST" }),
  ));
}

export async function leaveDuel(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/leave`, { method: "POST" }));
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
  fork?: ForkSearchBinding | null,
): Promise<{ cards: DuelCardInfo[] }> {
  const params = new URLSearchParams({ q });
  if (slug) params.set("slug", slug);
  if (slug && fork) {
    params.set("as", String(fork.as));
    params.set("promptId", fork.promptId);
    params.set("revision", String(fork.revision));
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
