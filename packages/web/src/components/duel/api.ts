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
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelRpsMove,
  DuelSeriesSummary,
  DuelSession,
  DuelSettings,
  SandboxBotMode,
} from "@yugidraft/shared/duels";

export class DuelRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "DuelRequestError";
    this.status = status;
    this.code = code;
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
    throw new DuelRequestError(errorMessage(body, res.status), res.status, code);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DuelRequestError("The server returned an invalid response. Your last game state is unchanged.", 502);
  }
  return body as T;
}

export const DUEL_LIST_KEY = "/api/duels";

export function duelRoomKey(slug: string, spectate = false): string {
  return `/api/duels/${slug}${spectate ? "?spectate=1" : ""}`;
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
): Promise<{ session: DuelSession; series?: DuelSeriesSummary; notified?: boolean }> {
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

/**
 * Dev sandbox only: the seat the admin acts as and whether the other seats' hands show. The routes read them from the
 * query string (view and actions) or from the body (sandbox controls). Both are optional; a plain duel never sends them.
 */
export interface SandboxView {
  as?: number;
  reveal?: boolean;
}

function withSandboxQuery(url: string, sandbox?: SandboxView): string {
  if (!sandbox || (sandbox.as === undefined && sandbox.reveal === undefined)) return url;
  const query = new URLSearchParams();
  if (sandbox.as !== undefined) query.set("as", String(sandbox.as));
  if (sandbox.reveal !== undefined) query.set("reveal", sandbox.reveal ? "1" : "0");
  return `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
}

export async function getDuelRoom(slug: string, spectate = false, sandbox?: SandboxView): Promise<DuelRoom> {
  return parseBody(await fetch(withSandboxQuery(duelRoomKey(slug, spectate), sandbox), { cache: "no-store" }));
}

export async function acceptDuelInvite(slug: string, inviteCode: string): Promise<DuelRoom> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  }));
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
export async function pickOpeningMove(slug: string, move: DuelRpsMove): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/opening`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ move }),
    }),
  );
}

/** The opening winner chooses to go first or second. */
export async function chooseOpeningOrder(slug: string, choice: DuelFirstChoice): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/opening`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice }),
    }),
  );
}

export async function startDuel(slug: string): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/start`, { method: "POST" }),
  );
}

export async function sendDuelAction(
  slug: string,
  command: DuelCommand,
  sandbox?: SandboxView,
): Promise<DuelRoom> {
  return parseBody(
    await fetch(withSandboxQuery(`/api/duels/${encodeURIComponent(slug)}/actions`, sandbox), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
}

/** Set your own chain response switch. The answer is your room view, like an action. */
export async function setChainResponseMode(slug: string, mode: DuelChainMode): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/chain-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }),
  );
}

export async function surrenderDuel(slug: string, sandbox?: SandboxView): Promise<DuelRoom> {
  return parseBody(
    await fetch(withSandboxQuery(`/api/duels/${encodeURIComponent(slug)}/surrender`, sandbox), { method: "POST" }),
  );
}

export async function leaveDuel(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/leave`, { method: "POST" }));
}

export async function archiveDuel(slug: string): Promise<DuelRoom> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/archive`, { method: "POST" }));
}

export async function cancelDuel(slug: string): Promise<DuelRoom> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/cancel`, { method: "POST" }));
}

export async function searchDuelCards(
  q: string,
  slug?: string,
  sandbox?: SandboxView,
): Promise<{ cards: DuelCardInfo[] }> {
  const params = new URLSearchParams({ q });
  if (slug) params.set("slug", slug);
  return parseBody(await fetch(withSandboxQuery(`/api/duels/cards?${params.toString()}`, sandbox), { cache: "no-store" }));
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
// Dev sandbox controls (`POST /api/duels/[slug]/sandbox`). Admin only; the host checks the organizer.

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
