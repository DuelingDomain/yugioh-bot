import { requireSavedDeckActor, savedDeckErrorResponse } from "@/lib/saved-decks";
import { checkImportList, checkImportRateLimit, finishImportPreview, importListError, parseImportSources, readImportBody } from "@/lib/deck-bulk-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;
  const rateLimited = checkImportRateLimit(actor);
  if (rateLimited) return rateLimited;
  const body = await readImportBody(request);
  if (!body.ok) return body.response;
  if (!checkImportList(body.body.sources)) return importListError("sources");
  try {
    const parsed = parseImportSources(body.body.sources);
    if (!parsed.ok) return parsed.response;
    return await finishImportPreview(actor, parsed.rows);
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}
