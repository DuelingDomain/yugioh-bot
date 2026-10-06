/** One process-wide budget for catalog and image requests, including response bodies. */
function positiveIntegerSetting(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// Leave room under the upstream budget for the bot, web and duel processes.
const START_INTERVAL_MS = Math.ceil(1000 / positiveIntegerSetting("CARD_FETCH_REQUESTS_PER_SECOND", 5));
const QUEUE_LIMIT = positiveIntegerSetting("CARD_FETCH_QUEUE_LIMIT", 1024);
const queue: Array<() => void> = [];
const backoff = new Map<string, number>();
let active = 0;
let nextStart = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export class CardFetchError extends Error {
  constructor(public readonly retryAfter = 1, public readonly status?: number) {
    super("Could not reach the card database. Try again shortly.");
    this.name = "CardFetchError";
  }
}

export function isCardFetchError(error: unknown): error is CardFetchError {
  return error instanceof CardFetchError || (error instanceof Error && error.message.startsWith("Could not reach the card database"));
}

function drain(): void {
  if (!queue.length || active >= 4) return;
  const delay = nextStart - Date.now();
  if (delay > 0) {
    timer ??= setTimeout(() => { timer = undefined; drain(); }, delay);
    return;
  }
  active++;
  nextStart = Date.now() + START_INTERVAL_MS;
  queue.shift()!();
  drain();
}

function schedule<T>(work: () => Promise<T>): Promise<T> {
  if (queue.length >= QUEUE_LIMIT) return Promise.reject(new CardFetchError());
  return new Promise((resolve, reject) => {
    queue.push(() => {
      void work().then(resolve, reject).finally(() => { active--; drain(); });
    });
    drain();
  });
}

type ResponseStatus = Pick<Response, "ok"> & Partial<Pick<Response, "status" | "headers">>;

/** No retry inside a user action. Fail fast during an upstream rate-limit cooldown. */
export function fetchCardResource<R extends ResponseStatus, T>(
  input: string | URL,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<R>,
  read: (response: R) => Promise<T>,
  allowedStatuses: number[] = [],
): Promise<T> {
  const origin = new URL(input).origin;
  const checkBackoff = () => {
    const remaining = (backoff.get(origin) ?? 0) - Date.now();
    if (remaining > 0) throw new CardFetchError(Math.ceil(remaining / 1000));
  };
  try { checkBackoff(); } catch (error) { return Promise.reject(error); }
  return schedule(async () => {
    checkBackoff();
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new CardFetchError());
        }, 8000);
      });
      const request = (async () => {
        const response = await fetchImpl(input, { signal: controller.signal, redirect: "error" });
        if (response.status === 429) {
          const value = response.headers?.get("Retry-After");
          const seconds = value && /^\d+(\.\d+)?$/.test(value) ? Number(value)
            : value ? (Date.parse(value) - Date.now()) / 1000 : 1;
          const delay = Number.isFinite(seconds) ? Math.max(1, seconds) : 1;
          backoff.set(origin, Math.max(backoff.get(origin) ?? 0, Date.now() + delay * 1000));
          throw new CardFetchError(Math.ceil(delay), 429);
        }
        if (!response.ok && !allowedStatuses.includes(response.status ?? 0)) throw new CardFetchError(1, response.status);
        return read(response);
      })();
      return await Promise.race([request, timeout]);
    } catch (error) {
      if (isCardFetchError(error)) throw error;
      throw new CardFetchError();
    } finally {
      clearTimeout(deadline);
      // Error responses and no-match bodies can still be streaming. Close the
      // socket before releasing the request slot, even when no body was read.
      controller.abort();
    }
  });
}

/** API image metadata must not send a server request to another host or follow redirects. */
export function trustedCardImageUrl(stored: string | null | undefined, fallback: string): string {
  try {
    const url = new URL(stored ?? "");
    if (url.origin === "https://images.ygoprodeck.com" && !url.username && !url.password) return url.href;
  } catch { /* Use the passcode URL. */ }
  return fallback;
}

export const PROJECT_IGNIS_IMAGE_URL = "https://pics.projectignis.org:2096/pics";

export type CardImageResource<T> = {
  image: T | null;
  source: "ygoprodeck" | "ignis";
  fallbackError?: unknown;
};

/** Ignis hosts engine-only arts as full cards. Try it only for a confirmed primary miss. */
export async function fetchCardImageResource<R extends ResponseStatus, T>(
  input: string | URL,
  passcode: number,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<R>,
  read: (response: R) => Promise<T>,
  allowIgnis = true,
): Promise<CardImageResource<T>> {
  if (!Number.isSafeInteger(passcode) || passcode <= 0) return { image: null, source: "ygoprodeck" };
  const readImage = (response: R) => response.status === 404 ? Promise.resolve(null) : read(response);
  const image = await fetchCardResource(input, fetchImpl, readImage, [404]);
  if (image !== null || !allowIgnis) return { image, source: "ygoprodeck" };
  try {
    return { image: await fetchCardResource(`${PROJECT_IGNIS_IMAGE_URL}/${passcode}.jpg`, fetchImpl, readImage, [404]), source: "ignis" };
  } catch (fallbackError) {
    return { image: null, source: "ignis", fallbackError };
  }
}

export const CARD_BACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="350" viewBox="0 0 240 350"><rect width="240" height="350" rx="10" fill="#341a0a"/><rect x="9" y="9" width="222" height="332" rx="6" fill="#160b05" stroke="#c9822b" stroke-width="8"/><ellipse cx="120" cy="175" rx="68" ry="110" fill="none" stroke="#c9822b" stroke-width="3"/><path d="M120 85L135 155L178 175L135 195L120 265L105 195L62 175L105 155Z" fill="#e9a23f"/><ellipse cx="120" cy="175" rx="10" ry="16" fill="#030201"/></svg>`;
