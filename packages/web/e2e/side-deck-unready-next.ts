/**
 * Test-only stand-ins for next/navigation and socket.io-client in the between-games un-ready harness. The router
 * keeps the room's slug in a tiny store, so a router.replace to /duels/<slug> swaps the room the same
 * way the App Router does (including the transition from BetweenGamesScreen), and every navigation is recorded on window.__navigations for the script.
 */
type Listener = () => void;

declare global {
  interface Window {
    __navigations: string[];
  }
}

const listeners = new Set<Listener>();
let slug = new URLSearchParams(window.location.search).get("slug") ?? "";
window.__navigations = [];

export function currentSlug(): string {
  return slug;
}

export function subscribeSlug(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function go(href: string) {
  window.__navigations.push(href);
  const match = /\/duels\/(?:window\/)?([^/?#]+)/.exec(href);
  if (!match) return;
  slug = decodeURIComponent(match[1]!);
  for (const listener of listeners) listener();
}

const router = { push: go, replace: go, refresh() {}, back() {}, forward() {}, prefetch() {} };

export function useRouter() {
  return router;
}

export function usePathname() {
  return `/duels/${slug}`;
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return { slug };
}

/** socket.io-client stand-in: never connects, so the room keeps polling the HTTP routes. */
export function io() {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    once: () => socket,
    emit: () => socket,
    connect: () => socket,
    disconnect: () => socket,
    close: () => socket,
    removeAllListeners: () => socket,
    io: { on: () => undefined, off: () => undefined },
  };
  return socket;
}
