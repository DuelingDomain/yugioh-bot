import type { ClerkBackend, ClerkUserJson } from "@yugidraft/shared/clerk";
import { OpsError, outcomeReport, withRateLimit, type OpsContext } from "./report.js";

type Candidate = { id: number; email: string; username: string };
const normalize = (email: string) => email.trim().toLowerCase();

async function chooseUsername(ctx: OpsContext, backend: ClerkBackend, user: Candidate): Promise<string> {
  const sanitized = user.username.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const base = (sanitized || `duelist_${user.id}`).slice(0, 64).padEnd(4, "_");
  for (let attempt = 0; attempt < 1000; attempt++) {
    const suffix = attempt === 0 ? "" : `_${attempt}`;
    const username = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (ctx.db.prepare("select 1 from users where id != ? and lower(username)=? limit 1").get(user.id, username)) continue;
    if ((await withRateLimit(ctx, () => backend.listUsers({ username }))).length > 0) continue;
    return username;
  }
  throw new OpsError("Could not allocate an import username");
}

function matches(user: ClerkUserJson, local: Candidate): boolean {
  return user.external_id === String(local.id) && user.email_addresses.some(e => normalize(e.email_address) === local.email);
}

export async function precreateUsers(ctx: OpsContext) {
  const { report, add } = outcomeReport(ctx.apply);
  const candidates = ctx.db.prepare<[], Candidate>("select id,email,username from users where clerk_user_id is null and email_verified=1 and discord_user_id is not null order by id").all();
  const duplicates = new Set(ctx.db.prepare<[], { email: string }>("select email from users where email is not null group by email having count(*)>1").all().map(row => row.email));
  if ((ctx.apply || ctx.checkRemote) && !ctx.backend) throw new OpsError("CLERK_SECRET_KEY is required for remote checks or apply");
  for (const user of candidates) {
    if (duplicates.has(user.email)) { add({ userId: user.id, outcome: "duplicate_email" }); continue; }
    if (!ctx.apply && !ctx.checkRemote) { add({ userId: user.id, outcome: "would_create" }); continue; }
    try {
      const backend = ctx.backend!;
      const existing = await withRateLimit(ctx, () => backend.listUsers({ externalId: String(user.id) }));
      let remote: ClerkUserJson;
      let outcome: string;
      if (existing.length > 0) {
        if (existing.length !== 1 || !matches(existing[0], user) || !existing[0].username || !/^[a-z0-9_]{4,64}$/.test(existing[0].username)) {
          add({ userId: user.id, outcome: "conflict" }); continue;
        }
        remote = existing[0]; outcome = "resumed";
        if (ctx.db.prepare("select 1 from users where id != ? and lower(username)=? limit 1").get(user.id, remote.username!.toLowerCase())) {
          add({ userId: user.id, outcome: "conflict" }); continue;
        }
      } else {
        if ((await withRateLimit(ctx, () => backend.listUsers({ emailAddress: user.email }))).length > 0) {
          add({ userId: user.id, outcome: "conflict" }); continue;
        }
        const username = await chooseUsername(ctx, backend, user);
        if (!ctx.apply) { add({ userId: user.id, outcome: "would_create" }); continue; }
        remote = await withRateLimit(ctx, () => backend.createUser({
          emailAddress: user.email, username, externalId: String(user.id), skipPasswordRequirement: true,
          ...(ctx.skipLegalChecks ? { skipLegalChecks: true } : {}),
        }));
        if (!matches(remote, user) || remote.username !== username) { add({ userId: user.id, outcome: "conflict" }); continue; }
        outcome = "created";
      }
      if (ctx.apply) {
        // Each user commits independently; a remote success followed by a local
        // failure is recovered by externalId on the next invocation.
        ctx.db.transaction(() => {
          const bound = ctx.db.prepare("update users set clerk_user_id=?,username=?,updated_at=current_timestamp where id=? and clerk_user_id is null and email=? and email_verified=1 and discord_user_id is not null")
            .run(remote.id, remote.username, user.id, user.email);
          if (bound.changes !== 1) throw new OpsError("Import identity changed; rerun after stopping writers");
        }).immediate();
      }
      add({ userId: user.id, outcome: ctx.apply ? outcome : "would_resume" });
    } catch {
      // Backend and SQLite errors can contain email addresses. Only publish a
      // bounded outcome; externalId is enough to investigate or resume safely.
      add({ userId: user.id, outcome: "error" });
    }
  }
  return report;
}
