/**
 * Pure helpers for the draft lobby (board b22): why Start is disabled, what Start says it will do,
 * and the setup rows. Kept free of React so the rules can be tested on their own.
 */

import {
  AUTO_START_DELAY_MS,
  MANUAL_START_DELAY_MS,
  NUDGE_COOLDOWN_MS,
  type DraftAutoStartRequest,
  type DraftLobbyResponse,
  type DraftNudgeResponse,
  type DraftStartRequest,
  type LobbyPlayer,
  type LobbySnapshot,
  type LobbyStart,
} from "@yugidraft/shared/types";
import { formatPickSeconds } from "../pick-time";

export interface LobbyConfig {
  mode?: "booster" | "theme";
  cardsPerPlayer?: number;
  packSize?: number;
  packsPerPlayer?: number;
  pickSeconds?: number;
  /** Cube drafts: cards a player takes from a pack before it moves on (1 or 2). */
  picksPerStep?: number;
  alternatePassDirection?: boolean;
  randomizeSeats?: boolean;
  copyLimit?: boolean;
  themeSelection?: "host_assigned" | "random" | "player_pick";
  uniqueThemes?: boolean;
  themePackSize?: number;
  extraDeckEnabled?: boolean;
  extraDeckSize?: number;
  burnUnpicked?: boolean;
  /** Target number of seats. Absent in a legacy lobby, which has joined seats plus one invite slot. */
  lobbySeats?: number;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The reason Start can't be pressed, or null when it can. Mirrors what the server would reject. */
export function startBlocker(args: {
  playerCount: number;
  isTheme: boolean;
  themeCount: number;
  uniqueThemes: boolean;
}): string | null {
  const { playerCount, isTheme, themeCount, uniqueThemes } = args;
  if (playerCount < 2) return `Need ${plural(2 - playerCount, "more player")} to start.`;
  if (isTheme && themeCount === 0) return "Add a theme first.";
  if (isTheme && uniqueThemes && themeCount < playerCount) {
    const missing = playerCount - themeCount;
    return `Add ${plural(missing, "more theme")}. Each of the ${playerCount} players needs their own.`;
  }
  return null;
}

export function themeExtraOn(config: LobbyConfig): boolean {
  return config.extraDeckEnabled ?? true;
}

/** A cube draft's Extra Deck round is on only when the config says so (theme drafts default to on). */
export function boosterExtraOn(config: LobbyConfig): boolean {
  return config.extraDeckEnabled === true && (config.extraDeckSize ?? 15) > 0;
}

export function packsOf(config: LobbyConfig): number {
  const cards = config.cardsPerPlayer ?? 40;
  const size = config.packSize ?? 15;
  return config.packsPerPlayer ?? Math.max(1, Math.ceil(cards / Math.max(1, size)));
}

/** The sentence under Start, as plain parts so the component can bold the key figure. */
export function startSummary(config: LobbyConfig, playerCount: number): { before: string; strong: string; after: string } {
  if (config.mode === "theme") {
    const main = config.cardsPerPlayer ?? 40;
    const extra = themeExtraOn(config) ? config.extraDeckSize ?? 15 : 0;
    const gives =
      config.themeSelection === "random"
        ? `Gives each of the ${playerCount} players a random theme. Everyone then drafts `
        : config.themeSelection === "host_assigned"
          ? `Gives each of the ${playerCount} players the theme the host set for them. Everyone then drafts `
          : `Gives each of the ${playerCount} players a theme. Anyone without one gets one at random. Everyone then drafts `;
    return {
      before: gives,
      strong: extra > 0 ? `${main} main deck and ${extra} Extra deck cards` : `${main} main deck cards`,
      after: ". Nobody can join after this.",
    };
  }
  // Drafts made before seat shuffling have no randomizeSeats, and the server seats them in join order.
  const shuffled = config.randomizeSeats === true ? " Seats are shuffled." : "";
  return {
    before: "Deals ",
    strong: `${plural(packsOf(config), "pack")} of ${config.packSize ?? 15}`,
    after: ` to each of the ${playerCount} players.${boosterExtraOn(config) ? ` Then one Extra Deck pack of ${config.extraDeckSize ?? 15} each.` : ""}${shuffled} Nobody can join after this.`,
  };
}

export interface SetupRow {
  label: string;
  value: string;
}

export function setupRows(config: LobbyConfig): SetupRow[] {
  const seconds = config.pickSeconds ? formatPickSeconds(config.pickSeconds) : "—";
  if (config.mode === "theme") {
    const unique = config.uniqueThemes ?? true;
    const selection = config.themeSelection ?? "player_pick";
    const themes =
      selection === "random"
        ? unique ? "Random, all different" : "Random"
        : selection === "host_assigned"
          ? "Host assigns"
          : unique ? "Players pick, all different" : "Players pick";
    return [
      { label: "Themes", value: themes },
      { label: "Main deck", value: `${config.cardsPerPlayer ?? 40} picks` },
      { label: "Extra deck", value: themeExtraOn(config) ? `${config.extraDeckSize ?? 15} picks` : "Off" },
      { label: "Each pick", value: `${config.themePackSize ?? 3} choices` },
      { label: "Pick duration", value: seconds },
      { label: "Copy limit", value: config.copyLimit === false ? "Off" : "3 per card" },
      { label: "Passed cards", value: config.burnUnpicked ? "Burned" : "Can come back" },
    ];
  }
  const rows: SetupRow[] = [
    { label: "Each player", value: `${config.cardsPerPlayer ?? 40} cards` },
    { label: "Packs", value: `${plural(packsOf(config), "pack")} of ${config.packSize ?? "—"}` },
  ];
  if (config.picksPerStep === 2) rows.push({ label: "Picks per turn", value: "2 (2-Pick)" });
  if (boosterExtraOn(config)) rows.push({ label: "Extra Deck round", value: `${plural(config.extraDeckSize ?? 15, "card")} each` });
  rows.push({ label: "Pick duration", value: seconds });
  if (config.alternatePassDirection) rows.push({ label: "Passing", value: "Left, then right" });
  rows.push({ label: "Copy limit", value: config.copyLimit === false ? "Off" : "3 per card" });
  rows.push({ label: "Seats", value: config.randomizeSeats === true ? "Shuffled at the start" : "In join order" });
  return rows;
}

export function initialOf(name: string): string {
  const ch = Array.from(name.trim())[0];
  return ch ? ch.toUpperCase() : "?";
}

/** Splits a preflight line ("Despia: 38 main ...") into its cube name and the rest. */
export function splitPreflight(message: string, cubeNames: string[]): { name: string | null; rest: string } {
  for (const name of cubeNames) {
    if (message.startsWith(`${name}:`)) return { name, rest: message.slice(name.length + 1).trim() };
  }
  const m = /^([^:]{1,80}):\s+(.*)$/s.exec(message);
  return m ? { name: m[1], rest: m[2] } : { name: null, rest: message };
}

export interface PreflightIssue {
  name: string | null;
  shortfall: { kind: "main" | "extra"; have: number; need: number } | null;
  raw: string;
}

/** Keep unknown server messages intact so new preflight checks remain visible. */
export function parsePreflight(message: string, cubeNames: string[]): PreflightIssue {
  const { name, rest } = splitPreflight(message, cubeNames);
  const main = /^Main pool has (\d+) cards? but needs at least (\d+)/.exec(rest);
  const extra = /^Extra pool has (\d+) cards? but needs (\d+)/.exec(rest);
  const match = main ?? extra;
  return {
    name,
    shortfall: name && match ? { kind: main ? "main" : "extra", have: Number(match[1]), need: Number(match[2]) } : null,
    raw: message,
  };
}

export function mainShortfallSummary(names: string[]): string | null {
  if (names.length === 0) return null;
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${joined} can't be drafted yet. ${names.length === 1 ? "Its main pool is" : "Their main pools are"} too small.`;
}

export function mainShortfallFix(count: number): string {
  return count > 1
    ? "Add cards to those cubes, or remove those themes."
    : "Add cards to the cube, or remove the theme.";
}

export function extraShortfallSummary(count: number): string | null {
  if (count === 0) return null;
  return `${plural(count, "theme")} may run short on Extra deck cards, so ${count === 1 ? "that player" : "those players"} could end with fewer. You can start anyway.`;
}

// --- Seats First lobby -------------------------------------------------------------------------------------------

/** A roster row as the page hands it over. Rows from a legacy server have only the first fields. */
export interface RosterInput {
  playerId: number;
  displayName: string;
  seatIndex?: number;
  pickCount?: number;
  finishedAt?: string;
  joinedAt?: string;
  isHost?: boolean;
  isYou?: boolean;
  isBot?: boolean;
  ready?: boolean;
  readyAt?: string | null;
  cubeId?: number | null;
}

/**
 * Fills the lobby fields a legacy roster row lacks. `isYou` falls back to the seats response, and the host mark falls
 * back to "you are the host and this is your seat", the same thing the old list showed.
 */
export function normalizePlayers(
  players: RosterInput[],
  opts: { youIds: ReadonlySet<number>; isCreator: boolean },
): LobbyPlayer[] {
  return players.map((p) => {
    const isYou = p.isYou ?? opts.youIds.has(p.playerId);
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      seatIndex: p.seatIndex,
      pickCount: p.pickCount ?? 0,
      finishedAt: p.finishedAt,
      joinedAt: p.joinedAt ?? "",
      isHost: p.isHost ?? (opts.isCreator && isYou),
      isYou,
      isBot: p.isBot ?? false,
      ready: p.ready ?? false,
      readyAt: p.readyAt ?? null,
      cubeId: p.cubeId ?? null,
    };
  });
}

