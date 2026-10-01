import type {
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelDeckValidation,
  DuelFormat,
  DuelHistoryScope,
  DuelListItem,
  DuelReplay,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelSession,
  DuelSettings,
} from "@yugidraft/shared/duels";

export class DuelRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DuelRequestError";
    this.status = status;
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
    throw new DuelRequestError(errorMessage(body, res.status), res.status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DuelRequestError("The server returned an invalid response. Your last game state is unchanged.", 502);
  }
  return body as T;
}

export const DUEL_LIST_KEY = "/api/duels";

export function duelRoomKey(slug: string): string {
  return `/api/duels/${slug}`;
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

export async function createDuel(
  name: string,
  mode: DuelMode,
  masterRule: DuelMasterRule,
  settings: DuelSettings,
  format: DuelFormat = "1v1",
): Promise<{ session: DuelSession }> {
  return parseBody(
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mode, masterRule, settings, format }),
    }),
  );
}

export async function getDuelRoom(slug: string): Promise<DuelRoom> {
  return parseBody(await fetch(duelRoomKey(slug), { cache: "no-store" }));
}

export async function acceptDuelInvite(slug: string, inviteCode: string): Promise<DuelRoom> {
  return parseBody(await fetch(`/api/duels/${encodeURIComponent(slug)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteCode }),
  }));
}

export async function joinDuel(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/join`, { method: "POST" }),
  );
}

/** `seat` is the 0-based empty seat to fill; leave it out to take the first empty seat. */
export async function addPracticeBot(slug: string, seat?: number): Promise<{ session: DuelSession }> {
  const url = `/api/duels/${encodeURIComponent(slug)}/bot`;
  if (seat === undefined) return parseBody(await fetch(url, { method: "POST" }));
  return parseBody(
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat }) }),
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
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/deck/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
      signal,
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
): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    }),
  );
}

export async function surrenderDuel(slug: string): Promise<DuelRoom> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/surrender`, { method: "POST" }),
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
): Promise<{ cards: DuelCardInfo[] }> {
  const params = new URLSearchParams({ q });
  if (slug) params.set("slug", slug);
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
