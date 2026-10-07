import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { createUserService, deleteUserAccount, previewUserDeletion } from "@yugidraft/shared/services";
import { OpsError, withRateLimit, type OpsContext } from "./report.js";

type ClerkOutcome = "none" | "skipped" | "would_delete" | "deleted" | "failed";

/**
 * Deletes one account the way the self-serve button does: the Clerk user first (a 404 counts as already
 * gone), then the one-transaction database step. Dry-run by default and offline. The report carries the
 * user ID, the mode and row counts only: no email, Clerk ID or Discord ID.
 */
export async function deleteUser(ctx: OpsContext, userId: number) {
  const fail = (message: string, clerk: ClerkOutcome, extra: object = {}): never => {
    throw new OpsError(message, { status: "failed", userId, clerk, message, ...extra });
  };
  const preview = previewUserDeletion(ctx.db, userId);
  if (!preview.exists) {
    return { status: "not_found", userId, message: "No user with this ID; nothing to do (already deleted, or the ID is wrong)" };
  }
  const needsClerk = preview.hasClerkUser && !ctx.skipClerk;
  const clerkPlan: ClerkOutcome = !preview.hasClerkUser ? "none" : ctx.skipClerk ? "skipped" : "would_delete";
  if (!ctx.apply) {
    return { status: "dry-run", userId, mode: preview.mode, clerk: clerkPlan, message: "Dry run; add --apply to delete" };
  }

  let clerk: ClerkOutcome = clerkPlan === "would_delete" ? "deleted" : clerkPlan;
  if (needsClerk) {
    if (!ctx.backend) fail("CLERK_SECRET_KEY is required to delete the Clerk user (or pass --skip-clerk)", "failed");
    const clerkUserId = createUserService(ctx.db).findById(userId)?.clerkUserId;
    if (clerkUserId) {
      try { await withRateLimit(ctx, () => ctx.backend!.deleteUser(clerkUserId)); }
      catch (error) {
        const status = error instanceof ClerkBackendError ? error.status : 0;
        fail(`Clerk could not delete the user (status ${status}); the database was not changed`, "failed", { clerkStatus: status });
      }
    }
  }

  try {
    const summary = deleteUserAccount(ctx.db, userId);
    const changed = Object.keys(summary.counts).length > 0;
    return {
      status: changed || clerk === "deleted" ? "applied" : "noop", userId, mode: summary.mode, clerk, counts: summary.counts,
      message: changed ? "Account deleted" : "Nothing left to change",
    };
  } catch {
    // Clerk may already be gone: the same command finishes the database step.
    return fail("The database step failed and rolled back; rerun the same command with --apply to finish it", clerk, { databaseRolledBack: true });
  }
}