/** The snapshot of a server that sends no `lobby`: no target, no Ready, manual start only. */
export function fallbackLobby(players: LobbyPlayer[], now: number): LobbySnapshot {
  return {
    revision: 0,
    serverNow: new Date(now).toISOString(),
    targetSeats: null,
    joined: players.length,
    ready: players.filter((p) => p.ready).length,
    allReady: false,
    autoStart: { enabled: false, held: false, eligible: false },
    start: null,
    errors: [],
    warnings: [],
    lastStartError: null,
  };
}

/** The newer of two lobby responses. Equal revisions take the incoming one, as it was read last. */
export function newerLobby(current: DraftLobbyResponse | null, incoming: DraftLobbyResponse): DraftLobbyResponse {
  if (!current) return incoming;
  return incoming.lobby.revision >= current.lobby.revision ? incoming : current;
}

/** Server clock minus client clock. Add it to a client time to get server time. */
export function clockOffset(serverNow: string, clientNow: number): number {
  const server = Date.parse(serverNow);
  return Number.isNaN(server) ? 0 : server - clientNow;
}

/** Milliseconds left on the server deadline, never below zero. The client clock only draws this, it never acts on it. */
export function startRemainingMs(start: LobbyStart, offset: number, clientNow: number): number {
  const at = Date.parse(start.startsAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - (clientNow + offset));
}

