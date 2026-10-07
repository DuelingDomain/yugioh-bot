import type { ClerkWaitlistEntryJson } from "@yugidraft/shared/clerk";
import { OpsError, outcomeReport, withRateLimit, type OpsContext } from "./report.js";

export async function reconcileWaitlist(ctx: OpsContext) {
  const { report, add } = outcomeReport(ctx.apply);
  const signups = ctx.db.prepare<[], { id: number; email: string }>("select id,email from waitlist_signups order by id").all();
  if ((ctx.apply || ctx.checkRemote) && !ctx.backend) throw new OpsError("CLERK_SECRET_KEY is required for remote checks or apply");
  for (const signup of signups) {
    if (!ctx.apply && !ctx.checkRemote) { add({ signupId: signup.id, outcome: "would_check" }); continue; }
    try {
      const backend = ctx.backend!;
      if ((await withRateLimit(ctx, () => backend.listUsers({ emailAddress: signup.email }))).length > 0) {
        add({ signupId: signup.id, outcome: "existing_user" }); continue;
      }
      const entries: ClerkWaitlistEntryJson[] = [];
      let offset = 0;
      for (;;) {
        const page = await withRateLimit(ctx, () => backend.listWaitlistEntries({ query: signup.email, offset, limit: 100 }));
        entries.push(...page.data.filter(entry => entry.email_address.trim().toLowerCase() === signup.email.trim().toLowerCase()));
        offset += page.data.length;
        if (offset >= page.totalCount) break;
        if (page.data.length === 0) throw new OpsError("Incomplete waitlist response");
      }
      const blocked = entries.some(entry => entry.status === "rejected" || entry.status === "revoked");
      if (entries.length > 0) { add({ signupId: signup.id, outcome: blocked ? "blocked" : "existing_entry" }); continue; }
      if (!ctx.apply) { add({ signupId: signup.id, outcome: "would_create" }); continue; }
      await withRateLimit(ctx, () => backend.createWaitlistEntry({ emailAddress: signup.email, notify: ctx.notify ?? true }));
      add({ signupId: signup.id, outcome: "created" });
    } catch { add({ signupId: signup.id, outcome: "error" }); }
  }
  return report;
}
