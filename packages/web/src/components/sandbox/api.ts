import type { CardQuery, DeckCardInfo, DuelFormat, DuelMode, SandboxBoard, SandboxRun } from "@yugidraft/shared/duels";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { getDeckCards, queryDeckCards } from "@/components/decks/api";

/**
 * Browser client of the dev sandbox. Routes follow spec section 4.1; the web gate (W1) answers 401 / 403 / 503
 * and every error body is `{ error: string }`. The card helpers reuse the deck editor's card routes.
 */

export class SandboxRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SandboxRequestError";
    this.status = status;
  }
}

export interface ScenarioSummary {
  id: number;
  name: string;
  format: DuelFormat;
  mode: DuelMode;
  ownerPlayerId: number;
  updatedAt: string;
}

export interface Scenario extends ScenarioSummary {
  board: SandboxBoard;
  run: SandboxRun;
  /** True when the signed-in developer made it. Others get "Save as copy". */
  mine?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  codes: number[];
}

export interface ScenarioInput {
  name: string;
  board: SandboxBoard;
  run: SandboxRun;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new SandboxRequestError("Could not reach the server. Check your connection.", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw new SandboxRequestError(message, res.status);
  }
  if (!body || typeof body !== "object") throw new SandboxRequestError("The server returned an invalid response.", 502);
  return body as T;
}

const send = (method: string, payload?: unknown): RequestInit => ({ method, body: payload === undefined ? undefined : JSON.stringify(payload) });

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const body = await request<{ scenarios?: ScenarioSummary[] }>("/api/sandbox/scenarios", { cache: "no-store" });
  return Array.isArray(body.scenarios) ? body.scenarios : [];
}

export async function getScenario(id: number): Promise<Scenario> {
  const body = await request<{ scenario?: Scenario }>(`/api/sandbox/scenarios/${id}`, { cache: "no-store" });
  if (!body.scenario) throw new SandboxRequestError("The server returned an invalid scenario.", 502);
  return body.scenario;
}

export async function createScenario(input: ScenarioInput): Promise<Scenario> {
  const body = await request<{ scenario?: Scenario }>("/api/sandbox/scenarios", send("POST", input));
  if (!body.scenario) throw new SandboxRequestError("The server returned an invalid scenario.", 502);
  return body.scenario;
}

export async function updateScenario(id: number, input: ScenarioInput): Promise<Scenario> {
  const body = await request<{ scenario?: Scenario }>(`/api/sandbox/scenarios/${id}`, send("PUT", input));
  if (!body.scenario) throw new SandboxRequestError("The server returned an invalid scenario.", 502);
  return body.scenario;
}

export async function deleteScenario(id: number): Promise<void> {
  await request<Record<string, unknown>>(`/api/sandbox/scenarios/${id}`, send("DELETE"));
}

/** Server check of every code and the compiled board. No engine start. */
export async function validateSandbox(board: SandboxBoard, signal?: AbortSignal): Promise<ValidateResult> {
  const body = await request<Partial<ValidateResult>>("/api/sandbox/validate", { ...send("POST", { board }), signal });
  return { ok: body.ok === true, errors: Array.isArray(body.errors) ? body.errors : [], codes: Array.isArray(body.codes) ? body.codes : [] };
}

/** Starts the duel at the Draw Phase. Returns the duel slug. */
export async function startSandbox(input: { board: SandboxBoard; run: SandboxRun; scenarioId?: number }): Promise<{ slug: string }> {
  const body = await request<{ slug?: string }>("/api/sandbox/start", send("POST", input));
  if (typeof body.slug !== "string" || !body.slug) throw new SandboxRequestError("The server returned an invalid duel.", 502);
  return { slug: body.slug };
}

// ---------------------------------------------------------------------------------------------
// Card helpers for the builder

export interface BuilderServices {
  /** Top hits for a typed text. */
  search: (text: string, limit: number, signal?: AbortSignal) => Promise<DeckCardInfo[]>;
  /** Card data for passcodes the board holds. */
  lookup: (codes: number[]) => Promise<DeckCardInfo[]>;
  start: (input: { board: SandboxBoard; run: SandboxRun; scenarioId?: number }) => Promise<{ slug: string }>;
}

export function textQuery(text: string, limit: number): CardQuery {
  return { ...emptyCardQuery(), text, limit, offset: 0 };
}

export const defaultServices: BuilderServices = {
  search: async (text, limit, signal) => (await queryDeckCards(textQuery(text, limit), signal)).cards,
  lookup: async (codes) => (codes.length ? (await getDeckCards(codes)).cards : []),
  start: startSandbox,
};

/** The exact name when the hits hold it (case blind), else the first hit. Names go to the server once each. */
export function pickByName(name: string, cards: readonly DeckCardInfo[]): DeckCardInfo | undefined {
  const key = name.trim().toLowerCase();
  return cards.find((card) => card.name.toLowerCase() === key) ?? cards[0];
}