export function countdownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

export function startTotalMs(kind: LobbyStart["kind"]): number {
  return kind === "auto" ? AUTO_START_DELAY_MS : MANUAL_START_DELAY_MS;
}

/** Share of the countdown that is left, from 0 to 1. The ring drains from full to empty. */
export function startFractionLeft(remainingMs: number, kind: LobbyStart["kind"]): number {
  return Math.min(1, Math.max(0, remainingMs / startTotalMs(kind)));
}

export type LobbySlot =
  | { type: "player"; player: LobbyPlayer }
  | { type: "open"; index: number };

/**
 * The seat slots: every joined player, then open slots up to the target. A target below the joined count never hides a
 * player. A legacy lobby (no target) shows joined seats and one open slot.
 */
export function seatSlots(players: LobbyPlayer[], targetSeats: number | null): LobbySlot[] {
  const slots: LobbySlot[] = players.map((player) => ({ type: "player", player }));
  const open = targetSeats === null ? 1 : Math.max(0, targetSeats - players.length);
  for (let i = 0; i < open; i++) slots.push({ type: "open", index: players.length + i });
  return slots;
}

export function notReadyPlayers(players: LobbyPlayer[]): LobbyPlayer[] {
  return players.filter((p) => !p.ready);
}

/** The reason Start can't be pressed, or null. Lobby errors come from the server's own pool and setup check. */
export function lobbyStartBlocker(args: { joined: number; errors: string[] }): string | null {
  if (args.joined < 2) return `Need ${plural(2 - args.joined, "more player")} to start.`;
  if (args.errors.length > 0) return "Fix the problems above to start.";
  return null;
}

