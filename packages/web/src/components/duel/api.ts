import type {
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelDeckValidation,
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
): Promise<{ session: DuelSession }> {
  return parseBody(
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mode, masterRule, settings }),
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

export async function addPracticeBot(slug: string): Promise<{ session: DuelSession }> {
  return parseBody(
    await fetch(`/api/duels/${encodeURIComponent(slug)}/bot`, { method: "POST" }),
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
