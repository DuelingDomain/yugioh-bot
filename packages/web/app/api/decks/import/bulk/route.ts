import { requireSavedDeckActor, savedDeckErrorResponse } from "@/lib/saved-decks";
import { checkImportList, checkImportRateLimit, finishImportRequest, importListError, readImportBody, saveImportRows } from "@/lib/deck-bulk-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;
  const rateLimited = checkImportRateLimit(actor);
  if (rateLimited) return rateLimited;
  try {
    const body = await readImportBody(request);
    if (!body.ok) return body.response;
    if (!checkImportList(body.body.rows)) return importListError("rows");
    return await saveImportRows(actor, body.body.rows);
  } catch (error) {
    return savedDeckErrorResponse(error);
  } finally {
    finishImportRequest(actor);
  }
}