/** The line under Start. A host may start with fewer seats filled than the target, and the line says so. */
export function lobbyStartLine(args: { joined: number; targetSeats: number | null }): string {
  const { joined, targetSeats } = args;
  if (targetSeats !== null && joined < targetSeats) {
    return `Starts with ${joined} of ${targetSeats} seats filled. Nobody can join after this.`;
  }
  return `Starts with ${plural(joined, "player")}. Nobody can join after this.`;
}

/** Plain names for a list of players, "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Seconds left on the Nudge cooldown, from the last reply. Zero when it is free. */
export function nudgeWaitSeconds(nextAllowedAt: string | null, now: number): number {
  if (!nextAllowedAt) return 0;
  const at = Date.parse(nextAllowedAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export const NUDGE_COOLDOWN_SECONDS = Math.round(NUDGE_COOLDOWN_MS / 1000);

// --- Lobby requests ----------------------------------------------------------------------------------------------

/** A failed lobby request. `body` is the parsed JSON error body, or null when there was none. */
export class LobbyRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: Record<string, unknown> | null;

  constructor(status: number, body: Record<string, unknown> | null, fallback: string) {
    super(typeof body?.error === "string" && body.error ? body.error : fallback);
    this.name = "LobbyRequestError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : null;
    this.body = body;
  }

  get stale(): boolean {
    return this.status === 409 && this.code === "STALE_LOBBY";
  }

  /** The ids a NOT_READY reply names, or null for any other error. */
  get notReady(): { notReadyPlayerIds: number[]; unclaimedPlayerIds: number[] } | null {
    if (this.code !== "NOT_READY" || !this.body) return null;
    const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : []);
    return { notReadyPlayerIds: ids(this.body.notReadyPlayerIds), unclaimedPlayerIds: ids(this.body.unclaimedPlayerIds) };
  }

  get retryAfterSeconds(): number | null {
    const value = this.body?.retryAfterSeconds;
    return typeof value === "number" ? value : null;
  }
}

/** Short message for a failed request. A server `error` text is kept, a few codes get a clearer line. */
export function lobbyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof LobbyRequestError) {
    if (err.stale) return "The lobby changed while you were deciding. It has been refreshed. Try again.";
    if (err.code === "NUDGE_COOLDOWN") {
      const wait = err.retryAfterSeconds;
      return wait ? `Posted just now. Wait ${wait} s before posting again.` : "Posted just now. Wait a moment before posting again.";
    }
    if (err.code === "LOBBY_FULL") return "Every seat is taken.";
    if (err.code === "TOO_FEW_PLAYERS") return "At least 2 players must join before the draft starts.";
    return err.message || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export interface LobbyApi {
  ready(ready: boolean): Promise<DraftLobbyResponse>;
  leave(): Promise<DraftLobbyResponse>;
  removePlayer(playerId: number): Promise<DraftLobbyResponse>;
  start(body: DraftStartRequest): Promise<DraftLobbyResponse>;
  stop(token: string): Promise<DraftLobbyResponse>;
  autoStart(body: DraftAutoStartRequest): Promise<DraftLobbyResponse>;
  nudge(playerId?: number): Promise<DraftNudgeResponse>;
}

/** The lobby mutation routes of one draft. Every lobby mutation answers `{lobby, players}`; Nudge answers its own body. */
export function createLobbyApi(slug: string, fetchImpl?: typeof fetch): LobbyApi {
  const base = `/api/drafts/${encodeURIComponent(slug)}`;
  async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const run = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const res = await run(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    if (!res.ok) throw new LobbyRequestError(res.status, parsed, `Request failed (${res.status})`);
    return parsed as T;
  }
  return {
    ready: (ready) => call("/ready", "POST", { ready }),
    leave: () => call("/join", "DELETE"),
    removePlayer: (playerId) => call(`/players/${playerId}`, "DELETE"),
    start: (body) => call("/start", "POST", body),
    stop: (token) => call("/start", "DELETE", { token }),
    autoStart: (body) => call("/auto-start", "PUT", body),
    nudge: (playerId) => call("/nudge", "POST", playerId === undefined ? {} : { playerId }),
  };
}
