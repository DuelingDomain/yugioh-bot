import { createTalkLimiter } from "@yugidraft/shared/ws";

type Limiter = ReturnType<typeof createTalkLimiter>;
const KEY = Symbol.for("yugidraft.draftTalkLimiter");

/**
 * One cooldown for the whole web process. It lives on globalThis so every copy of the route
 * module (dev reloads, separate bundles) shares it.
 */
export function talkLimiter(): Limiter {
  const store = globalThis as unknown as Record<symbol, Limiter | undefined>;
  return (store[KEY] ??= createTalkLimiter());
}

/** For tests. */
export function resetTalkLimiter() {
  (globalThis as unknown as Record<symbol, Limiter | undefined>)[KEY] = undefined;
}
