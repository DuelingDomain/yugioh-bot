import { ExpectedError } from "@yugidraft/shared/observability";
import type { DuelMode } from "@yugidraft/shared/duels";

export type CardAdmissionContext = { mode?: DuelMode; slug?: string };
/** Context affects availability only; query filters and card identities stay separate. */
export function cardAdmissionContext(body: unknown): CardAdmissionContext {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ExpectedError("Invalid card request", 400);
  const { mode, slug } = body as Record<string, unknown>;
  if (mode !== undefined && mode !== "normal" && mode !== "domain") throw new ExpectedError("Invalid duel mode", 400);
  if (slug !== undefined && (typeof slug !== "string" || !slug || slug.length > 128)) throw new ExpectedError("Invalid duel slug", 400);
  return { ...(mode !== undefined ? { mode } : {}), ...(slug !== undefined ? { slug: slug as string } : {}) };
}
