import type {
  DuelCardInfo,
  DuelCommand,
  DuelDeck,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelSession,
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

export async function listDuels(archived = false): Promise<{ duels: DuelSession[] }> {
  return parseBody(await fetch(archived ? `${DUEL_LIST_KEY}?archived=1` : DUEL_LIST_KEY, { cache: "no-store" }));
}

export async function createDuel(
  name: string,
  mode: DuelMode,
  masterRule: DuelMasterRule = 5,
): Promise<{ session: DuelSession }> {
  return parseBody(
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mode, masterRule }),
    }),
  );
}

export async function getDuelRoom(slug: string): Promise<DuelRoom> {
  return parseBody(await fetch(duelRoomKey(slug), { cache: "no-store" }));
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
