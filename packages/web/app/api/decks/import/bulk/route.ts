import { requireSavedDeckActor, savedDeckErrorResponse } from "@/lib/saved-decks";
import { checkImportList, importListError, readImportBody, saveImportRows } from "@/lib/deck-bulk-import";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;
  const body = await readImportBody(request);
  if (!body.ok) return body.response;
  if (!checkImportList(body.body.rows)) return importListError("rows");
  try {
    return await saveImportRows(actor, body.body.rows);
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}
