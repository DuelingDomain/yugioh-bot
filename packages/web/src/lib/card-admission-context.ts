import type { DuelMode } from "@yugidraft/shared/duels";

export type CardAdmissionContext = { mode?: DuelMode; slug?: string };
/** Context affects availability only; query filters and card identities stay separate. */
export function cardAdmissionContext(body: unknown): CardAdmissionContext {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid card request");
  const { mode, slug } = body as Record<string, unknown>;
  if (mode !== undefined && mode !== "normal" && mode !== "domain") throw new Error("Invalid duel mode");
  if (slug !== undefined && (typeof slug !== "string" || !slug || slug.length > 128)) throw new Error("Invalid duel slug");
  return { ...(mode !== undefined ? { mode } : {}), ...(slug !== undefined ? { slug: slug as string } : {}) };
}
