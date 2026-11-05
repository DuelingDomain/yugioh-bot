import { createReleaseService, ReleaseError } from "@yugidraft/shared/services";
import { createReleaseEmailOutbox, emailConfig, missingEmailConfig } from "@yugidraft/shared/email";
import { createClerkBackend, ClerkBackendError } from "@yugidraft/shared/clerk";
import { report } from "@yugidraft/shared/observability";
import { getDb } from "./db";
import { ownerJson, requireOwner, requireOwnerMutation } from "./admin-console/creators";

export const releaseContext = () => {
  const db = getDb(), config = emailConfig();
  return { releases: createReleaseService(db), outbox: createReleaseEmailOutbox(db, config), missingConfig: missingEmailConfig(config) };
};
export function releaseClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new ReleaseError("clerk_not_configured", 503);
  return createClerkBackend({ secretKey });
}
export function releaseErrorResponse(error: unknown): Response {
  if (error instanceof ReleaseError) return ownerJson({ error: error.code }, error.status);
  if (error instanceof ClerkBackendError) return ownerJson({ error: "audience_unavailable" }, 502);
  // An exception from storage may contain a private value. Report a fixed error only.
  report(new Error("Release operation failed"), { tags: { operation: "releases" } });
  return ownerJson({ error: "server_error" }, 500);
}
export function privateResponse(response: Response): Response { response.headers.set("cache-control", "private, no-store"); return response; }
export const releaseJson = ownerJson;
export type ReleaseParams = { params: Promise<{ id: string }> };
export async function releaseId(context: ReleaseParams): Promise<string> {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new ReleaseError("invalid_id");
  return id;
}
export async function ownerReleaseRead(run: () => Response | Promise<Response>): Promise<Response> {
  const owner = await requireOwner(); if (!owner.ok) return privateResponse(owner.response);
  try { return await run(); } catch (error) { return releaseErrorResponse(error); }
}
export async function ownerReleaseMutation(request: Request, body: boolean,
  run: (actor: { userId: number; body: Record<string, unknown> }) => Response | Promise<Response>): Promise<Response> {
  const actor = await requireOwnerMutation(request, { body }); if (!actor.ok) return privateResponse(actor.response);
  try { return await run(actor); } catch (error) { return releaseErrorResponse(error); }
}
