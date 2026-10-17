import type { BrowserContext } from "@playwright/test";

export type OpeningTimingEntry = { at: number; page: string; kind: string; detail?: unknown };

/** Measure the browser without adding waits to the application or reading hidden server state. */
export async function recordOpeningTiming(context: BrowserContext): Promise<OpeningTimingEntry[]> {
  const entries: OpeningTimingEntry[] = [];
  await context.exposeBinding("recordOpeningTiming", ({ page }, entry: Omit<OpeningTimingEntry, "page">) => {
    entries.push({ ...entry, page: new URL(page.url()).pathname + new URL(page.url()).search });
  });
  await context.addInitScript(() => {
    const record = (kind: string, detail?: unknown) => {
      void (window as unknown as { recordOpeningTiming: (entry: unknown) => Promise<void> }).recordOpeningTiming({
        at: performance.timeOrigin + performance.now(), kind, detail,
      });
    };
    record("document");
    record("initial-motion", window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full");
    new PerformanceObserver((list) => {
      for (const task of list.getEntries()) record("long-task", { startAt: performance.timeOrigin + task.startTime, duration: task.duration });
    }).observe({ entryTypes: ["longtask"] });
    const nativeFetch = window.fetch;
    window.fetch = async (...args) => {
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = args[1]?.method ?? (input instanceof Request ? input.method : "GET");
      const room = /^\/api\/duels\/[^/]+$/.test(url.pathname) && method === "GET";
      const connection = url.pathname.endsWith("/connection");
      const startedAt = performance.timeOrigin + performance.now();
      if (room || connection) record("request", { path: url.pathname, method });
      const response = await nativeFetch(...args);
      if (room || connection || url.pathname.endsWith("/opening")) {
        record("response-headers", { path: url.pathname, method, status: response.status });
        const recordBody = (body: {
          session?: { status?: string }; mySeat?: number | null; starting?: true;
          opening?: { phase?: string; choice?: string | null; winnerSeat?: number | null };
          engine?: { revision?: number };
        }, bytes: number) => {
          record("response", { path: url.pathname, method, status: response.status, startedAt, bytes,
            sessionStatus: body.session?.status, mySeat: body.mySeat, starting: body.starting,
            opening: body.opening && { phase: body.opening.phase, choice: body.opening.choice, winnerSeat: body.opening.winnerSeat },
            revision: body.engine?.revision });
        };
        const readText = response.text.bind(response);
        response.text = async () => {
          const text = await readText();
          try {
            recordBody(JSON.parse(text), new TextEncoder().encode(text).length);
          } catch {
            // Preserve the application's own handling of HTML and malformed error bodies.
          }
          return text;
        };
        const readJson = response.json.bind(response);
        response.json = async () => {
          const body = await readJson();
          if (body && typeof body === "object") recordBody(body, new TextEncoder().encode(JSON.stringify(body)).length);
          return body;
        };
      }
      return response;
    };
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", ({ data }) => {
          if (typeof data === "string" && data.includes('"duel:changed"')) record("ws-changed", data);
        });
      }
    };
    const seen = new Set<string>();
    const once = (kind: string, detail?: unknown) => {
      if (seen.has(kind)) return;
      seen.add(kind);
      record(kind, detail);
    };
    let painting = false;
    const inspect = () => {
      const status = document.querySelector('[data-testid="opening-status"]')?.textContent ?? "";
      if (status.startsWith("You lose.")) {
        once("result");
        once("opponent-choosing");
      }
      const diceStatus = document.querySelector('[data-testid="dice-status"]')?.textContent ?? "";
      if (/go(?:es)? first/.test(diceStatus)) once("dice-result", diceStatus);
      const opening = document.querySelector('[data-testid="opening-screen"]');
      if (opening?.getAttribute("data-stage") === "start") once("choice-shown", status);
      const field = document.querySelector('[aria-label="Duel field"]');
      if (field && !painting) {
        painting = true;
        once("field-mount");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = field.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && getComputedStyle(field).visibility !== "hidden") {
            once("board-paint", { reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
          }
        }));
      }
      if (field) {
        const images = [...field.querySelectorAll("img")];
        if (images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0)) once("images-loaded", { count: images.length });
        if (field.querySelector("[data-hand-seat] button")) once("hand-mount");
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(inspect).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("load", inspect, true);
      inspect();
    });
  });
  return entries;
}
