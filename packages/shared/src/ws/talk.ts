/**
 * Table talk in the draft room: a player sends one of a few fixed lines to the table.
 * Lines go over the wire as ids, never as free text, so the server can check them and the
 * client decides how they read. A line says nothing about picks.
 */
export const TALK_LINES = [
  { id: "gg", text: "gg" },
  { id: "lol", text: "lol" },
  { id: "nice", text: "nice" },
  { id: "hurry", text: "hurry up" },
  { id: "noway", text: "no way" },
  { id: "gl", text: "gl" },
] as const;

export type TalkLineId = (typeof TALK_LINES)[number]["id"];

/** One player can send a line this often; a quicker one is refused. */
export const TALK_COOLDOWN_MS = 3500;

/** How long a line stays up over a seat. */
export const TALK_SHOW_MS = 2600;

export function isTalkLine(value: unknown): value is TalkLineId {
  return typeof value === "string" && TALK_LINES.some((line) => line.id === value);
}

export function talkText(id: TalkLineId): string {
  return TALK_LINES.find((line) => line.id === id)?.text ?? "";
}

export type TalkLimit = { ok: true } | { ok: false; retryAfterMs: number };

/** Remembers when each sender last talked. A refused attempt does not restart the wait. */
export function createTalkLimiter(options: { cooldownMs?: number; now?: () => number } = {}) {
  const cooldownMs = options.cooldownMs ?? TALK_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const last = new Map<string, number>();
  return {
    take(sender: string): TalkLimit {
      const t = now();
      const before = last.get(sender);
      if (before !== undefined && t - before < cooldownMs) {
        return { ok: false, retryAfterMs: cooldownMs - (t - before) };
      }
      if (last.size > 500) {
        for (const [key, at] of last) if (t - at >= cooldownMs) last.delete(key);
      }
      last.set(sender, t);
      return { ok: true };
    },
  };
}
