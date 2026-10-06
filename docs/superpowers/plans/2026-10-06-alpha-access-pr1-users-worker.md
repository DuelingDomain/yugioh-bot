# Alpha Access PR 1: Users and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship application user IDs, a lossless identity migration, verified Discord email capture, and an independent worker while NextAuth and the Discord bot remain operational.

**Architecture:** SQLite `users.id` becomes the integer identity behind players and resource owners; Discord IDs remain explicit external-account attributes. A single worker reads durable draft/tournament deadlines and owns set synchronization and image eviction, publishing committed state to WS and forwarding Discord effects through signed bot HTTP. All consumers deploy together after an offline migration; Clerk authentication and admin removal belong to PR 2.

**Tech Stack:** Node 22.23.2, TypeScript, better-sqlite3, Next.js 16/NextAuth v5, discord.js, Socket.IO, node-cron, Vitest, Playwright, npm workspaces/Turborepo, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-05-alpha-access-clerk-design.md`; authority: `docs/adr/0004-alpha-access-clerk.md`. Read both completely before executing. PR 1 scope is spec lines 53–257, 307–321 (transitional checks), 327–349 (PR 1 scheduling/switch), 419–431, 470–472, and 482–488.

## Global Constraints

- Execute in `/home/imran/orca/workspaces/yugioh-discord-bot/alpha-access`, branch `alpha-access`. Executors are Codex `gpt-6-astra`, reasoning `xhigh`, one task at a time; each receives this section and its complete task, including its file lists and Interfaces.
- Every shell, including read-only inspection, starts with `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`. Verify `node --version` is `v22.23.2`.
- Build shared before consumers: `npm run build --workspace=packages/shared`. Imports resolve to shared/dist.
- `users.id` is a positive safe integer. `session.user.id = String(users.id)`. Parse a canonical positive decimal string exactly once at each server boundary. Never treat users.id as a Discord snowflake; never coerce owner equality.
- Every existing `players.id` and every gameplay FK stays unchanged. Seats, participant IDs, `themeAssignments`, duel organizers and duel claims remain player IDs. Duel tokens are unchanged.
- `users.discord_user_id` is the canonical nullable unique Discord identity. `players.discord_user_id` is nullable compatibility data; synchronize real accounts transactionally and retain recognized legacy test-player keys. An email-only human is not a bot.
- Keep `DISCORD_GUILD_ID` and existing guild values/scoping. Preserve rows for other historical guilds without exposing them through this community's routes. No `COMMUNITY_ID`.
- PR 1 retains NextAuth, membership checks, admin overrides, Discord controls, credentials, bot commands and announcements. No Clerk code/dependency/configuration, import-to-Clerk scripts, inbox, admin removal, branding, legal-page work or PR 2 UI changes.
- `DISCORD_BOT_ENABLED` is true only for literal `1`. Production PR 1 explicitly sets `1`; missing/`0`/`true` disables both bot entrypoints before validation, client construction, HTTP serving, scheduling or registration.
- Worker single replica per SQLite file. Bot runs no migrated schedulers: draft timer, tournament timer, set sync (including empty-cache startup), image eviction. Notification-message cleanup and Discord reminders STAY in bot. Duel-server timers stay there.
- SQLite is the queue; no Redis/BullMQ/pg-boss. No SQLite transaction spans network I/O. Publish committed WS state even when Discord fails. Non-overlapping worker ticks; SIGTERM stops scheduling and drains in-flight work before DB close.
- Local commits on `alpha-access` (and the per-task branches) are authorized for the ORCHESTRATOR only (owner, 2026-10-06); push, PR and merge to main need the owner's go. Task executors never commit: each final checkpoint stages only that task's explicit files and stops for orchestrator review; the orchestrator commits. Never run `git commit`, `git reset --hard`, discard retained docs, push, deploy or message other sessions as part of these implementation tasks.
- This document's creation is DOCS-ONLY: no execution of the steps below is authorized by writing the plan. The plan-writing task creates exactly this file and stages nothing.
- Use package commands from `CLAUDE.md`: `npm test --workspace=packages/shared`, `npm test --workspace=packages/web`, `npm test --workspace=packages/bot`, `npm test --workspace=packages/ws`, `npm test --workspace=packages/duel-server`; worker adds `npm test --workspace=packages/worker`. A focused web run MUST use `npx vitest run packages/web/tests/auth-identity.test.ts -c packages/web/vitest.config.ts` for the auth-identity test; each task gives its exact focused file list.
- Read the actual current files before applying each step. References below are inspected pre-merge line numbers, not patch offsets; re-anchor after T0. Keep unrelated changes from origin/main. One review, one fix pass, one re-review; remaining blockers prevent shipment.
- Evidence belongs in protected `/tmp/alpha-access-pr1-evidence/`, not additional tracked documentation. Do not include credentials or whole identity records in review output. Production rehearsal uses the online backup COPY at `/home/imran/dueling-db-copies/bot-20261006-073526Z.sqlite` (mode 0600; integrity ok; 11 players, 1 guild, no synthetic or orphan owner keys). Never modify that file: copy it into `/tmp/alpha-access-pr1-evidence/` for each rehearsal run. Never touch the live database; no scrubbing is needed for PR 1.

## Review Focus

- A legacy creator with no player, a NULL season creator, or the same Discord account in several guilds must migrate without inventing participants, merging gameplay rows, or losing ownership (T1 mixed fixture).
- A string such as `01`, `1e3`, a numeric JSON session ID, or an old JWT whose `sub` resembles an application ID must never authenticate as that application user (T3/T4 boundary tests).
- An email address that changes or loses Discord verification must lose its old verified flag; an E2E credential user's `email` alone must never verify an address (T1 users and T4 callbacks tests).
- A web request and restarted worker seeing the same expired pick, or a second timer tick arriving during slow HTTP, must commit one transition and still publish state when Discord delivery fails (T7 race/drain tests).
- A missing/disabled bot and a cache file disappearing during eviction must not stop gameplay scheduling; completed tournaments must have one claim owner, without claiming twice across HTTP (T6/T7 switch/effects/cache tests).

---

## Execution order and scope decisions

`T0 → T1 → T2` is strictly sequential. After T2, T3 (draft tokens), T4 (auth), T6 (bot) and T7 (worker) are logically independent. T5 requires T3 + T4; T8 requires T3–T7; T9 requires T8. T6 owns the new shared announce contract and bot handler; T7 consumes the exact contract repeated in its Interfaces and cannot pass its integration gate until T6 is available. The owner authorized parallel execution (2026-10-06). Run T0 → T1 → T2 one at a time on `alpha-access`. After T2 is committed, the orchestrator dispatches T3, T4, T6 and T7 concurrently, **each in its own git worktree on its own branch cut from the T2 commit** (`alpha-access-t3`, `-t4`, `-t6`, `-t7`), never two agents in one checkout (shared/dist builds and the lockfile would collide). The orchestrator reviews, commits and merges each branch back into `alpha-access`. T7's final integration gate runs after T6 is merged. T5 starts after T3 + T4 are merged; T8 after T5–T7; T9 last.

The suggested decomposition is retained with these code-driven adjustments:

- T2 also covers `services/tournament-duels.ts:54,206,355,396`, `services/duel-series.ts:759,788,912` and duel-server test fixtures. The former validates deck ownership against a Discord field; the latter insert players directly and fail the new NOT NULL FK.
- `services/tournament-registrations.ts:34,48` and `services/duels.ts:173` already consume player IDs; `duels/index.ts:89` exposes no owner identity in `SavedDeck`. Verify them and update their fixtures; do not convert gameplay IDs or add unnecessary public fields.
- `web/src/lib/stores/draft-store.ts:21–43` contains seats/player IDs, no user identity. Its regression tests remain; conversion belongs in draft/tournament page DTOs and pool-editor state.
- T6 owns the signed `draft-status` operation, shared notify contract and HTTP handler claim semantics. T7 owns reusable image eviction and changes the bot cleanup wrapper, avoiding simultaneous ownership of that wrapper.
- `db/connection.ts:6–16` does **not** explicitly enable foreign keys despite spec line 167 saying it does. T1 adds it and tests FK enforcement and migration rollback. The schema's existing rebuild approach at `schema.ts:259–313` is real and retained.
- Staging already has no bot (`docker-compose.staging.yml:9–11`); keep that deployment isolation while adding its worker, with Discord effects disabled. Production/dev keep the bot in PR 1.
- Remove `@clerk/nextjs` in T0: the only source-tree reference is its uncommitted manifest entry (`packages/web/package.json:17`); no PR 1 runtime imports justify keeping it. It returns in PR 2.

### Task 0: Remove obsolete S1 and establish the merged baseline

**Files:**
- Delete: `packages/shared/src/services/alpha-invites.ts:1`, `packages/shared/src/services/alpha-access.ts:1`, `packages/shared/src/services/access-events.ts:1`, `packages/shared/src/services/app-users.ts:1`.
- Delete: `packages/shared/tests/services/alpha-invites.test.ts:1`, `packages/shared/tests/services/app-users.test.ts:1` (the latter also tests alpha-access). No separate alpha-access/access-events test files currently exist.
- Modify: `packages/shared/src/services/index.ts:53–60`, `packages/shared/src/db/schema.ts:756–787`, `packages/web/package.json:17`, `package-lock.json` (root/workspace dependency records).
- Preserve: `docs/adr/0004-alpha-access-clerk.md`, `docs/superpowers/specs/2026-10-05-alpha-access-clerk-design.md`, this plan and all other local docs.
- Merge: origin/main's committed file set, enumerated by the exact command below; keep the merge index separate from locally staged task changes until review.

**Interfaces:**
- Consumes: git HEAD on `alpha-access`; inspected `git rev-list --left-right --count HEAD...origin/main` = `0 131`; `migrate(db: Database.Database): void` at schema.ts:16; current services barrel exports.
- Produces: merged historical schema without S1 definitions/exports and without Clerk dependency; shared build plus recorded typecheck/shared/web/bot/ws baseline. Does not perform the identity migration or open a real database.

- [ ] **Step 1: Record and protect the current checkout.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
node --version
git branch --show-current
git status --short
git rev-list --left-right --count HEAD...origin/main
git diff --name-only HEAD..origin/main
git diff -- packages/shared/src/db/schema.ts packages/shared/src/services/index.ts packages/web/package.json package-lock.json
mkdir -p /tmp/alpha-access-pr1-evidence/docs
git diff --binary > /tmp/alpha-access-pr1-evidence/before-s1-cleanup.patch
cp docs/adr/0004-alpha-access-clerk.md docs/superpowers/specs/2026-10-05-alpha-access-clerk-design.md docs/superpowers/plans/2026-10-06-alpha-access-pr1-users-worker.md /tmp/alpha-access-pr1-evidence/docs/
```

Expected: Node v22.23.2, alpha-access, the four modified tracked files and six S1 untracked files reported above, retained docs, no identity-file changes in the 131 incoming commits. If the checkout has advanced, inventory the delta before deleting anything.

- [ ] **Step 2: Delete the superseded source/tests and only their schema/export additions.**

```python
from pathlib import Path
for name in ('alpha-invites', 'alpha-access', 'access-events', 'app-users'):
    Path(f'packages/shared/src/services/{name}.ts').unlink()
for name in ('alpha-invites', 'app-users'):
    Path(f'packages/shared/tests/services/{name}.test.ts').unlink()
p = Path('packages/shared/src/services/index.ts')
p.write_text(''.join(line for line in p.read_text().splitlines(keepends=True)
                     if not any(f'"./{name}.js"' in line for name in
                                ('alpha-invites', 'alpha-access', 'access-events', 'app-users'))))
p = Path('packages/shared/src/db/schema.ts')
source = p.read_text()
start = source.index('  // Closed alpha: Clerk identity, email invites, and the access audit log.')
end = source.index('  migrateConfigPoolsToCubeCards(db);', start)
p.write_text(source[:start] + source[end:])
```

Run under the Node-22 shell using `python3 - <<'PY'` with the block above. This deletes source definitions, not any database tables; T1 supplies the guarded S1 cleanup.

- [ ] **Step 3: Remove Clerk, then perform a non-committing merge.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm uninstall @clerk/nextjs --workspace=packages/web --package-lock-only --ignore-scripts
git diff -- packages/shared/src/db/schema.ts packages/shared/src/services/index.ts packages/web/package.json package-lock.json
git merge --no-ff --no-commit origin/main
git diff --cached --name-only
git diff --check
```

Expected: S1-only tracked edits return to the existing base (inspect any lockfile normalization separately); merge stops before a merge commit. If an incoming tracked doc collides with a retained untracked doc, preserve both versions in the protected evidence directory, restore the approved local contents after the merge, and show that resolution at the checkpoint. Never autostash or commit. Git may refuse the merge if remaining unstaged changes overlap incoming files; preserve their patch, restore only those reviewed S1-only tracked paths, merge, then reapply only still-needed dependency removal.

- [ ] **Step 4: Install the merged lockfile and record baseline results.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm ci
npm run build --workspace=packages/shared
npm run typecheck
npm test --workspace=packages/shared
npm test --workspace=packages/web
npm test --workspace=packages/bot
npm test --workspace=packages/ws
```

Run each command separately and retain stdout, stderr, exit status and merged revision in `/tmp/alpha-access-pr1-evidence/baseline.txt`. Expected: successful shared build; record actual pass/fail counts for each check, rather than assuming this old branch was green. Do not call later failures pre-existing without this evidence. No new tests are needed for deleting unshipped code; these suites provide the baseline.

- [ ] **Checkpoint: stage only this task's files (`packages/shared/src/db/schema.ts`, `packages/shared/src/services/index.ts`, `packages/web/package.json`, `package-lock.json`, and tracked deletions, if any, of `packages/shared/src/services/alpha-invites.ts`, `packages/shared/src/services/alpha-access.ts`, `packages/shared/src/services/access-events.ts`, `packages/shared/src/services/app-users.ts`, `packages/shared/tests/services/alpha-invites.test.ts`, `packages/shared/tests/services/app-users.test.ts`) and stop for orchestrator review; the orchestrator commits.** The merge already stages the exact incoming file list printed in Step 3; include that list in review, do not add retained untracked docs, and wait for the orchestrator to finish the merge before T1.

### Task 1: Application users and the ordered identity migration

**Files:**
- Create: `packages/shared/src/services/users.ts`, `packages/shared/tests/services/users.test.ts`, `packages/shared/tests/db/identity-migration.test.ts`, `packages/shared/tests/db/fixtures/pre-identity.sql`.
- Modify: `packages/shared/src/db/schema.ts:6–16,709–715,754–790`, `packages/shared/src/db/connection.ts:6–16`, `packages/shared/src/services/index.ts:12`.
- Modify test: `packages/shared/tests/db/connection.test.ts:19–30` (assert FK enablement and rejection).
- Read: `packages/shared/tests/db/schema.test.ts:1–115`, `packages/shared/src/services/draft-decks.ts:22,155–200`; leave existing application fixture conversions to T2.

**Interfaces:**
- Consumes: `migrate(db: Database.Database): void`; `openDatabase(path?: string): Database.Database`; better-sqlite3 immediate transactions and `pragma(name, { simple: true })`.
- Produces: `User` and `createUserService(db): UserService` with the exact interface below; same `migrate`/`openDatabase` signatures; six rebuilt tables and indexes from the approved SQL. Add `export * from "./users.js"` to the services barrel.

```ts
export interface User {
  id: number;
  clerkUserId: string | null;
  email: string | null;
  emailVerified: boolean;
  username: string;
  displayName: string;
  discordUserId: string | null;
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
}
export interface DiscordUserInput {
  discordUserId: string;
  displayName: string;
  // Omitted = preserve email (bot/JWT lookup); null = clear provider email.
  email?: string | null;
  emailVerified?: boolean;
}
export interface UserService {
  findById(id: number): User | undefined;
  findByDiscordId(discordUserId: string): User | undefined;
  ensureDiscord(input: DiscordUserInput): User;
  createNonLogin(displayName: string): User;
}
```

- [ ] **Step 1: Freeze the real pre-identity schema before changing migrate.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
node --input-type=module <<'JS'
import Database from 'better-sqlite3';
import { migrate } from './packages/shared/dist/db/schema.js';
import { mkdirSync, writeFileSync } from 'node:fs';
const db = new Database(':memory:');
migrate(db);
const rows = db.prepare("select sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 else 1 end, name").all();
mkdirSync('packages/shared/tests/db/fixtures', { recursive: true });
writeFileSync('packages/shared/tests/db/fixtures/pre-identity.sql', rows.map(r => r.sql + ';').join('\n\n') + '\n');
db.close();
JS
```

Expected: a text fixture of T0's actual historical schema, including children/indexes, no users or S1 tables. Include it in this task’s checkpoint; tests never generate their expected schema from the new migration.

- [ ] **Step 2: Add the migration fixtures and failing preservation tests.** In the new identity-migration test use these helpers and tests, then add the additional cases immediately following them.

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";

const handles: Database.Database[] = [];
const names = ["players", "tournaments", "cubes", "drafts", "seasons", "saved_decks"] as const;
function legacy() {
  const db = new Database(":memory:");
  handles.push(db);
  db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
  db.pragma("foreign_keys = on");
  return db;
}
function mixed(db: Database.Database) {
  db.exec(`
    insert into players(id,guild_id,discord_user_id,display_name,created_at) values
      (41,'g','900000000000000101','First','2020-01-01'),
      (42,'other','900000000000000101','Later','2021-01-01'),
      (43,'g','bot_player_dev_1','Bot 1','2020-01-02'),
      (44,'g','tournament_bot_dev_1','Tournament bot','2020-01-03'),
      (45,'g','fake_yugi','Yugi','2020-01-04');
    insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
      values(11,'g','Cup','round_robin','completed','900000000000000102','cup');
    insert into cubes(id,guild_id,name,created_by_user_id,config_json)
      values(12,'other','Pool','900000000000000101','{"copyLimit":true}');
    insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,tournament_id,config_json)
      values(13,'g','channel','Draft','completed','900000000000000101','draft',11,'{"themeAssignments":{"41":12}}');
    insert into seasons(id,guild_id,number,status,created_by_user_id) values
      (14,'g',1,'ended',null),(15,'other',1,'ended','system');
    insert into saved_decks(id,guild_id,owner_user_id,name,mode,deck_json,draft_id)
      values(16,'g','900000000000000101','Deck','normal','{"main":[1],"extra":[],"side":[]}',13);
    insert into draft_players(draft_id,player_id) values(13,41);
    insert into tournament_participants(tournament_id,player_id,saved_deck_id,deck_json)
      values(11,41,16,'{"main":[1],"extra":[],"side":[]}');
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,snapshot_public_json)
      values(21,'g','duel','Duel',41,'normal','completed','{"seats":[41]}');
    insert into duel_seats(duel_id,seat,player_id) values(21,0,41);
    update sqlite_sequence set seq=900 where name in ('players','tournaments','cubes','drafts','seasons','saved_decks');
  `);
}
function count(db: Database.Database, table: string) {
  return (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
}
afterEach(() => { vi.restoreAllMocks(); for (const db of handles.splice(0)) db.close(); });

it("creates the target on a fresh DB and migrates twice", () => {
  const db = new Database(":memory:"); handles.push(db);
  migrate(db); migrate(db);
  expect(db.pragma("table_info(players)")).toContainEqual(expect.objectContaining({ name: "user_id", type: "INTEGER", notnull: 1 }));
  expect(db.pragma("table_info(drafts)")).toContainEqual(expect.objectContaining({ name: "channel_id", notnull: 0 }));
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("preserves IDs, all five owners, other guilds, decks and snapshots", () => {
  const db = legacy(); mixed(db);
  const before = names.map(name => count(db, name));
  migrate(db);
  expect(names.map(name => count(db, name))).toEqual(before);
  const human = db.prepare("select * from users where discord_user_id='900000000000000101'").get() as { id: number; display_name: string; email: null };
  expect(human).toMatchObject({ display_name: "First", email: null });
  expect(db.prepare("select id,user_id from players where id in (41,42) order by id").all()).toEqual([{ id: 41, user_id: human.id }, { id: 42, user_id: human.id }]);
  expect(db.prepare("select created_by_user_id from cubes where id=12").get()).toEqual({ created_by_user_id: human.id });
  expect(db.prepare("select created_by_user_id,config_json from drafts where id=13").get()).toEqual({ created_by_user_id: human.id, config_json: '{"themeAssignments":{"41":12}}' });
  expect(db.prepare("select owner_user_id,deck_json from saved_decks where id=16").get()).toEqual({ owner_user_id: human.id, deck_json: '{"main":[1],"extra":[],"side":[]}' });
  expect(db.prepare("select created_by_user_id from seasons where id=14").get()).toEqual({ created_by_user_id: null });
  expect(db.prepare("select u.discord_user_id from tournaments t join users u on u.id=t.created_by_user_id where t.id=11").get()).toEqual({ discord_user_id: "900000000000000102" });
  expect(db.prepare("select u.discord_user_id from seasons s join users u on u.id=s.created_by_user_id where s.id=15").get()).toEqual({ discord_user_id: null });
  expect(db.prepare("select p.id,u.discord_user_id from players p join users u on u.id=p.user_id where p.id>=43 order by p.id").all()).toEqual([43,44,45].map(id => ({ id, discord_user_id: null })));
  expect(db.prepare("select snapshot_public_json from duels where id=21").get()).toEqual({ snapshot_public_json: '{"seats":[41]}' });
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  for (const name of names) expect((db.prepare("select seq from sqlite_sequence where name=?").get(name) as { seq: number }).seq).toBeGreaterThanOrEqual(900);
  const snapshot = db.prepare("select * from users order by id").all();
  migrate(db);
  expect(db.prepare("select * from users order by id").all()).toEqual(snapshot);
});
it("rolls back an injected copy/drop failure and restores FK enforcement", () => {
  const db = legacy(); mixed(db);
  const original = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => {
    if (/drop table players\s*;/i.test(sql)) throw new Error("injected drop failure");
    return original(sql);
  });
  expect(() => migrate(db)).toThrow("injected drop failure");
  expect(db.inTransaction).toBe(false);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("table_info(players)")).not.toContainEqual(expect.objectContaining({ name: "user_id" }));
  expect(count(db, "players")).toBe(5);
  expect(db.prepare("select name from sqlite_master where name like '%_identity_new'").all()).toEqual([]);
});
it("rejects partial shape before historical backfill writes", () => {
  const db = legacy(); mixed(db);
  db.exec("alter table players add column user_id integer not null default 1");
  expect(() => migrate(db)).toThrow(/partial identity schema/i);
  expect(db.prepare("select deck_saved_at from draft_players").get()).toEqual({ deck_saved_at: null });
});
it.each(["alpha_invites", "access_events", "app_users"])("refuses nonempty S1 %s before mutation", table => {
  const db = legacy();
  db.exec(`create table ${table}(id integer); insert into ${table} values(1)`);
  expect(() => migrate(db)).toThrow(/S1.*not empty/i);
  expect(count(db, table)).toBe(1);
  expect(db.prepare("select name from sqlite_master where name='users'").get()).toBeUndefined();
});
it("drops only empty S1 tables", () => {
  const db = legacy();
  db.exec("create table alpha_invites(id); create table access_events(id); create table app_users(id)");
  migrate(db);
  expect(db.prepare("select name from sqlite_master where name in ('alpha_invites','access_events','app_users')").all()).toEqual([]);
});
```

Run: `npx vitest run packages/shared/tests/db/identity-migration.test.ts`.
Expected: FAIL because players.user_id is absent and migration does not reject partial/S1 states yet.

- [ ] **Step 3: Add exact SQL constants in schema.ts.** Keep the historical migrations, then invoke `migrateIdentity(db)` after `migrateConfigPoolsToCubeCards(db)`. The replacement-table, copy and index constants below are literal copies of the approved spec; do not rename old tables first.


```ts
const IDENTITY_TABLE_SQL = `
create table if not exists users (
  id integer primary key autoincrement,
  clerk_user_id text unique,
  email text check (email is null or email = lower(trim(email))),
  email_verified integer not null default 0 check (email_verified in (0, 1)),
  username text not null,
  display_name text not null,
  discord_user_id text unique,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  synced_at text,
  check (email_verified = 0 or email is not null)
);
create index if not exists users_email_idx on users(email) where email is not null;

create table players_identity_new (
  id integer primary key autoincrement,
  guild_id text not null,
  user_id integer not null references users(id),
  discord_user_id text,
  display_name text not null,
  created_at text not null default current_timestamp,
  unique (guild_id, user_id),
  unique (guild_id, discord_user_id)
);
create table tournaments_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, format text not null, status text not null,
  created_by_user_id integer not null references users(id),
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, completed_announced_at text, deadline_at text,
  report_confirm_window_hours integer, best_of integer not null default 3, duel_rules_json text
);
create table cubes_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, archetype text, banlist text,
  config_json text not null default '{}',
  created_by_user_id integer not null references users(id),
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  unique (guild_id, name)
);
create table drafts_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, channel_id text, name text not null, status text not null,
  created_by_user_id integer not null references users(id),
  config_json text not null default '{}',
  current_wave_number integer not null default 0, current_pick_step integer not null default 0,
  pick_deadline_at text, status_message_id text,
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, tournament_id integer references tournaments(id), complete_message_id text
);
create table seasons_identity_new (
  id integer primary key autoincrement,
  guild_id text not null, number integer not null, name text, status text not null,
  started_at text not null default current_timestamp, ended_at text,
  created_by_user_id integer references users(id)
);
create table saved_decks_identity_new (
  id integer primary key autoincrement,
  guild_id text not null,
  owner_user_id integer not null references users(id),
  name text not null, mode text not null, deck_json text not null,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  draft_id integer references drafts(id) on delete set null
);
`;
```

```ts
const IDENTITY_COPY_SQL = `
insert into players_identity_new
  select id, guild_id, (select user_id from identity_key_map where legacy_key = p.discord_user_id),
    discord_user_id, display_name, created_at from players p;
insert into tournaments_identity_new
  select id, guild_id, name, format, status,
    (select user_id from identity_key_map where legacy_key = t.created_by_user_id),
    created_at, started_at, ended_at, web_slug, completed_announced_at, deadline_at,
    report_confirm_window_hours, best_of, duel_rules_json from tournaments t;
insert into cubes_identity_new
  select id, guild_id, name, archetype, banlist, config_json,
    (select user_id from identity_key_map where legacy_key = c.created_by_user_id),
    created_at, updated_at from cubes c;
insert into drafts_identity_new
  select id, guild_id, channel_id, name, status,
    (select user_id from identity_key_map where legacy_key = d.created_by_user_id),
    config_json, current_wave_number, current_pick_step, pick_deadline_at, status_message_id,
    created_at, started_at, ended_at, web_slug, tournament_id, complete_message_id from drafts d;
insert into seasons_identity_new
  select id, guild_id, number, name, status, started_at, ended_at,
    (select user_id from identity_key_map where legacy_key = s.created_by_user_id) from seasons s;
insert into saved_decks_identity_new
  select id, guild_id, (select user_id from identity_key_map where legacy_key = s.owner_user_id),
    name, mode, deck_json, created_at, updated_at, draft_id from saved_decks s;
`;
```

```ts
const IDENTITY_INDEX_SQL = `
create index if not exists players_user_idx on players(user_id);
create unique index if not exists tournaments_current_name_unique
  on tournaments(guild_id, name) where status in ('pending', 'active');
create unique index if not exists tournaments_web_slug_unique
  on tournaments(web_slug) where web_slug is not null;
create index if not exists tournaments_creator_idx on tournaments(created_by_user_id);
create index if not exists cubes_creator_idx on cubes(created_by_user_id);
create unique index if not exists drafts_current_name_unique
  on drafts(guild_id, name) where status in ('pending', 'active');
create index if not exists drafts_creator_idx on drafts(created_by_user_id);
create unique index if not exists seasons_one_active on seasons(guild_id) where status = 'active';
create index if not exists seasons_creator_idx on seasons(created_by_user_id);
create index if not exists saved_decks_owner_list_idx on saved_decks(guild_id, owner_user_id, updated_at);
create unique index if not exists saved_decks_owner_draft_idx
  on saved_decks(guild_id, owner_user_id, draft_id) where draft_id is not null;
`;
```

- [ ] **Step 4: Implement migration classification, allocation and guarded rebuild.** Put these private helpers in schema.ts. Invoke `assertS1Empty` and `identityShape` at the start of `migrate` before historical writes, even when players is absent; an absent old table is allowed only if no new identity marker exists. A completed shape must also have users and the declared users FKs. Preserve unknown schema objects by aborting with their names; do not silently drop custom columns, triggers or indexes.

```ts
const identityTables = ["players", "tournaments", "cubes", "drafts", "seasons", "saved_decks"] as const;
const ownerColumns = { tournaments: "created_by_user_id", cubes: "created_by_user_id", drafts: "created_by_user_id", seasons: "created_by_user_id", saved_decks: "owner_user_id" } as const;
type Column = { name: string; type: string; notnull: number };
function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name));
}
function assertS1Empty(db: Database.Database): void {
  for (const name of ["alpha_invites", "access_events", "app_users"]) {
    if (tableExists(db, name) && (db.prepare(`select count(*) as n from ${name}`).get() as { n: number }).n !== 0) {
      throw new Error(`S1 table ${name} is not empty; reconcile a backup before migration`);
    }
  }
}
function identityShape(db: Database.Database): "old" | "new" {
  const playerCols = db.pragma("table_info(players)") as Column[];
  const userCol = playerCols.find(c => c.name === "user_id");
  const owners = Object.entries(ownerColumns).map(([table, name]) =>
    (db.pragma(`table_info(${table})`) as Column[]).find(c => c.name === name));
  const marked = Boolean(userCol) || owners.some(c => c?.type.toUpperCase() === "INTEGER");
  if (!marked) return "old";
  const complete = userCol?.type.toUpperCase() === "INTEGER" && userCol.notnull === 1
    && owners.every(c => c?.type.toUpperCase() === "INTEGER") && tableExists(db, "users");
  if (!complete) throw new Error("Partial identity schema; reconcile before startup");
  for (const table of identityTables) {
    const column = table === "players" ? "user_id" : ownerColumns[table];
    const fks = db.pragma(`foreign_key_list(${table})`) as Array<{ table: string; from: string; to: string }>;
    if (!fks.some(fk => fk.table === "users" && fk.from === column && fk.to === "id")) {
      throw new Error(`Partial identity schema: ${table}.${column} has no users FK`);
    }
  }
  return "new";
}
function legacyKind(key: string): "discord" | "local" {
  if (/^[0-9]{1,25}$/.test(key)) return "discord";
  if (/^bot_player_dev_[1-9][0-9]*$/.test(key) || /^tournament_bot_dev_[1-3]$/.test(key)
    || new Set(["fake_yugi", "fake_kaiba", "fake_joey", "fake_pegasus", "seed", "system"]).has(key)) return "local";
  throw new Error(`Unknown synthetic identity format: ${key}; reconcile before migration`);
}
function importedUsername(name: string, id: number): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return stem ? `${stem}_${id}` : `duelist_${id}`;
}
function assertIdentitySourceShape(db: Database.Database): void {
  const expected: Record<string, string[]> = {
    players: ["id","guild_id","discord_user_id","display_name","created_at"],
    tournaments: ["id","guild_id","name","format","status","created_by_user_id","created_at","started_at","ended_at","web_slug","completed_announced_at","deadline_at","report_confirm_window_hours","best_of","duel_rules_json"],
    cubes: ["id","guild_id","name","archetype","banlist","config_json","created_by_user_id","created_at","updated_at"],
    drafts: ["id","guild_id","channel_id","name","status","created_by_user_id","config_json","current_wave_number","current_pick_step","pick_deadline_at","status_message_id","created_at","started_at","ended_at","web_slug","tournament_id","complete_message_id"],
    seasons: ["id","guild_id","number","name","status","started_at","ended_at","created_by_user_id"],
    saved_decks: ["id","guild_id","owner_user_id","name","mode","deck_json","created_at","updated_at","draft_id"],
  };
  const indexes = new Set(["tournaments_current_name_unique", "tournaments_web_slug_unique", "drafts_current_name_unique", "seasons_one_active", "saved_decks_owner_list_idx", "saved_decks_owner_draft_idx"]);
  for (const table of identityTables) {
    const columns = (db.pragma(`table_info(${table})`) as Column[]).map(c => c.name).sort();
    if (JSON.stringify(columns) !== JSON.stringify([...expected[table]].sort())) throw new Error(`Unexpected columns on ${table}; preserve explicitly before rebuild`);
    const objects = db.prepare("select name,type,sql from sqlite_master where tbl_name=? and type in ('index','trigger') and sql is not null").all(table) as Array<{ name: string; type: string; sql: string }>;
    for (const object of objects) if (object.type === "trigger" || !indexes.has(object.name)) {
      throw new Error(`Unexpected ${object.type} ${object.name}; preserve explicitly before rebuild`);
    }
  }
}
function migrateIdentity(db: Database.Database): void {
  if (db.inTransaction) throw new Error("Identity migration requires an outer connection");
  assertS1Empty(db);
  identityShape(db);
  const foreignKeys = Number(db.pragma("foreign_keys", { simple: true }));
  try {
    db.pragma("foreign_keys = off");
    db.exec("begin immediate");
    assertS1Empty(db);
    if (identityShape(db) === "new") {
      db.exec("drop table if exists alpha_invites; drop table if exists access_events; drop table if exists app_users;");
      db.exec("commit");
      return;
    }
    assertIdentitySourceShape(db);
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Invalid source foreign keys");
    const counts = new Map(identityTables.map(table => [table, (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n]));
    const highWater = new Map(identityTables.map(table => [table, (db.prepare("select seq from sqlite_sequence where name=?").get(table) as { seq: number } | undefined)?.seq ?? 0]));
    // Read guild counts before rebuilding; compare again before COMMIT.
    const guilds = new Map(identityTables.map(table => [table, JSON.stringify(db.prepare(`select guild_id,count(*) n from ${table} group by guild_id order by guild_id`).all())]));
    const keys = db.prepare(`select discord_user_id as legacy_key from players
      union select created_by_user_id from tournaments
      union select created_by_user_id from cubes
      union select created_by_user_id from drafts
      union select created_by_user_id from seasons where created_by_user_id is not null
      union select owner_user_id from saved_decks order by legacy_key`).all() as Array<{ legacy_key: string }>;
    for (const { legacy_key } of keys) legacyKind(legacy_key);
    db.exec(IDENTITY_TABLE_SQL);
    db.exec("create temp table identity_key_map (legacy_key text primary key, user_id integer not null)");
    for (const { legacy_key } of keys) {
      const kind = legacyKind(legacy_key);
      const first = db.prepare("select display_name,created_at from players where discord_user_id=? order by created_at asc,id asc,guild_id asc limit 1").get(legacy_key) as { display_name: string; created_at: string } | undefined;
      const name = first?.display_name ?? (kind === "discord" ? `Duelist ${legacy_key}` : legacy_key);
      const existing = kind === "discord" ? db.prepare("select id from users where discord_user_id=?").get(legacy_key) as { id: number } | undefined : undefined;
      const id = existing?.id ?? Number(db.prepare(`insert into users(username,display_name,discord_user_id,created_at,updated_at)
        values('',?,?,coalesce(?,current_timestamp),coalesce(?,current_timestamp))`).run(name, kind === "discord" ? legacy_key : null, first?.created_at ?? null, first?.created_at ?? null).lastInsertRowid);
      if (!existing) db.prepare("update users set username=? where id=?").run(importedUsername(name, id), id);
      db.prepare("insert into identity_key_map(legacy_key,user_id) values(?,?)").run(legacy_key, id);
    }
    db.exec(IDENTITY_COPY_SQL);
    for (const table of identityTables) {
      const copied = (db.prepare(`select count(*) as n from ${table}_identity_new`).get() as { n: number }).n;
      if (copied !== counts.get(table)) throw new Error(`Identity count mismatch: ${table}`);
    }
    for (const table of identityTables) db.exec(`drop table ${table}; alter table ${table}_identity_new rename to ${table};`);
    db.exec(IDENTITY_INDEX_SQL);
    for (const table of identityTables) {
      const maximum = (db.prepare(`select coalesce(max(id),0) as n from ${table}`).get() as { n: number }).n;
      const sequence = Math.max(highWater.get(table)!, maximum);
      db.prepare("delete from sqlite_sequence where name=?").run(table);
      db.prepare("insert into sqlite_sequence(name,seq) values(?,?)").run(table, sequence);
      if (JSON.stringify(db.prepare(`select guild_id,count(*) n from ${table} group by guild_id order by guild_id`).all()) !== guilds.get(table)) throw new Error(`Identity guild mismatch: ${table}`);
    }
    db.exec("drop table identity_key_map; drop table if exists alpha_invites; drop table if exists access_events; drop table if exists app_users;");
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Invalid migrated foreign keys");
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Identity integrity check failed");
    db.exec("commit");
  } catch (error) {
    if (db.inTransaction) db.exec("rollback");
    throw error;
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    if (Number(db.pragma("foreign_keys", { simple: true })) !== foreignKeys) throw new Error("Failed to restore foreign_keys");
  }
}
```

Known local-key evidence: draft factory `web/app/api/drafts/[slug]/join-bot/route.ts:11`, tournament bots `web/app/api/tournaments/[slug]/join-bot/route.ts:11–13`, exact fake-player names `scripts/seed.ts:230–239`; `seed`/`system` are the approved reserved owner keys. Do not accept arbitrary `fake_*`, `bot_*`, `clerk:*` or arbitrary strings to make tests pass. Reconciliation of additional real backup keys is an explicit blocker, not a broader regex.

- [ ] **Step 5: Make recurring backfill schema-aware and explicitly enable normal FK enforcement.** At the beginning of migrate, before line 17, call the guards. At the old line 708 compute the join column; interpolate only this fixed identifier.

```ts
assertS1Empty(db);
identityShape(db);
// At the draft-deck backfill, after historical column additions:
const deckOwnerColumn = hasColumn(db, "players", "user_id") ? "user_id" : "discord_user_id";
db.exec(`update draft_players set deck_saved_at = current_timestamp
  where deck_saved_at is null and exists (
    select 1 from saved_decks s inner join players p on p.id = draft_players.player_id
    where s.draft_id = draft_players.draft_id and s.owner_user_id = p.${deckOwnerColumn} and s.guild_id = p.guild_id
  )`);
```

Replace openDatabase's initialization body after `new Database(path)` with:

```ts
try {
  db.pragma("foreign_keys = on");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  migrate(db);
  if (db.pragma("foreign_keys", { simple: true }) !== 1) throw new Error("Foreign keys must be enabled");
  return db;
} catch (error) {
  db.close();
  throw error;
}
```

- [ ] **Step 5a: Serialize historical column checks and recheck the old tournament rebuild under its lock.** Concurrent fresh starts must not both decide to add the same column. Replace the current helper at schema.ts:10 with:

```ts
function addColumnIfMissing(db:Database.Database,table:string,column:string,definition:string){
  db.transaction(()=>{
    if(!hasColumn(db,table,column))db.exec(`alter table ${table} add column ${column} ${definition}`);
  }).immediate();
}
```

At schema.ts:259–313 keep the historical tournament copy SQL verbatim, but acquire `BEGIN IMMEDIATE` before its final schema check. Remove the inner SQL `begin;`/`commit;` from the copy string. Wrap it as follows, with the existing create/copy/drop/rename SQL in `rebuildLegacyTournamentSql` (a constant holding exactly the current block lines 267–303):

```ts
if(tournamentSchema?.sql.includes("unique (guild_id, name)")){
  const enabled=Number(db.pragma("foreign_keys",{simple:true}));
  try{
    db.pragma("foreign_keys=off");db.exec("begin immediate");
    const current=db.prepare("select sql from sqlite_master where type='table' and name='tournaments'").get() as {sql:string};
    if(current.sql.includes("unique (guild_id, name)"))db.exec(rebuildLegacyTournamentSql);
    db.exec("commit");
  }catch(error){if(db.inTransaction)db.exec("rollback");throw error;}
  finally{db.pragma(`foreign_keys=${enabled?"on":"off"}`);}
}
```

The constant's exact content is:

```ts
const rebuildLegacyTournamentSql=`
create table tournaments_without_name_unique (
  id integer primary key autoincrement, guild_id text not null, name text not null,
  format text not null, status text not null, created_by_user_id text not null,
  created_at text not null default current_timestamp, started_at text, ended_at text
);
insert into tournaments_without_name_unique
  (id,guild_id,name,format,status,created_by_user_id,created_at,started_at,ended_at)
  select id,guild_id,name,format,status,created_by_user_id,created_at,started_at,ended_at from tournaments;
drop table tournaments;
alter table tournaments_without_name_unique rename to tournaments;
`;
```

Place this private constant before migrate. Keep the later identity rebuild separate, with its own FK toggle/lock/recheck. In connection.test.ts's existing file-backed test add:

```ts
expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
expect(()=>db.prepare("insert into players(guild_id,user_id,display_name) values('g',999999,'Invalid')").run()).toThrow(/FOREIGN KEY/);
```

Run `npx vitest run packages/shared/tests/db/connection.test.ts packages/shared/tests/db/identity-migration.test.ts`. Expected: PASS once the identity block is installed. T9's two-process startup command exercises both fresh and converged legacy shapes without suppressing duplicate-column/SQLITE_BUSY failures.

- [ ] **Step 6: Implement users.ts with transactional uniqueness and explicit email replacement.** Use the interfaces above and this implementation; it allocates a local row without granting authentication. Clerk fields stay NULL in PR 1.

```ts
import type Database from "better-sqlite3";
type UserRow = {
  id: number; clerk_user_id: string | null; email: string | null; email_verified: number;
  username: string; display_name: string; discord_user_id: string | null;
  created_at: string; updated_at: string; synced_at: string | null;
};
function mapUser(row: UserRow): User {
  return { id: row.id, clerkUserId: row.clerk_user_id, email: row.email,
    emailVerified: row.email_verified === 1, username: row.username, displayName: row.display_name,
    discordUserId: row.discord_user_id, createdAt: row.created_at, updatedAt: row.updated_at, syncedAt: row.synced_at };
}
function usernameFor(name: string, id: number): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return stem ? `${stem}_${id}` : `duelist_${id}`;
}
export function createUserService(db: Database.Database): UserService {
  const byId = db.prepare<[number], UserRow>("select * from users where id=?");
  const byDiscord = db.prepare<[string], UserRow>("select * from users where discord_user_id=?");
  const insert = (name: string, discord: string | null): number => {
    const id = Number(db.prepare("insert into users(username,display_name,discord_user_id) values('',?,?)").run(name, discord).lastInsertRowid);
    db.prepare("update users set username=? where id=?").run(usernameFor(name, id), id);
    return id;
  };
  const ensure = db.transaction((input: DiscordUserInput): User => {
    if (!/^[0-9]{1,25}$/.test(input.discordUserId)) throw new Error("Invalid Discord account ID");
    const id = byDiscord.get(input.discordUserId)?.id ?? insert(input.displayName, input.discordUserId);
    db.prepare("update users set display_name=?,updated_at=current_timestamp where id=?").run(input.displayName, id);
    if (Object.prototype.hasOwnProperty.call(input, "email")) {
      const email = input.email?.trim().toLowerCase() || null;
      db.prepare("update users set email=?,email_verified=?,updated_at=current_timestamp where id=?")
        .run(email, email !== null && input.emailVerified === true ? 1 : 0, id);
    }
    db.prepare("update players set discord_user_id=? where user_id=?").run(input.discordUserId, id);
    return mapUser(byId.get(id)!);
  });
  return {
    findById(id) { const row = byId.get(id); return row && mapUser(row); },
    findByDiscordId(discordUserId) { const row = byDiscord.get(discordUserId); return row && mapUser(row); },
    ensureDiscord(input) { return ensure.immediate(input); },
    createNonLogin(displayName) { return db.transaction(() => mapUser(byId.get(insert(displayName, null))!)).immediate(); },
  };
}
```

Do not add five-minute Clerk sync, linking/history-transfer APIs or a block flag now: the schema carries the nullable future fields; PR 2 supplies those behaviors. Bot/JWT calls omit email and preserve captured data; sign-in calls always pass a nullable email and the authoritative boolean.

- [ ] **Step 7: Add users, schema-backfill and failure-boundary tests.** The following users tests stand alone in users.test.ts.

```ts
import Database from "better-sqlite3";
import { afterAll, afterEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService } from "../../src/services/users.js";
const db = new Database(":memory:"); migrate(db); db.pragma("foreign_keys=on");
afterAll(() => db.close());
const users = createUserService(db);
afterEach(() => { db.exec("delete from users"); });
it("keeps one user, normalizes email, clears stale verification and keeps username", () => {
  const a = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "Yugi", email: " A@EXAMPLE.COM ", emailVerified: true });
  expect(a).toMatchObject({ email: "a@example.com", emailVerified: true, clerkUserId: null, syncedAt: null });
  const b = users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Changed", email: "B@example.com", emailVerified: false });
  expect(b).toMatchObject({ id: a.id, username: a.username, email: "b@example.com", emailVerified: false });
  expect(users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Bot lookup" }).email).toBe("b@example.com");
  expect(users.ensureDiscord({ discordUserId: a.discordUserId!, displayName: "Yugi", email: null, emailVerified: true })).toMatchObject({ email: null, emailVerified: false });
});
it("does not merge duplicate emails or fabricate a Discord account for local users", () => {
  const a = users.ensureDiscord({ discordUserId: "900000000000000101", displayName: "A", email: "same@example.com", emailVerified: true });
  const b = users.ensureDiscord({ discordUserId: "900000000000000102", displayName: "B", email: "same@example.com", emailVerified: true });
  expect(a.id).not.toBe(b.id);
  const local = users.createNonLogin("!!!");
  expect(local).toMatchObject({ username: `duelist_${local.id}`, discordUserId: null, email: null, emailVerified: false });
  expect(() => users.ensureDiscord({ discordUserId: "clerk:x", displayName: "X" })).toThrow();
});
```

In identity-migration.test.ts, reuse the fully defined `legacy`, `mixed`, `handles` helpers in this task and add:

```ts
it("uses numeric owners during repeated deck backfill", () => {
  const db = legacy(); mixed(db); migrate(db);
  db.exec("update draft_players set deck_saved_at=null where draft_id=13");
  migrate(db);
  expect((db.prepare("select deck_saved_at from draft_players where draft_id=13").get() as { deck_saved_at: string | null }).deck_saved_at).not.toBeNull();
});
it("never recreates a folded imported user on rerun", () => {
  const db = legacy(); mixed(db); migrate(db);
  const original = db.prepare("select id from users where discord_user_id='900000000000000102'").get() as { id: number };
  const survivor = db.prepare("select id from users where discord_user_id='900000000000000101'").get() as { id: number };
  db.prepare("update tournaments set created_by_user_id=? where created_by_user_id=?").run(survivor.id, original.id);
  db.prepare("delete from users where id=?").run(original.id);
  migrate(db);
  expect(db.prepare("select id from users where id=?").get(original.id)).toBeUndefined();
});
it("aborts on a source FK violation", () => {
  const db = legacy(); db.pragma("foreign_keys=off");
  db.exec("insert into draft_players(draft_id,player_id) values(999,999)");
  db.pragma("foreign_keys=on");
  expect(() => migrate(db)).toThrow(/foreign keys/i);
});
it.each(["alter table players add column private_note text", "create index custom_players_name on players(display_name)", "create trigger custom_players after insert on players begin select 1; end"])("refuses schema loss: %s", sql => {
  const db = legacy(); db.exec(sql);
  expect(() => migrate(db)).toThrow(/preserve explicitly/i);
});
it.each(["clerk:fake","unrecognized_actor","bot_player_dev_bad"])("aborts unknown actor key %s without allocating users",key=>{
  const db=legacy();
  db.prepare("insert into players(guild_id,discord_user_id,display_name) values('g',?,'Unknown')").run(key);
  expect(()=>migrate(db)).toThrow(/Unknown synthetic identity/);
  expect(db.prepare("select name from sqlite_master where name='users'").get()).toBeUndefined();
});
it("allocates seed-only owners and uses the deterministic fallback username",()=>{
  const db=legacy();
  db.exec("insert into players(guild_id,discord_user_id,display_name) values('g','900000000000000109','!!!'); insert into cubes(guild_id,name,created_by_user_id) values('g','Seed pool','seed')");
  migrate(db);
  const human=db.prepare("select id,username from users where discord_user_id='900000000000000109'").get() as {id:number;username:string};
  expect(human.username).toBe(`duelist_${human.id}`);
  expect(db.prepare("select u.discord_user_id from cubes c join users u on u.id=c.created_by_user_id").get()).toEqual({discord_user_id:null});
});
it("allocates above deleted-row sequence high-water", () => {
  const db = legacy(); mixed(db); migrate(db);
  const uid = (db.prepare("select user_id from players where id=41").get() as { user_id: number }).user_id;
  expect(Number(db.prepare("insert into players(guild_id,user_id,display_name) values('new',?,'New')").run(uid).lastInsertRowid)).toBeGreaterThan(900);
});
it.each([0,1])("restores original FK pragma %s on success", enabled => {
  const db = legacy(); db.pragma(`foreign_keys=${enabled}`); migrate(db);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(enabled);
});
```

Run: `npx vitest run packages/shared/tests/db/identity-migration.test.ts packages/shared/tests/services/users.test.ts` then `npm run build --workspace=packages/shared`.
Expected: PASS; unrelated old-shape application fixtures still fail until T2 and must be reported as pending, not weakened by disabling FKs. T9 supplies real multi-process startup, all-child snapshots and process-interruption rehearsal against a disk copy.

- [ ] **Checkpoint: stage only this task's files (`packages/shared/src/services/users.ts`, `packages/shared/src/services/index.ts`, `packages/shared/src/db/schema.ts`, `packages/shared/src/db/connection.ts`, `packages/shared/tests/services/users.test.ts`, `packages/shared/tests/db/identity-migration.test.ts`, `packages/shared/tests/db/fixtures/pre-identity.sql`, `packages/shared/tests/db/connection.test.ts`) and stop for orchestrator review; the orchestrator commits.**


### Task 2: Convert shared ownership services and every database fixture

**Files:**
- Modify: `packages/shared/src/services/players.ts:3–52`, `drafts.ts:210,1344,1589`, `tournaments.ts:30,355,486,583,765`, `cubes.ts:91,188,195,231,476`, `seasons.ts:40,58,62`, `saved-decks.ts:31–38,196,202–264`, `draft-decks.ts:24,119,159–291`, `draft-access.ts:8,14,52`, `draft-tournament.ts:8,50,57`, `tournament-duels.ts:54,82,173,206,226,260,355,396`, `duel-series.ts:759,788,912` (all under `packages/shared/src/services/`).
- Modify: `packages/shared/src/types/index.ts:50,53,108,171`, `packages/shared/src/services/index.ts:12`.
- Create: `packages/shared/tests/services/players-identity.test.ts`, `packages/shared/tests/helpers/identity.ts`.
- Modify tests: the exhaustive shared/duel-server fixture list below. Read-only checks: `packages/shared/src/services/tournament-registrations.ts:34,48`, `packages/shared/src/services/duels.ts:173`, `packages/shared/src/duels/index.ts:89`, `packages/shared/src/ws/duel-token.ts:5–13` (already player-based, no owner DTO to change).

**Interfaces:**
- Consumes: `createUserService(db)` with `findById(id:number):User|undefined`, `findByDiscordId(discordUserId:string):User|undefined`, `ensureDiscord({discordUserId:string,displayName:string,email?:string|null,emailVerified?:boolean}):User`, `createNonLogin(displayName:string):User`. `User.id:number`, `User.discordUserId:string|null`, `User.displayName:string`.
- Produces: `Player { id:number; guildId:string; userId:number; discordUserId:string|null; displayName:string; createdAt:string }`; `findByGuildAndUser(guildId:string,userId:number):Player|undefined`; `findOrCreate(guildId:string,userId:number,displayName:string):Player`; `findOrCreateByDiscord(guildId:string,discordUserId:string,displayName:string):Player`; `findOrCreateTestPlayer(guildId:string,legacyKey:string,displayName:string):Player`.
- Produces: `Draft.createdByUserId`, `Tournament.createdByUserId`, `Cube.createdByUserId` are `number`; `Draft.channelId:string|null`. `DraftService.create(guildId:string,channelId:string|null,name:string,config:DraftConfig,createdByUserId:number,creatorPlayerId:number):Draft`; owner filters use number.
- Produces: `TournamentService.create(guildId:string,name:string,format:TournamentFormat,createdByUserId:number,options?:{deadlineAt?:string|null;reportConfirmWindowHours?:number|null;bestOf?:1|3;duelRules?:{mode?:unknown;masterRule?:unknown;settings?:unknown}|null}):Tournament`; `createdBy(guildId:string,userId:number,statuses:TournamentStatus[]):Tournament[]`; `kick(tournamentId:number,organizerUserId:number,playerId:number):void`; `reopenTournamentMatch(tournamentMatchId:number,requesterUserId:number):void`.
- Produces: cube `createBlank(guildId:string,name:string,createdByUserId:number):Cube`, `createFromArchetype(guildId:string,archetype:string,createdByUserId:number,opts?:{name?:string;banlist?:string;maxCopies?:number}):Promise<Cube>`, `createWithCards(guildId:string,name:string,createdByUserId:number,entries:Array<{id:number;copies:number}>,opts?:{copyExtraFromCubeId?:number}):Cube`, `save(guildId:string,name:string,config:DraftConfig,createdByUserId:number):Cube`.
- Produces: season `start(guildId:string,userId?:number,name?:string):Season`, `ensureActive(guildId:string,userId?:number):Season`, `end(guildId:string,userId?:number):Season|undefined`.
- Produces: saved deck `list(guildId:string,ownerUserId:number):SavedDeck[]`, `get(id:number,guildId:string,ownerUserId:number):SavedDeck`, `create(guildId:string,ownerUserId:number,input:SavedDeckWrite):SavedDeck`, `update(id:number,guildId:string,ownerUserId:number,input:SavedDeckWrite):SavedDeck`, `delete(id:number,guildId:string,ownerUserId:number):void`, `findByDraft(guildId:string,ownerUserId:number,draftId:number):SavedDeck|null`. Existing `SavedDeckWrite` fields remain `name:unknown;mode:unknown;deck:unknown;draftId?:unknown`.
- Produces: draft decks `saveForDraft(draftId:number):number[]` returns USER IDs; `ensureForUser(guildId:string,userId:number):number[]` returns DRAFT IDs; `linkTournament(tournamentId:number,onlyPlayerId?:number):number[]` returns PLAYER IDs; `isTestBotDiscordId(id:string|null|undefined):boolean`.
- Produces: `findDraftReadAccess(db,slug:string,guildId:string,userId:number):{id:number;status:string;canRead:boolean}|null`; `createDraftAccessReader(databasePath?:string).canReadDraft({slug:string,guildId:string,userId:number}):boolean`.
- Produces: `createTournamentFromDraft({draftId:number,format:TournamentFormat,createdByUserId:number,actorIsAdmin?:boolean,bestOf?:1|3}):{tournamentId:number;tournamentName:string;webSlug:string|undefined}`. Retain `actorIsAdmin` in PR 1.
- Produces: tournament duel `setRules(tournamentId:number,organizerUserId:number,input:{bestOf?:1|3;mode?:DuelMode;masterRule?:DuelMasterRule;settings?:unknown}):TournamentDuelRules` and `setResultByOrganizer({tournamentMatchId:number,organizerUserId:number,winnerPlayerId:number})`; all result/player signatures unchanged. `DuelSeriesService.startTournamentMatch({guildId:string,tournamentMatchId:number,actorPlayerId:number}):SeriesGameStart` keeps actorPlayerId and compares the fetched actor's user_id with creator ownership.

- [ ] **Step 1: Write the player identity tests.** Put this complete test body in players-identity.test.ts.

```ts
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService } from "../../src/services/users.js";
import { createPlayerService } from "../../src/services/players.js";
import { isTestBotDiscordId } from "../../src/services/draft-decks.js";
const handles: Database.Database[] = [];
function setup() {
  const db = new Database(":memory:"); handles.push(db); migrate(db); db.pragma("foreign_keys=on");
  return { db, users: createUserService(db), players: createPlayerService(db) };
}
afterEach(() => { for (const db of handles.splice(0)) db.close(); });
it("shares a user across guilds and never changes a player ID", () => {
  const { db, users, players } = setup();
  const a = players.findOrCreateByDiscord("g", "900000000000000101", "A");
  const b = players.findOrCreateByDiscord("other", "900000000000000101", "B");
  expect(a.userId).toBe(b.userId); expect(a.id).not.toBe(b.id);
  expect(players.findOrCreate("g", a.userId, "Renamed").id).toBe(a.id);
  expect(players.findByGuildAndUser("g", a.userId)?.discordUserId).toBe("900000000000000101");
  expect(users.findById(a.userId)?.discordUserId).toBe(a.discordUserId);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});
it("keeps email-only humans distinct from test bots", () => {
  const { users, players } = setup();
  const human = users.createNonLogin("Human");
  const p = players.findOrCreate("g", human.id, "Human");
  expect(p.discordUserId).toBeNull(); expect(isTestBotDiscordId(p.discordUserId)).toBe(false);
  const bot = players.findOrCreateTestPlayer("g", "bot_player_dev_1", "Bot 1");
  expect(users.findById(bot.userId)?.discordUserId).toBeNull();
  expect(isTestBotDiscordId(bot.discordUserId)).toBe(true);
  expect(players.findOrCreateTestPlayer("g", "bot_player_dev_1", "Bot 1").id).toBe(bot.id);
  expect(() => players.findOrCreateTestPlayer("g", "clerk:fake", "X")).toThrow();
});
```

Run: `npx vitest run packages/shared/tests/services/players-identity.test.ts`.
Expected: FAIL on missing Discord/test adapters and userId.

- [ ] **Step 2: Replace players.ts with the integer service.** Import `createUserService` from `./users.js`; keep the Player type from Interfaces.

```ts
import type Database from "better-sqlite3";
import { createUserService } from "./users.js";
type PlayerRow = { id:number; guild_id:string; user_id:number; discord_user_id:string|null; display_name:string; created_at:string };
function mapPlayer(r:PlayerRow):Player {
  return { id:r.id, guildId:r.guild_id, userId:r.user_id, discordUserId:r.discord_user_id, displayName:r.display_name, createdAt:r.created_at };
}
export function createPlayerService(db:Database.Database) {
  const users = createUserService(db);
  const select = db.prepare<[string,number],PlayerRow>("select * from players where guild_id=? and user_id=?");
  const findOrCreate = db.transaction((guildId:string,userId:number,displayName:string):Player => {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid application user ID");
    const user = users.findById(userId);
    if (!user) throw new Error("User not found");
    db.prepare(`insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)
      on conflict(guild_id,user_id) do update set display_name=excluded.display_name,
      discord_user_id=case when excluded.discord_user_id is not null then excluded.discord_user_id else players.discord_user_id end`)
      .run(guildId,userId,user.discordUserId,displayName);
    return mapPlayer(select.get(guildId,userId)!);
  });
  return {
    findByGuildAndUser(guildId:string,userId:number):Player|undefined { const row=select.get(guildId,userId); return row && mapPlayer(row); },
    findOrCreate(guildId:string,userId:number,displayName:string):Player { return findOrCreate.immediate(guildId,userId,displayName); },
    findOrCreateByDiscord(guildId:string,discordUserId:string,displayName:string):Player {
      return db.transaction(() => {
        const user=users.ensureDiscord({discordUserId,displayName});
        return findOrCreate(guildId,user.id,displayName);
      }).immediate();
    },
    findOrCreateTestPlayer(guildId:string,legacyKey:string,displayName:string):Player {
      if (!/^bot_player_dev_[1-9][0-9]*$/.test(legacyKey) && !/^tournament_bot_dev_[1-3]$/.test(legacyKey)
        && !["fake_yugi","fake_kaiba","fake_joey","fake_pegasus"].includes(legacyKey)) throw new Error("Unknown test player key");
      return db.transaction(() => {
        const old=db.prepare<[string,string],PlayerRow>("select * from players where guild_id=? and discord_user_id=?").get(guildId,legacyKey);
        if (old) return mapPlayer(old);
        const same=db.prepare<[string],{user_id:number}>("select user_id from players where discord_user_id=? order by id limit 1").get(legacyKey);
        const userId=same?.user_id ?? users.createNonLogin(displayName).id;
        db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values(?,?,?,?)").run(guildId,userId,legacyKey,displayName);
        return mapPlayer(select.get(guildId,userId)!);
      }).immediate();
    },
  };
}
export type PlayerService = ReturnType<typeof createPlayerService>;
```

- [ ] **Step 3: Convert declared owner types and SQL joins without changing gameplay identifiers.** Apply the exact identifier edits using this bounded script, then apply the SQL replacements below. This script deliberately excludes Discord payload contracts.

```python
from pathlib import Path
files = ['players', 'drafts', 'tournaments', 'cubes', 'seasons', 'saved-decks', 'draft-access', 'draft-tournament', 'tournament-duels', 'duel-series']
for name in files:
    p = Path(f'packages/shared/src/services/{name}.ts')
    s = p.read_text()
    for field in ('createdByUserId', 'created_by_user_id', 'ownerUserId', 'owner_user_id', 'organizerUserId', 'requesterUserId', 'creatorUserId'):
        s = s.replace(f'{field}: string', f'{field}: number').replace(f'{field}?: string', f'{field}?: number')
    if name in ('seasons', 'draft-access'):
        s = s.replace('userId: string', 'userId: number').replace('userId?: string', 'userId?: number')
    if name == 'drafts': s = s.replace('channelId: string,', 'channelId: string | null,')
    p.write_text(s)
p = Path('packages/shared/src/types/index.ts')
s = p.read_text().replace('createdByUserId: string', 'createdByUserId: number').replace('channelId: string;', 'channelId: string | null;')
p.write_text(s)
```

The actual SQL/type replacements at the cited call sites are:

```ts
// saved-decks.ts:196, draft-access.ts:14 and tournament-duels.ts:260
"select id from players where guild_id = ? and user_id = ?"
// saved-decks.ts markDraftDeckSaved subquery
"and player_id in (select id from players where guild_id = ? and user_id = ?)"
// draft-access.ts participant condition
"where dp.draft_id = d.id and p.guild_id = d.guild_id and p.user_id = ?"
// tournament-duels.ts:206 participant selection and :355 comparison
const selectParticipant = db.prepare<[number, number], { user_id: number }>(`
  select p.user_id from tournament_participants tp
  inner join players p on p.id=tp.player_id where tp.tournament_id=? and tp.player_id=?`);
// Inside the existing registerDeck transaction:
if (saved.owner_user_id !== participant.user_id) {
  throw new TournamentDuelError("That saved deck belongs to another player", 403);
}
// duel-series.ts:759 selector (display name remains for challenge names)
const selectPlayer = db.prepare<[number], { guild_id:string; user_id:number; discord_user_id:string|null; display_name:string }>(
  "select guild_id,user_id,discord_user_id,display_name from players where id=?");
// duel-series.ts:912, inside startTournamentMatchTx:
if (!isPlayer && actor.user_id !== tournament.created_by_user_id) {
  throw new DuelServiceError("Only a match player or the tournament organizer can start this duel", 403);
}
```

Change prepared parameter tuples from `[string,string]` to `[string,number]` wherever the second parameter is an application ID. In draft-decks.ts include `p.user_id` in both `selectHumans` and `selectUnregistered`, type it as number, replace `p.discord_user_id = ?` in `selectMissing` with `p.user_id = ?`, use `human.user_id`/`row.user_id` for saved-deck ownership, and return `created:number[]` with `created.push(human.user_id)`. Explicitly change `DraftDeckService.saveForDraft(draftId:number):number[]`, `ensureForUser(guildId:string,userId:number):number[]`, the selectMissing parameter tuple to `[string,number,number]`, and both selected Discord-field types to `string|null`. The selectHumans query/row is:

```ts
const selectHumans=db.prepare<[number],{player_id:number;user_id:number;discord_user_id:string|null;deck_saved_at:string|null}>(`
  select dp.player_id,p.user_id,p.discord_user_id,dp.deck_saved_at from draft_players dp
  inner join players p on p.id=dp.player_id where dp.draft_id=? order by dp.joined_at,dp.rowid`);
const selectUnregistered=db.prepare<[number],{player_id:number;user_id:number;discord_user_id:string|null}>(`
  select tp.player_id,p.user_id,p.discord_user_id from tournament_participants tp
  inner join players p on p.id=tp.player_id where tp.tournament_id=? and tp.deck_json is null
  and tp.deck_locked_at is null order by tp.joined_at,tp.rowid`);
```

Retain Discord compatibility only for this classifier:

```ts
export function isTestBotDiscordId(discordUserId: string | null | undefined): boolean {
  return typeof discordUserId === "string" && discordUserId.startsWith(TEST_BOT_DISCORD_PREFIX);
}
```

- [ ] **Step 4: Convert fixtures using a real identity helper, not production acceptance of fake accounts.** Create the test helper below. Its optional IDs support old tests asserting exact player numbers; distinct numeric user IDs ensure tests cannot accidentally pass by confusing player/user/Discord IDs.

```ts
// packages/shared/tests/helpers/identity.ts
import type Database from "better-sqlite3";
export function seedIdentity(db: Database.Database, input: {
  guildId?:string; name?:string; discordUserId?:string|null; userId?:number; playerId?:number;
} = {}): { userId:number; playerId:number; discordUserId:string|null } {
  const name=input.name ?? "Test duelist";
  const discord=input.discordUserId ?? null;
  return db.transaction(() => {
    const known=discord === null ? undefined : db.prepare("select id from users where discord_user_id=?").get(discord) as {id:number}|undefined;
    const userId=known?.id ?? Number(db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)")
      .run(input.userId ?? null, "test_duelist", name, discord).lastInsertRowid);
    const playerId=Number(db.prepare("insert into players(id,guild_id,user_id,discord_user_id,display_name) values(?,?,?,?,?)")
      .run(input.playerId ?? null,input.guildId ?? "g",userId,discord,name).lastInsertRowid);
    return {userId,playerId,discordUserId:discord};
  }).immediate();
}
```

For each fixture listed below, replace raw player INSERT setup with `seedIdentity`, pass `.userId` to creator/owner arguments and `.playerId` to joins/gameplay. Fixed fixtures should use `userId:101,playerId:1,discordUserId:"900000000000000101"` and a second user 102/player 2. Preserve intentional *legacy migration* SQL fixtures (those run before migrate) and rewrite their legacy actor strings to recognized keys. A third user without player can use `createUserService(db).createNonLogin("Creator").id`. Helpers that run in spawned test processes need their users INSERT in that process too.

Concrete conversion for services/drafts.test.ts:11 and every equivalent helper:

```ts
const alice = seedIdentity(db, { guildId: "g1", name: "Alice", userId: 101, playerId: 1, discordUserId: "900000000000000101" });
const bob = seedIdentity(db, { guildId: "g1", name: "Bob", userId: 102, playerId: 2, discordUserId: "900000000000000102" });
const draft = createDraftService(db).create("g1", "channel", "Draft", {}, alice.userId, alice.playerId);
createDraftService(db).join(draft.id, bob.playerId);
expect(draft.createdByUserId).toBe(101);
```

Add this regression to players-identity.test.ts using the `setup` helper in this task and imports of `createSavedDeckService`, `createTournamentService`, `createTournamentDuelService`, `createDraftDeckService`:

```ts
it("registers an integer-owned deck and rejects another user's deck", () => {
  const {db,players} = setup();
  const a=players.findOrCreateByDiscord("g","900000000000000101","A");
  const b=players.findOrCreateByDiscord("g","900000000000000102","B");
  const ts=createTournamentService(db);
  const t=ts.create("g","Cup","round_robin",a.userId);
  ts.join(t.id,a.id); ts.join(t.id,b.id);
  const decks=createSavedDeckService(db);
  const deck=decks.create("g",a.userId,{name:"A",mode:"normal",deck:{main:[1],extra:[],side:[]}});
  const td=createTournamentDuelService(db);
  expect(() => td.registerDeck({tournamentId:t.id,playerId:b.id,savedDeckId:deck.id,deck:deck.deck})).toThrow(/belongs to another player/);
  expect(() => td.registerDeck({tournamentId:t.id,playerId:a.id,savedDeckId:deck.id,deck:deck.deck})).not.toThrow();
  expect(createDraftDeckService(db).ensureForUser("g",a.userId)).toEqual([]);
});
```

- Modify fixture: `packages/shared/tests/db/schema.test.ts:49`.
- Modify fixture: `packages/shared/tests/draft-pack-options-concurrency.test.ts:24`.
- Modify fixture: `packages/shared/tests/draft-pick-concurrency.test.ts:35`.
- Modify fixture: `packages/shared/tests/draft-pool-snapshot.test.ts:7`.
- Modify fixture: `packages/shared/tests/draft-swap-random.test.ts:13`.
- Modify fixture: `packages/shared/tests/draft-tournament-helper.test.ts:11`.
- Modify fixture: `packages/shared/tests/scoring/stakes.test.ts:14`.
- Modify fixture: `packages/shared/tests/scripts/repair-ratings.test.ts:10`.
- Modify fixture: `packages/shared/tests/services/bug-reports.test.ts:16`.
- Modify fixture: `packages/shared/tests/services/card-artworks.test.ts:10`.
- Modify fixture: `packages/shared/tests/services/cubes-replace-main.test.ts:4`.
- Modify fixture: `packages/shared/tests/services/cubes.test.ts:4`.
- Modify fixture: `packages/shared/tests/services/draft-access.test.ts:53`.
- Modify fixture: `packages/shared/tests/services/draft-decks.test.ts:31`.
- Modify fixture: `packages/shared/tests/services/drafts-copy-cap.test.ts:6`.
- Modify fixture: `packages/shared/tests/services/drafts-theme.test.ts:5`.
- Modify fixture: `packages/shared/tests/services/drafts.test.ts:11`.
- Modify fixture: `packages/shared/tests/services/duel-seats.test.ts:27`.
- Modify fixture: `packages/shared/tests/services/duel-series.test.ts:13`.
- Modify fixture: `packages/shared/tests/services/duels-multiplayer.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/duels.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/live-now.test.ts:11`.
- Modify fixture: `packages/shared/tests/services/matches.test.ts:11`.
- Modify fixture: `packages/shared/tests/services/saved-decks.test.ts:131`.
- Modify fixture: `packages/shared/tests/services/scoring-integration.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/scoring-match.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/scoring-reads.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/scoring-rebuild.test.ts:6`.
- Modify fixture: `packages/shared/tests/services/scoring-tournament.test.ts:9`.
- Modify fixture: `packages/shared/tests/services/seasons.test.ts:4`.
- Modify fixture: `packages/shared/tests/services/tournament-completion-claim.test.ts:19`.
- Modify fixture: `packages/shared/tests/services/tournament-duels.test.ts:25`.
- Modify fixture: `packages/shared/tests/services/tournament-registrations.test.ts:11`.
- Modify fixture: `packages/shared/tests/services/tournament-reopen.test.ts:6`.
- Modify fixture: `packages/shared/tests/services/tournaments.test.ts:15`.
- Modify fixture: `packages/duel-server/tests/draft-deck-legality.test.ts:43`.
- Modify fixture: `packages/duel-server/tests/host-bot-pacing.test.ts:88`.
- Modify fixture: `packages/duel-server/tests/host-bot-turn-limit.test.ts:88`.
- Modify fixture: `packages/duel-server/tests/host-bug-context.test.ts:23`.
- Modify fixture: `packages/duel-server/tests/host-chain-mode-real.test.ts:46`.
- Modify fixture: `packages/duel-server/tests/host-chain-mode.test.ts:67`.
- Modify fixture: `packages/duel-server/tests/host-clock-pending.test.ts:61`.
- Modify fixture: `packages/duel-server/tests/host-coin-clock.test.ts:96`.
- Modify fixture: `packages/duel-server/tests/host-domain-card-restriction.test.ts:37`.
- Modify fixture: `packages/duel-server/tests/host-domain-multi-real.test.ts:32`.
- Modify fixture: `packages/duel-server/tests/host-eliminate.test.ts:67`.
- Modify fixture: `packages/duel-server/tests/host-engine-switch.test.ts:72`.
- Modify fixture: `packages/duel-server/tests/host-ffa4-real.test.ts:71`.
- Modify fixture: `packages/duel-server/tests/host-first-turn-draw.test.ts:38`.
- Modify fixture: `packages/duel-server/tests/host-multi-domain-guard.test.ts:33`.
- Modify fixture: `packages/duel-server/tests/host-multiplayer-flag.test.ts:63`.
- Modify fixture: `packages/duel-server/tests/host-multiplayer-stack.test.ts:42`.
- Modify fixture: `packages/duel-server/tests/host-nseat.test.ts:162`.
- Modify fixture: `packages/duel-server/tests/host-opening.test.ts:53`.
- Modify fixture: `packages/duel-server/tests/host-report-replay.test.ts:40`.
- Modify fixture: `packages/duel-server/tests/host-rule-forbidden.test.ts:47`.
- Modify fixture: `packages/duel-server/tests/host-seat-left-error.test.ts:38`.
- Modify fixture: `packages/duel-server/tests/host-series.test.ts:97`.
- Modify fixture: `packages/duel-server/tests/host-spectator-view.test.ts:19`.
- Modify fixture: `packages/duel-server/tests/host-surrender-eot.test.ts:70`.
- Modify fixture: `packages/duel-server/tests/host-table-legality.test.ts:57`.
- Modify fixture: `packages/duel-server/tests/host-unready.test.ts:37`.
- Modify fixture: `packages/duel-server/tests/host.test.ts:20`.

- [ ] **Step 5: Run shared tests, rebuild, and check duel fixtures.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm test --workspace=packages/shared
npm run build --workspace=packages/shared
npm run typecheck --workspace=packages/shared
npm run test:unit --workspace=packages/duel-server
```

Expected: shared tests and typecheck PASS; duel unit tests PASS with numeric fixtures. Consumer compilation is intentionally not the gate until T3–T8 convert callers. Preserve all existing assertions for decks, registrations, ranked/unranked history and snapshots; no skipped tests or blanket casts.

- [ ] **Checkpoint: stage only this task's files (`packages/shared/src/services/players.ts`, `packages/shared/src/services/drafts.ts`, `packages/shared/src/services/tournaments.ts`, `packages/shared/src/services/cubes.ts`, `packages/shared/src/services/seasons.ts`, `packages/shared/src/services/saved-decks.ts`, `packages/shared/src/services/draft-decks.ts`, `packages/shared/src/services/draft-access.ts`, `packages/shared/src/services/draft-tournament.ts`, `packages/shared/src/services/tournament-duels.ts`, `packages/shared/src/services/duel-series.ts`, `packages/shared/src/services/index.ts`, `packages/shared/src/types/index.ts`, `packages/shared/tests/services/players-identity.test.ts`, `packages/shared/tests/helpers/identity.ts`, `packages/shared/tests/db/schema.test.ts`, `packages/shared/tests/draft-pack-options-concurrency.test.ts`, `packages/shared/tests/draft-pick-concurrency.test.ts`, `packages/shared/tests/draft-pool-snapshot.test.ts`, `packages/shared/tests/draft-swap-random.test.ts`, `packages/shared/tests/draft-tournament-helper.test.ts`, `packages/shared/tests/scoring/stakes.test.ts`, `packages/shared/tests/scripts/repair-ratings.test.ts`, `packages/shared/tests/services/bug-reports.test.ts`, `packages/shared/tests/services/card-artworks.test.ts`, `packages/shared/tests/services/cubes-replace-main.test.ts`, `packages/shared/tests/services/cubes.test.ts`, `packages/shared/tests/services/draft-access.test.ts`, `packages/shared/tests/services/draft-decks.test.ts`, `packages/shared/tests/services/drafts-copy-cap.test.ts`, `packages/shared/tests/services/drafts-theme.test.ts`, `packages/shared/tests/services/drafts.test.ts`, `packages/shared/tests/services/duel-seats.test.ts`, `packages/shared/tests/services/duel-series.test.ts`, `packages/shared/tests/services/duels-multiplayer.test.ts`, `packages/shared/tests/services/duels.test.ts`, `packages/shared/tests/services/live-now.test.ts`, `packages/shared/tests/services/matches.test.ts`, `packages/shared/tests/services/saved-decks.test.ts`, `packages/shared/tests/services/scoring-integration.test.ts`, `packages/shared/tests/services/scoring-match.test.ts`, `packages/shared/tests/services/scoring-reads.test.ts`, `packages/shared/tests/services/scoring-rebuild.test.ts`, `packages/shared/tests/services/scoring-tournament.test.ts`, `packages/shared/tests/services/seasons.test.ts`, `packages/shared/tests/services/tournament-completion-claim.test.ts`, `packages/shared/tests/services/tournament-duels.test.ts`, `packages/shared/tests/services/tournament-registrations.test.ts`, `packages/shared/tests/services/tournament-reopen.test.ts`, `packages/shared/tests/services/tournaments.test.ts`, `packages/duel-server/tests/draft-deck-legality.test.ts`, `packages/duel-server/tests/host-bot-pacing.test.ts`, `packages/duel-server/tests/host-bot-turn-limit.test.ts`, `packages/duel-server/tests/host-bug-context.test.ts`, `packages/duel-server/tests/host-chain-mode-real.test.ts`, `packages/duel-server/tests/host-chain-mode.test.ts`, `packages/duel-server/tests/host-clock-pending.test.ts`, `packages/duel-server/tests/host-coin-clock.test.ts`, `packages/duel-server/tests/host-domain-card-restriction.test.ts`, `packages/duel-server/tests/host-domain-multi-real.test.ts`, `packages/duel-server/tests/host-eliminate.test.ts`, `packages/duel-server/tests/host-engine-switch.test.ts`, `packages/duel-server/tests/host-ffa4-real.test.ts`, `packages/duel-server/tests/host-first-turn-draw.test.ts`, `packages/duel-server/tests/host-multi-domain-guard.test.ts`, `packages/duel-server/tests/host-multiplayer-flag.test.ts`, `packages/duel-server/tests/host-multiplayer-stack.test.ts`, `packages/duel-server/tests/host-nseat.test.ts`, `packages/duel-server/tests/host-opening.test.ts`, `packages/duel-server/tests/host-report-replay.test.ts`, `packages/duel-server/tests/host-rule-forbidden.test.ts`, `packages/duel-server/tests/host-seat-left-error.test.ts`, `packages/duel-server/tests/host-series.test.ts`, `packages/duel-server/tests/host-spectator-view.test.ts`, `packages/duel-server/tests/host-surrender-eot.test.ts`, `packages/duel-server/tests/host-table-legality.test.ts`, `packages/duel-server/tests/host-unready.test.ts`, `packages/duel-server/tests/host.test.ts`) and stop for orchestrator review; the orchestrator commits.**


### Task 3: Version draft tokens for numeric user IDs

**Files:**
- Modify: `packages/shared/src/ws/draft-token.ts:5–55`, `packages/ws/src/events.ts:7–10,122–125`, `packages/shared/tests/ws/draft-token.test.ts:6–76`, `packages/ws/tests/draft-access.test.ts:37–60,166`, `packages/ws/tests/events.test.ts:52–56`.
- Read/verify unchanged: `packages/shared/src/ws/duel-token.ts:5–13`, `packages/shared/tests/ws/duel-token.test.ts:1`; draft broadcast pick/seat fields in `packages/shared/src/ws/events.ts` remain player IDs.

**Interfaces:**
- Consumes: `findDraftReadAccess(db,slug:string,guildId:string,userId:number):{id:number;status:string;canRead:boolean}|null`; `createDraftAccessReader(databasePath?:string).canReadDraft({slug:string,guildId:string,userId:number}):boolean`.
- Produces: `DraftRoomTokenClaims={slug:string;guildId:string;userId:number;expiresAt:number}`; `createDraftRoomToken(claims:DraftRoomTokenClaims,secret:string):string`; `verifyDraftRoomToken(token:unknown,secret:string,expected:{slug:string;userId:number},now?:number):DraftRoomTokenClaims|null`; TTL remains 60,000ms. Signature derivation domain becomes `yugidraft:draft-room:v2`; `DraftJoinPayload={slug:string;token:string;userId:number}`.

- [ ] **Step 1: Add signed old-domain and invalid-numeric-claim tests.** Replace the existing fixture user IDs with 101/102 and append:

```ts
function signRaw(value:unknown, domain:string):string {
  const payload=Buffer.from(JSON.stringify(value));
  const key=createHmac("sha256",secret).update(domain).digest();
  return `${payload.toString("base64url")}.${createHmac("sha256",key).update(payload).digest("base64url")}`;
}
it("rejects every v1 token even if its payload contains a number", () => {
  const value={slug:"draft-a",guildId:"guild-1",userId:101,expiresAt:now+60_000};
  expect(verifyDraftRoomToken(signRaw(value,"yugidraft:draft-room:v1"),secret,{slug:"draft-a",userId:101},now)).toBeNull();
});
it.each(["101", "900000000000000101", 0, -1, 1.5, Number.MAX_SAFE_INTEGER+1, null])("rejects v2 invalid user identity %s", userId => {
  const value={slug:"draft-a",guildId:"guild-1",userId,expiresAt:now+60_000};
  expect(verifyDraftRoomToken(signRaw(value,"yugidraft:draft-room:v2"),secret,{slug:"draft-a",userId:101},now)).toBeNull();
});
```

Run: `npx vitest run packages/shared/tests/ws/draft-token.test.ts`.
Expected: FAIL before version change (numeric claims are rejected by v1 implementation).

- [ ] **Step 2: Change only the draft contract and WS boundary.** Keep signature comparison, raw JSON signing, claim count, expiry, slug/user binding and malformed token handling.

```ts
export type DraftRoomTokenClaims={slug:string;guildId:string;userId:number;expiresAt:number};
function validClaims(value:unknown):value is DraftRoomTokenClaims {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const claims=value as Record<string,unknown>;
  return Object.keys(claims).length===4
    && typeof claims.slug==="string" && claims.slug.length>0
    && typeof claims.guildId==="string" && claims.guildId.length>0
    && typeof claims.userId==="number" && Number.isSafeInteger(claims.userId) && claims.userId>0
    && Number.isSafeInteger(claims.expiresAt);
}
function signature(payload:Buffer,secret:string):Buffer {
  const key=createHmac("sha256",secret).update("yugidraft:draft-room:v2").digest();
  return createHmac("sha256",key).update(payload).digest();
}
// events.ts:122–125, inside the existing draft:join handler:
const userId=payload?.userId;
const claims=typeof userId==="number"&&Number.isSafeInteger(userId)&&userId>0
  ? verifyDraftRoomToken(payload?.token,opts.secret,{slug,userId}) : null;
```

Change `verifyDraftRoomToken`'s expected argument to `{slug:string;userId:number}` and events.ts's `DraftJoinPayload.userId` to number. Preserve every other verifier branch.

In events.test.ts change emitJoin's userId to 101. In draft-access.test.ts insert users 101/102 first; use players.user_id=101 with player ID 1, and creator user ID 102. Change `join` helper's userId parameter to number, mapping player/creator/outsider test values to 101/102/103. In draft-token.test.ts change the old invalid `userId: ""` fixture to `userId: 0`; signed raw-string rejection is tested by signRaw, so the typed create function still receives its declared numeric type. Keep tests for permission changes between joins/broadcasts and expired subscriptions. Add a raw string socket payload test using the already-defined `client`, `connect` and `error` fixtures:

```ts
it("rejects a string user ID before room admission", () => {
  const c=client(); const ack=vi.fn();
  c.handlers.get("draft:join")!({slug:"test-draft",userId:"101",token:"irrelevant"},ack);
  expect(ack).toHaveBeenCalledWith(error);
  expect(c.socket.rooms.has("draft:test-draft")).toBe(false);
});
```

- [ ] **Step 3: Verify tokens and socket admission.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npx vitest run packages/shared/tests/ws/draft-token.test.ts packages/shared/tests/ws/duel-token.test.ts
npm run build --workspace=packages/shared
npm test --workspace=packages/ws
npm run typecheck --workspace=packages/ws
```

Expected: PASS, including the unchanged duel-token suite. Reissue draft tokens/reconnect sockets at deployment; no v1 compatibility fallback.

- [ ] **Checkpoint: stage only this task's files (`packages/shared/src/ws/draft-token.ts`, `packages/ws/src/events.ts`, `packages/shared/tests/ws/draft-token.test.ts`, `packages/ws/tests/draft-access.test.ts`, `packages/ws/tests/events.test.ts`) and stop for orchestrator review; the orchestrator commits.**

### Task 4: Resolve NextAuth sessions to users and preserve explicit Discord guards

**Files:**
- Create: `packages/web/src/lib/user-id.ts`, `packages/web/src/lib/auth-identity.ts`, `packages/web/src/next-auth.d.ts`, `packages/web/tests/user-id.test.ts`, `packages/web/tests/auth-identity.test.ts`.
- Modify: `packages/web/src/lib/auth.ts:99–147`, `web-access.ts:5–20`, `discord-web-access.ts:9–17`, `duel-host.ts:28–58`, `saved-decks.ts:17–36,87`, `cube-access.ts:25–33` (all under packages/web/src/lib).
- Modify tests: `packages/web/tests/auth-guild-access.test.ts:5,19,47`, `packages/web/tests/access-enforcement.test.ts:6,37`, `packages/web/tests/duel-actor-auth.test.ts:33,56`, `packages/web/tests/auth-public-routes.test.ts:1`, `packages/web/tests/auth-e2e-provider.test.ts:17,140`.
- Read: `packages/web/proxy.ts:1` exports auth as the Next.js 16 Node proxy, `packages/web/src/lib/db.ts:7` exposes `getDb():Database.Database`. Do not initialize DB at module import/build time.

**Interfaces:**
- Consumes: `getDb():Database.Database`; `createUserService(db).ensureDiscord({discordUserId:string,displayName:string,email?:string|null,emailVerified?:boolean}):User`; `.findById(number)`/`.findByDiscordId(string)`; `User.id:number`, `.discordUserId:string|null`.
- Produces: `parseUserId(value:unknown):number|null` (canonical decimal strings only); `ensureAuthIdentity(input:{discordUserId:string;displayName:string;providerEmail?:unknown;providerVerified?:unknown;captureEmail:boolean}):User`; `resolveJwtIdentity(discordUserId:unknown):User|null`.
- Produces: `Session.user.id:string`, `Session.user.discordUserId:string|null`, `JWT.userId?:number`, `JWT.discordId?:string`; `requireWebAccess(level?:"member"|"admin"):Promise<{ok:true;userId:number;discordUserId:string;userName:string}|{ok:false;response:NextResponse}>`.
- Produces: `cubeWriteAccess(db:Database.Database,cubeId:number,actor:{userId:number;discordUserId:string}):Promise<NextResponse|null>`; `requireSavedDeckActor():Promise<{ok:true;guildId:string;ownerUserId:number;discordUserId:string;decks:SavedDeckService}|{ok:false;response:NextResponse}>`; `loadDeckRegistrations(guildId:string,ownerUserId:number):DeckRegistration[]`.
- Preserves: `requireDuelActor():Promise<{ok:true;guildId:string;playerId:number;duels:DuelService}|{ok:false;response:NextResponse}>`, `checkDiscordWebAccess(discordUserId:string,level?:"member"|"admin"):Promise<DiscordGuildMembershipDecision>` (parameter rename, same Discord semantics), existing 401/403/503 behaviors and public paths.

- [ ] **Step 1: Write boundary and provider-email tests.** user-id.test.ts:

```ts
import {expect,it} from "vitest";
import {parseUserId} from "../src/lib/user-id";
it.each(["1","101",String(Number.MAX_SAFE_INTEGER)])("accepts canonical %s", value => {
  expect(parseUserId(value)).toBe(Number(value));
});
it.each([undefined,null,101,"", "0", "01", " 1", "+1", "1.0", "1e3", "-1", "9007199254740992"])("rejects %s", value => {
  expect(parseUserId(value)).toBeNull();
});
```

In auth-identity.test.ts use a real in-memory DB and mock only getDb; identity resolution is local SQL, no network:

```ts
import Database from "better-sqlite3";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
const state=vi.hoisted(() => ({db:null as Database.Database|null}));
vi.mock("@/lib/db", () => ({getDb:() => state.db!}));
import {ensureAuthIdentity,resolveJwtIdentity} from "../src/lib/auth-identity";
beforeEach(() => { state.db=new Database(":memory:"); migrate(state.db); });
afterEach(() => state.db?.close());
it("captures provider verification only and clears stale email trust", () => {
  const input={discordUserId:"900000000000000101",displayName:"Yugi",captureEmail:true};
  const first=ensureAuthIdentity({...input,providerEmail:" YUGI@Example.COM ",providerVerified:true});
  expect(first).toMatchObject({email:"yugi@example.com",emailVerified:true});
  const next=ensureAuthIdentity({...input,providerEmail:"other@example.com",providerVerified:"true"});
  expect(next).toMatchObject({id:first.id,email:"other@example.com",emailVerified:false});
  expect(resolveJwtIdentity(input.discordUserId)?.id).toBe(first.id);
  expect(ensureAuthIdentity({...input,providerEmail:undefined,providerVerified:false})).toMatchObject({email:null,emailVerified:false});
});
it("does not capture an email from a credential user object", () => {
  const user=ensureAuthIdentity({discordUserId:"900000000000000101",displayName:"E2E",providerEmail:"x@example.com",providerVerified:true,captureEmail:false});
  expect(user).toMatchObject({email:null,emailVerified:false});
});
it("never interprets a legacy token sub as an application ID", () => {
  expect(resolveJwtIdentity(undefined)).toBeNull();
  expect(resolveJwtIdentity("clerk:123")).toBeNull();
});
```

Run: `npx vitest run packages/web/tests/user-id.test.ts packages/web/tests/auth-identity.test.ts -c packages/web/vitest.config.ts`.
Expected: FAIL, new modules absent.

- [ ] **Step 2: Implement parsing and deferred DB resolution.**

```ts
// user-id.ts is browser-safe; it imports no DB, auth or node modules.
export function parseUserId(value:unknown):number|null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const id=Number(value);
  return Number.isSafeInteger(id) && String(id) === value ? id : null;
}
```

```ts
// auth-identity.ts
import {createUserService,type User} from "@yugidraft/shared/services";
import {getDb} from "./db";
export function ensureAuthIdentity(input:{discordUserId:string;displayName:string;providerEmail?:unknown;providerVerified?:unknown;captureEmail:boolean}):User {
  const users=createUserService(getDb());
  return users.ensureDiscord({discordUserId:input.discordUserId,displayName:input.displayName,
    ...(input.captureEmail ? {email:typeof input.providerEmail === "string" ? input.providerEmail : null,emailVerified:input.providerVerified === true} : {})});
}
export function resolveJwtIdentity(discordUserId:unknown):User|null {
  if (typeof discordUserId !== "string" || !/^[0-9]{1,25}$/.test(discordUserId)) return null;
  const users=createUserService(getDb());
  return users.findByDiscordId(discordUserId) ?? users.ensureDiscord({discordUserId,displayName:`Duelist ${discordUserId}`});
}
```

```ts
// src/next-auth.d.ts
import type {DefaultSession} from "next-auth";
declare module "next-auth" {
  interface Session { user: DefaultSession["user"] & {id:string;discordUserId:string|null} }
}
declare module "next-auth/jwt" {
  interface JWT {userId?:number;discordId?:string}
}
export {};
```

- [ ] **Step 3: Replace signIn/jwt/session identity bodies and authorized's Discord argument.** Import `ensureAuthIdentity`/`resolveJwtIdentity` into auth.ts; they open the DB only when invoked. The current comment at auth.ts:44 describing Edge is stale for proxy.ts; adjust that comment without replacing the proxy.

```ts
import type {NextAuthConfig} from "next-auth";
const identityCallbacks:Pick<NonNullable<NextAuthConfig["callbacks"]>,"signIn"|"jwt"|"session">={
async signIn({user,profile,account}) {
  const discordUserId=typeof profile?.id === "string" ? profile.id : user.id;
  if (!discordUserId) return accessErrorPage(403);
  const decision=await checkDiscordWebAccess(discordUserId);
  if (!decision.ok) return accessErrorPage(decision.status);
  ensureAuthIdentity({discordUserId,displayName:user.name ?? "Unknown",
    providerEmail:profile?.email,providerVerified:profile?.verified,
    captureEmail:account?.provider === "discord"});
  return true;
},
async jwt({token,account,profile,user}) {
  if (account?.provider === E2E_PROVIDER_ID && user?.id) token.discordId=user.id;
  else if (account?.provider === "discord" && typeof profile?.id === "string") token.discordId=profile.id;
  const identity=resolveJwtIdentity(token.discordId);
  if (identity) token.userId=identity.id;
  else delete token.userId;
  return token;
},
async session({session,token}) {
  const identity=resolveJwtIdentity(token.discordId);
  session.user.id=identity ? String(identity.id) : "";
  session.user.discordUserId=identity?.discordUserId ?? null;
  return session;
},
};
```

Spread `...identityCallbacks` into NextAuth’s callbacks object, replacing the old signIn/jwt/session methods and retaining authorized. In authorized keep the existing public-route logic and 401 guard. Replace its decision line with `const decision = auth.user.discordUserId ? await checkDiscordWebAccess(auth.user.discordUserId) : {ok:false as const,status:403 as const};`, preserving the existing error response/redirect below it. Do not trust token.sub, user.email, a posted numeric ID or an old cached token.userId as authoritative identity. Session resolution rereads by authenticated Discord ID.

- [ ] **Step 4: Implement the common actor and adapt library ownership.**

```ts
// web-access.ts (imports: NextResponse, auth, parseUserId, checkDiscordWebAccess,
// webAccessError, WebAccessLevel from the existing modules)
export async function requireWebAccess(level:WebAccessLevel="member") {
  const session=await auth();
  const userId=parseUserId(session?.user?.id);
  const discordUserId=session?.user?.discordUserId;
  if (userId === null || !discordUserId) return {ok:false as const,response:NextResponse.json({error:"Unauthorized"},{status:401})};
  const decision=await checkDiscordWebAccess(discordUserId,level);
  if (!decision.ok) return {ok:false as const,response:NextResponse.json({error:webAccessError(decision.status)},{status:decision.status})};
  return {ok:true as const,userId,discordUserId,userName:session?.user?.name ?? "Unknown"};
}
```

Import requireWebAccess in duel-host.ts and saved-decks.ts; replace their actor functions with:

```ts
export async function requireDuelActor():Promise<DuelActor> {
  const actor=await requireWebAccess();
  if(!actor.ok)return actor;
  const guildId=env.discordGuildId;
  if(!guildId)return {ok:false,response:NextResponse.json({error:"Guild is not configured"},{status:500})};
  const player=createPlayerService(getDb()).findOrCreate(guildId,actor.userId,actor.userName);
  return {ok:true,guildId,playerId:player.id,duels:createDuelService(getDb())};
}
export async function requireSavedDeckActor():Promise<SavedDeckActor> {
  const actor=await requireWebAccess();
  if(!actor.ok)return actor;
  const guildId=env.discordGuildId;
  if(!guildId)return {ok:false,response:NextResponse.json({error:"Guild is not configured"},{status:500})};
  return {ok:true,guildId,ownerUserId:actor.userId,discordUserId:actor.discordUserId,decks:createSavedDeckService(getDb())};
}
```

Use each existing module's imported symbols and its declared union (DuelActor unchanged; SavedDeckActor's success arm becomes `{ok:true;guildId:string;ownerUserId:number;discordUserId:string;decks:SavedDeckService}`). Remove their independent raw session/membership imports. cubeWriteAccess selects creator as number and uses:

```ts
if (cube.created_by_user_id === actor.userId) return null;
const decision=await checkDiscordWebAccess(actor.discordUserId,"admin");
return decision.ok ? null : NextResponse.json({error:webAccessError(decision.status)},{status:decision.status});
```

Rename discord-web-access's parameter `userId` to `discordUserId` and preserve verifier object property `userId:discordUserId`. Change saved-deck registration loader owner parameter to number. T5 updates every cubeWriteAccess caller to pass the actor object.

- [ ] **Step 5: Test callback integration and Discord argument separation.** In auth-guild-access.test.ts add these imports and the DB mock, retaining the existing NextAuth config-capture mock and `callbacks()` helper:

```ts
import Database from "better-sqlite3";
import {migrate} from "@yugidraft/shared/db";
const identityState=vi.hoisted(()=>({db:null as Database.Database|null}));
vi.mock("@/lib/db",()=>({getDb:()=>identityState.db!}));
```

In its existing beforeEach initialize `identityState.db=new Database(":memory:"); migrate(identityState.db);`; in afterEach close it. Change membership fixture `"member"` to `"900000000000000101"`; request() auth is `{user:{id:"101",discordUserId:"900000000000000101"}}`. Sign-in fixtures include `account:{provider:"discord"}` for provider email tests. Keep `callbacks()` from auth-guild-access.test.ts:19, which imports auth and returns the captured callback object. Add:

```ts
it("lazily upgrades a signed old JWT and emits string application ID", async () => {
  const cb=await callbacks();
  const token=await cb.jwt({token:{discordId:"900000000000000101",sub:"999"}});
  const session=await cb.session({session:{user:{name:"Yugi"}},token});
  expect(token.userId).toEqual(expect.any(Number));
  expect(session.user.id).toBe(String(token.userId));
  expect(session.user.id).not.toBe("999");
  expect(session.user.discordUserId).toBe("900000000000000101");
});
it("does not resolve sub when discordId is absent", async () => {
  const cb=await callbacks();
  const token=await cb.jwt({token:{sub:"101"}});
  expect((await cb.session({session:{user:{}},token})).user.id).toBe("");
});
```

Update proxy/access fixtures to `{user:{id:"101",discordUserId:"900000000000000101"}}`. Assert the mocked fetch path contains `/members/900000000000000101` and never `/members/101`. Denied sign-ins must leave users count unchanged. In the duel actor test assert player.user_id matches the session integer while player.id stays independent. Build validates that SQLite is allowed in the Next.js 16 Node proxy and stays out of client bundles.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npx vitest run packages/web/tests/user-id.test.ts packages/web/tests/auth-identity.test.ts packages/web/tests/auth-guild-access.test.ts packages/web/tests/access-enforcement.test.ts packages/web/tests/duel-actor-auth.test.ts packages/web/tests/auth-public-routes.test.ts -c packages/web/vitest.config.ts
```

Expected: PASS for this auth/guard slice; T5 converts remaining route callers before the whole-web typecheck/build gate.

- [ ] **Checkpoint: stage only this task's files (`packages/web/src/lib/user-id.ts`, `packages/web/src/lib/auth-identity.ts`, `packages/web/src/next-auth.d.ts`, `packages/web/src/lib/auth.ts`, `packages/web/src/lib/web-access.ts`, `packages/web/src/lib/discord-web-access.ts`, `packages/web/src/lib/duel-host.ts`, `packages/web/src/lib/saved-decks.ts`, `packages/web/src/lib/cube-access.ts`, `packages/web/tests/user-id.test.ts`, `packages/web/tests/auth-identity.test.ts`, `packages/web/tests/auth-guild-access.test.ts`, `packages/web/tests/access-enforcement.test.ts`, `packages/web/tests/duel-actor-auth.test.ts`, `packages/web/tests/auth-public-routes.test.ts`, `packages/web/tests/auth-e2e-provider.test.ts`) and stop for orchestrator review; the orchestrator commits.**


### Task 5: Convert every web route, page, UI owner and announcement adapter

**Files:**
- Modify the exact source inventory below; line references show existing identity consumption. Route families include decks/player/players even where the broad grep only finds the actor helper. Keep admin/season and settings routes in PR 1.
- Create: `packages/web/tests/identity-routes.test.ts`.
- Modify identity/session fixtures in the exact test inventory below. The store itself is read-only: `packages/web/src/lib/stores/draft-store.ts:21–43` has only player IDs.

**Interfaces:**
- Consumes: `parseUserId(value:unknown):number|null`; `requireWebAccess(level?:"member"|"admin"):Promise<{ok:true;userId:number;discordUserId:string;userName:string}|{ok:false;response:NextResponse}>`; `auth():Promise<Session|null>` where session.user.id is a string application ID and session.user.discordUserId is a separate nullable string.
- Consumes: `createUserService(db).findById(id:number):User|undefined` with User.discordUserId:string|null. Player service `findOrCreate(guildId:string,userId:number,displayName:string):Player`, `findByGuildAndUser(guildId:string,userId:number):Player|undefined`, `findOrCreateTestPlayer(guildId:string,legacyKey:string,displayName:string):Player`; Player.id is gameplay ID and Player.userId is ownership ID.
- Consumes: `cubeWriteAccess(db,cubeId:number,actor:{userId:number;discordUserId:string}):Promise<NextResponse|null>`; `requireSavedDeckActor()` returns ownerUserId:number. Saved-deck service `list(guildId:string,ownerUserId:number)`, `get(id:number,guildId:string,ownerUserId:number)`, `findByDraft(guildId:string,ownerUserId:number,draftId:number)`; returned SavedDeck keeps its current fields.
- Consumes: `createDraftService(db).create(guildId:string,channelId:string|null,name:string,config:DraftConfig,createdByUserId:number,creatorPlayerId:number):Draft`; `.expireCurrentPickStep(draftId:number,now?:Date):{autoPickedPlayerIds:number[]}`; `createDraftRoomToken({slug:string,guildId:string,userId:number,expiresAt:number},secret:string):string`; 60,000ms TTL.
- Produces: `buildDraftResponse(slug:string,actor:{userId:number;discordUserId:string}):Promise<object>` (retain its existing response object); `draftReadAccess(db,slug:string,guildId:string,userId:number):NextResponse|null`; `findDraftDeckContext(db,guildId:string,userId:number,lookup:{id?:number;slug?:string})` with existing discriminated result; `backfillDraftDecks(guildId:string,userId:number,db?:Database.Database):void`; its local DraftDeckApi.ensureForUser(guildId:string,userId:number):number[] and saveForDraft(draftId:number):number[] declarations also become numeric; `findRejoinDrafts(db,guildId:string,userId:number):RejoinDraft[]`; `checkDraftDeckWrite(guildId:string,ownerUserId:number,draftId:number,deck:unknown)` keeps its current result union.
- Produces: `playerIdentity(db,playerId:number):{id:number;userId:number;discordUserId:string|null;displayName:string}|null` via canonical users join. Client DTO createdByUserId:number, currentUserId:number|null, pool creatorId:number|null; fetchSessionUserId():Promise<number|null>. Store Seat.playerId and tournament.currentUserPlayerId remain numbers referring to players.
- Preserves: announce payload `organizerUserId:string` is an explicitly documented **Discord** field in the existing contract; always supply actor.discordUserId or the owner's canonical user lookup. reporterDiscordId/opponentDiscordId/opponentDiscordUserId remain actual Discord account strings, never String(users.id).

- [ ] **Step 1: Add real route tests with deliberately different user/player/Discord IDs.** identity-routes.test.ts:

```ts
import Database from "better-sqlite3";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
const state=vi.hoisted(() => ({db:null as Database.Database|null,userId:"101",discordId:"900000000000000101",admin:false}));
vi.mock("@/lib/db", () => ({getDb:() => state.db!}));
vi.mock("@/lib/auth", () => ({auth:async () => ({user:{id:state.userId,discordUserId:state.discordId,name:"Host"}})}));
vi.mock("@/lib/env", () => ({env:{discordGuildId:"g",wsInternalSecret:"secret",defaultChannelId:"channel"}}));
const access=vi.hoisted(() => vi.fn());
vi.mock("@/lib/discord-web-access", () => ({checkDiscordWebAccess:access,webAccessError:() => "Forbidden"}));
beforeEach(() => {
  state.db=new Database(":memory:"); migrate(state.db); state.db.pragma("foreign_keys=on");
  state.db.exec(`insert into users(id,username,display_name,discord_user_id) values
    (101,'host','Host','900000000000000101'),(102,'other','Other','900000000000000102');
    insert into players(id,guild_id,user_id,discord_user_id,display_name) values(1,'g',101,'900000000000000101','Host');
    insert into cubes(id,guild_id,name,created_by_user_id) values(8,'g','Cube',101),(9,'other','Foreign',101);`);
  state.userId="101"; state.discordId="900000000000000101"; state.admin=false;
  access.mockReset().mockImplementation(async (_id:string,level="member") => level === "admin" && !state.admin ? {ok:false,status:403} : {ok:true});
});
afterEach(() => state.db?.close());
it("lets the numeric owner edit, preserves Discord admin overrides, and scopes guilds", async () => {
  const {DELETE}=await import("../app/api/cubes/[id]/route");
  state.userId="102"; state.discordId="900000000000000102";
  const request=new Request("http://localhost/api/cubes/8",{method:"DELETE"});
  expect((await DELETE(request,{params:Promise.resolve({id:"8"})})).status).toBe(403);
  expect(access).toHaveBeenCalledWith("900000000000000102","admin");
  state.admin=true;
  expect((await DELETE(request,{params:Promise.resolve({id:"8"})})).status).toBe(200);
  expect((await DELETE(request,{params:Promise.resolve({id:"9"})})).status).toBe(404);
});
it("lets a creator whose application ID is a string session value delete their cube", async () => {
  const {DELETE}=await import("../app/api/cubes/[id]/route");
  expect((await DELETE(new Request("http://localhost/api/cubes/8",{method:"DELETE"}),{params:Promise.resolve({id:"8"})})).status).toBe(200);
  expect(access.mock.calls.some(call => call[0] === "101")).toBe(false);
});
it("rejects noncanonical session IDs at a mutation boundary", async () => {
  state.userId="0101";
  const {DELETE}=await import("../app/api/cubes/[id]/route");
  expect((await DELETE(new Request("http://localhost/api/cubes/8",{method:"DELETE"}),{params:Promise.resolve({id:"8"})})).status).toBe(401);
});
```

Run: `npx vitest run packages/web/tests/identity-routes.test.ts -c packages/web/vitest.config.ts`.
Expected: FAIL until cube route passes both actor IDs to cubeWriteAccess.

- [ ] **Step 2: Replace server ownership boundaries in the source inventory.** For route handlers currently reading auth directly, use the following opening, then replace session.user.id ownership uses with actor.userId and session.user.name with actor.userName. Keep each route's existing 404/status/body validation logic and guild filters.

```ts
const actor=await requireWebAccess();
if (!actor.ok) return actor.response;
const player=createPlayerService(db).findOrCreate(guildId,actor.userId,actor.userName);
// Raw lookup: bind a number, never a session string or Discord ID.
const currentPlayer=db.prepare("select id from players where guild_id=? and user_id=?")
  .get(guildId,actor.userId) as {id:number}|undefined;
// Resource owner guard:
if (draft.created_by_user_id !== actor.userId) {
  return NextResponse.json({error:"Only the draft creator can start a draft"},{status:403});
}
```

For server-rendered pages keep auth/redirect behavior and compute once:

```ts
const userId=parseUserId(session?.user?.id);
if (userId === null) redirect("/login");
const player=db.prepare("select id from players where user_id=? and guild_id=?")
  .get(userId,env.discordGuildId) as {id:number}|undefined;
```

Apply these exact special cases:

| Current site | Required replacement |
|---|---|
| cubes/route.ts:44 creator display lookup | `select u.display_name from users u where u.id=c.created_by_user_id`; this handles creators without players. Owner comparison uses actor.userId; admin check uses actor.discordUserId. |
| cubes/[id]/route.ts:14 | Return `{cubeId,guildId,userId:actor.userId,discordUserId:actor.discordUserId}`; pass ctx to cubeWriteAccess. cards/route.ts passes actor. |
| drafts/[slug]/helpers.ts:86,339 | Accept actor object, assign `const userId=actor.userId`, admin verification `checkDiscordWebAccess(actor.discordUserId,"admin")`. Retain opportunistic expiration at :99 and deck hooks. |
| drafts/[slug]/tournament/route.ts:39–77 | Compare integer owners; verify Discord admin and pass that result as actorIsAdmin. |
| drafts/[slug]/connection/route.ts:24 | Sign `{slug,guildId,userId:actor.userId,expiresAt:Date.now()+DRAFT_ROOM_TOKEN_TTL_MS}` and return numeric userId. |
| drafts/[slug]/join-bot/route.ts and tournaments/[slug]/join-bot/route.ts:52 | Resolve host numerically; use findOrCreateTestPlayer for the existing legacy bot keys. Never send synthetic keys to ensureDiscord. |
| drafts/[slug]/pick/route.ts:82 | Keep explicit synthetic player-key classification for auto-picking; no NULL-to-bot fallback. Ownership/lookups use p.user_id. |
| tournaments/[slug]/matches/[tmId]/duel/route.ts:47–50 | Select actor's `user_id`, compare to integer creator. Duel arguments remain player IDs. |
| duels/series/[id]/cancel/route.ts:28–30 | Parse session ID once or use actor.userId from requireWebAccess; compare integer creator. |
| bug-reports/precheck/route.ts:44 and route.ts:112 | Find player by user_id. Redaction values use `actor.discordUserId`, actor.userName, player.displayName and guildId; do not pass a number to string redaction. |
| decks/draft-deck.ts:92, draft-deck-pool.ts:34 | owner/user parameters become number; draft pool player SQL uses p.user_id. |
| admin/season and settings routes | Retain `requireWebAccess("admin")`; season.start receives actor.userId. |

- [ ] **Step 3: Translate external-message identities at the adapter, retaining Discord functionality.** Replace player-lookup.ts with:

```ts
import type Database from "better-sqlite3";
export type PlayerIdentity={id:number;userId:number;discordUserId:string|null;displayName:string};
export function playerIdentity(db:Database.Database,playerId:number):PlayerIdentity|null {
  const row=db.prepare(`select p.id,p.user_id,u.discord_user_id,p.display_name
    from players p join users u on u.id=p.user_id where p.id=?`).get(playerId) as
    {id:number;user_id:number;discord_user_id:string|null;display_name:string}|undefined;
  return row ? {id:row.id,userId:row.user_id,discordUserId:row.discord_user_id,displayName:row.display_name} : null;
}
```

For tournament-created payloads use this lookup, and return the existing 400 error when there is no valid Discord organizer/channel instead of sending an integer mention:

```ts
const organizer=createUserService(db).findById(tournament.created_by_user_id);
if (!organizer?.discordUserId) return NextResponse.json({error:"Organizer has no linked Discord account"},{status:400});
const result=await announcer.announce({kind:"tournament-created",tournamentId:tournament.id,
  channelId,name:tournament.name,format:tournament.format,webSlug:tournament.web_slug,
  organizerUserId:organizer.discordUserId,participantCount});
```

In tournament report notifications join `users ru on ru.id=rp.user_id` and `users ou on ou.id=op.user_id`, select `ru.discord_user_id`/`ou.discord_user_id`, and emit only when both exist. Duel invitations use `if (recipient?.discordUserId)` before sendDuelInvite; actual interaction/DM IDs remain Discord strings. Draft announce calls are guarded by `if (draft.channelId && draft.webSlug)` because schema now permits NULL, even though PR 1 create forms still require channels. An absent Discord link must never prevent saving a report/duel or broadcasting its committed WS state.

- [ ] **Step 4: Convert browser comparisons and helper signatures.** Import the browser-safe parseUserId from user-id.ts and apply:

```ts
const [currentUserId,setCurrentUserId]=useState<number|null>(null);
// Both draft and tournament pages' session fetch callbacks:
setCurrentUserId(parseUserId(session?.user?.id));
// Pool API:
export async function fetchSessionUserId():Promise<number|null> {
  const res=await fetch("/api/auth/session");
  if (!res.ok) return null;
  const session=await res.json();
  return parseUserId(session?.user?.id);
}
```

`createdByUserId` fields in draft page, draft-manage-view, draft-summary-view, tournament types and pool-api become number. `CubePickerProps.userId`, `use-pool-editor.userId` and `Meta.creatorId` become number|null; replace `?? ""` identity defaults with `?? null`. Require non-null userId before constructing a saved cube's numeric createdByUserId; use the saved API response's creator value. Keep seats/gameplay fields in draft-store unchanged and assert existing store/pick regressions remain green. `use-draft-websocket.ts:66` consumes connection.userId as a number; no String()/Number() workaround at socket emit.

- [ ] **Step 5: Update every web fixture and extend permissions/announcement assertions.** Use real users before raw players/owners. Example for existing setup functions:

```ts
const userId=Number(db.prepare("insert into users(username,display_name,discord_user_id) values('host','Host','900000000000000101')").run().lastInsertRowid);
const playerId=Number(db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g1',?,'900000000000000101','Host')").run(userId).lastInsertRowid);
auth.mockResolvedValue({user:{id:String(userId),discordUserId:"900000000000000101",name:"Host"}});
// Existing announcement route assertion:
expect(announcer.announce).toHaveBeenCalledWith(expect.objectContaining({organizerUserId:"900000000000000101"}));
// Existing bug-report fixture assertion:
expect(db.prepare("select player_id from bug_reports order by id desc limit 1").get()).toEqual({player_id:playerId});
```

Keep existing creator/noncreator/admin/cross-guild tests for drafts, cubes, tournaments, decks, matches and season writes. Change assertions that deliberately compare old strings to numeric owner values. Add `expect(Number.isSafeInteger(connection.userId)).toBe(true)` to drafts-read-access.test.ts after connection JSON, and verify a stranger's token remains refused. Extend deck route tests with user 101/player 1 vs user 102/player 2 so saved-deck deletion and registrations cannot cross owners. Extend the current page tests so session `"101"` and API creator `101` display host controls, but creator `102` does not.

**Exhaustive source inventory (inspection grep and classification):**

The scan is `rg -n 'session\??\.user\??\.id|requireWebAccess|userId|UserId|created_by_user_id|owner_user_id|discord_user_id' packages/web/app packages/web/src`, supplemented with `ownerUserId`, `/api/auth/session`, playerIdentity and both deck routes. Presence-only auth readers are listed as audit-only; all other listed sources are modified unless T4 owns them.
- Modify: `packages/web/app/(app)/dashboard/page.tsx:25`.
- Modify: `packages/web/app/(app)/draft/[slug]/page.tsx:35`.
- Modify: `packages/web/app/(app)/drafts/page.tsx:22`.
- Modify: `packages/web/app/(app)/leaderboard/page.tsx:11`.
- Modify: `packages/web/app/(app)/player/[id]/page.tsx:28`.
- Modify: `packages/web/app/(app)/tournament/[slug]/page.tsx:19`.
- Modify: `packages/web/app/(app)/tournaments/page.tsx:19`.
- Modify: `packages/web/app/api/admin/season/route.ts:3`.
- Audit only: `packages/web/app/api/archetypes/route.ts:11`.
- Modify: `packages/web/app/api/bug-reports/precheck/route.ts:11`.
- Modify: `packages/web/app/api/bug-reports/route.ts:10`.
- Audit only: `packages/web/app/api/cards/resolve/route.ts:45`.
- Modify: `packages/web/app/api/cubes/[id]/cards/route.ts:3`.
- Modify: `packages/web/app/api/cubes/[id]/route.ts:2`.
- Modify: `packages/web/app/api/cubes/[id]/ydk/route.ts:2`.
- Modify: `packages/web/app/api/cubes/route.ts:21`.
- Modify: `packages/web/app/api/dashboard/route.ts:11`.
- Modify: `packages/web/app/api/decks/[id]/route.ts:30`.
- Modify: `packages/web/app/api/decks/draft-deck.ts:92`.
- Modify: `packages/web/app/api/decks/route.ts:21`.
- Audit only: `packages/web/app/api/discord/channels/route.ts:9`.
- Modify: `packages/web/app/api/drafts/[slug]/claim-cube/route.ts:13`.
- Modify: `packages/web/app/api/drafts/[slug]/connection/route.ts:12`.
- Modify: `packages/web/app/api/drafts/[slug]/cubes/route.ts:16`.
- Modify: `packages/web/app/api/drafts/[slug]/deck-pool/route.ts:18`.
- Modify: `packages/web/app/api/drafts/[slug]/export/route.ts:16`.
- Modify: `packages/web/app/api/drafts/[slug]/helpers.ts:86`.
- Modify: `packages/web/app/api/drafts/[slug]/join/route.ts:16`.
- Modify: `packages/web/app/api/drafts/[slug]/join-bot/route.ts:19`.
- Modify: `packages/web/app/api/drafts/[slug]/pick/route.ts:32`.
- Modify: `packages/web/app/api/drafts/[slug]/pool/route.ts:14`.
- Modify: `packages/web/app/api/drafts/[slug]/preflight/route.ts:13`.
- Modify: `packages/web/app/api/drafts/[slug]/route.ts:29`.
- Modify: `packages/web/app/api/drafts/[slug]/talk/route.ts:17`.
- Modify: `packages/web/app/api/drafts/[slug]/tournament/route.ts:17`.
- Modify: `packages/web/app/api/drafts/draft-deck-pool.ts:34`.
- Modify: `packages/web/app/api/drafts/route.ts:19`.
- Modify: `packages/web/app/api/duels/route.ts:120`.
- Modify: `packages/web/app/api/duels/series/[id]/cancel/route.ts:28`.
- Audit only: `packages/web/app/api/leaderboard/route.ts:11`.
- Modify: `packages/web/app/api/matches/[id]/approve/route.ts:16`.
- Modify: `packages/web/app/api/matches/[id]/deny/route.ts:16`.
- Audit only: `packages/web/app/api/player/[id]/route.ts:11`.
- Modify: `packages/web/app/api/player/me/route.ts:10`.
- Modify: `packages/web/app/api/players/route.ts:1`.
- Audit only: `packages/web/app/api/sets/route.ts:19`.
- Audit only: `packages/web/app/api/settings/route.ts:4`.
- Modify: `packages/web/app/api/tournaments/[slug]/announce/route.ts:21`.
- Modify: `packages/web/app/api/tournaments/[slug]/complete/route.ts:17`.
- Modify: `packages/web/app/api/tournaments/[slug]/deck/route.ts:34`.
- Modify: `packages/web/app/api/tournaments/[slug]/join/route.ts:17`.
- Modify: `packages/web/app/api/tournaments/[slug]/join-bot/route.ts:11`.
- Modify: `packages/web/app/api/tournaments/[slug]/kick/route.ts:16`.
- Modify: `packages/web/app/api/tournaments/[slug]/leave/route.ts:16`.
- Modify: `packages/web/app/api/tournaments/[slug]/matches/[tmId]/duel/route.ts:27`.
- Modify: `packages/web/app/api/tournaments/[slug]/matches/[tmId]/result/route.ts:18`.
- Modify: `packages/web/app/api/tournaments/[slug]/reopen/route.ts:16`.
- Modify: `packages/web/app/api/tournaments/[slug]/report/route.ts:15`.
- Modify: `packages/web/app/api/tournaments/[slug]/route.ts:26`.
- Modify: `packages/web/app/api/tournaments/route.ts:23`.
- Modify: `packages/web/src/components/draft/draft-manage-view.tsx:41`.
- Modify: `packages/web/src/components/draft/draft-summary-view.tsx:40`.
- Modify: `packages/web/src/components/draft/pool/cube-picker.tsx:12`.
- Audit only: `packages/web/src/components/draft/pool/cube-summary.tsx:27`.
- Modify: `packages/web/src/components/draft/pool/pool-api.ts:14`.
- Audit only: `packages/web/src/components/draft/pool/pool-editor.tsx:56`.
- Modify: `packages/web/src/components/draft/pool/use-pool-editor.ts:13`.
- Modify: `packages/web/src/components/layout/use-shell-account.ts:27`.
- Audit only: `packages/web/src/components/tournament/sheet/tournament-sheet.tsx:96`.
- Modify: `packages/web/src/components/tournament/tournament-lobby.tsx:20`.
- Modify: `packages/web/src/components/tournament/types.ts:51`.
- T4 owns: `packages/web/src/lib/auth.ts:100`.
- T4 owns: `packages/web/src/lib/cube-access.ts:25`.
- Audit only: `packages/web/src/lib/discord-guild-admin.ts:8`.
- Audit only: `packages/web/src/lib/discord-guild-membership.ts:25`.
- T4 owns: `packages/web/src/lib/discord-web-access.ts:10`.
- Modify: `packages/web/src/lib/draft-access.ts:6`.
- Modify: `packages/web/src/lib/draft-decks.ts:17`.
- T4 owns: `packages/web/src/lib/duel-host.ts:34`.
- Modify: `packages/web/src/lib/hooks/use-draft-websocket.ts:66`.
- Modify: `packages/web/src/lib/player-lookup.ts:3`.
- Modify: `packages/web/src/lib/rejoin-drafts.ts:14`.
- T4 owns: `packages/web/src/lib/saved-decks.ts:18`.
- T4 owns: `packages/web/src/lib/web-access.ts:5`.

**Exact web test/fixture inventory:**

- Modify fixture: `packages/web/tests/admin-season-route.test.ts:26`.
- Modify fixture: `packages/web/tests/api/dashboard-stats.test.ts:15`.
- Modify fixture: `packages/web/tests/api/matches-approve-deny.test.ts:23`.
- Modify fixture: `packages/web/tests/api/tournaments-announce-route.test.ts:16`.
- Modify fixture: `packages/web/tests/api/tournaments-complete-route.test.ts:18`.
- Modify fixture: `packages/web/tests/api/tournaments-create-route.test.ts:15`.
- Modify fixture: `packages/web/tests/api/tournaments-id-route.test.ts:15`.
- Modify fixture: `packages/web/tests/api/tournaments-join-bot-route.test.ts:29`.
- Modify fixture: `packages/web/tests/api/tournaments-kick-route.test.ts:16`.
- Modify fixture: `packages/web/tests/api/tournaments-leave-route.test.ts:28`.
- Modify fixture: `packages/web/tests/api/tournaments-start-route.test.ts:16`.
- Modify fixture: `packages/web/tests/bug-reports-precheck-route.test.ts:35`.
- Modify fixture: `packages/web/tests/bug-reports-route.test.ts:37`.
- Modify fixture: `packages/web/tests/card-api-failures.test.ts:8`.
- Modify fixture: `packages/web/tests/cards-resolve-route.test.ts:61`.
- Modify fixture: `packages/web/tests/components/dashboard/tournament-rounds.test.ts:13`.
- Modify fixture: `packages/web/tests/components/draft-manage-view.test.tsx:21`.
- Modify fixture: `packages/web/tests/components/draft-room/finale-export.test.tsx:57`.
- Modify fixture: `packages/web/tests/components/draft-summary-view.test.tsx:99`.
- Modify fixture: `packages/web/tests/components/drafts-list/list-page.test.tsx:26`.
- Modify fixture: `packages/web/tests/components/shell/app-shell.test.tsx:170`.
- Modify fixture: `packages/web/tests/components/shell/helpers.tsx:25`.
- Modify fixture: `packages/web/tests/components/tournament-detail-page.test.tsx:30`.
- Modify fixture: `packages/web/tests/components/tournament-detail-ratings.test.tsx:32`.
- Modify fixture: `packages/web/tests/components/tournament-lobby.test.tsx:17`.
- Modify fixture: `packages/web/tests/components/tournament-my-deck-panel.test.tsx:9`.
- Modify fixture: `packages/web/tests/components/tournament-rules-form.test.tsx:14`.
- Modify fixture: `packages/web/tests/components/tournaments-pages/list-page.test.tsx:25`.
- Modify fixture: `packages/web/tests/components/use-my-matches.test.ts:7`.
- Modify fixture: `packages/web/tests/cubes-pool-route.test.ts:47`.
- Modify fixture: `packages/web/tests/cubes-route.test.ts:45`.
- Modify fixture: `packages/web/tests/decks-draft-route.test.ts:27`.
- Modify fixture: `packages/web/tests/decks-registration-route.test.ts:18`.
- Modify fixture: `packages/web/tests/draft-deck-codes.test.ts:24`.
- Modify fixture: `packages/web/tests/draft-load-resilience.test.ts:22`.
- Modify fixture: `packages/web/tests/draft-pick-websocket-route.test.ts:65`.
- Modify fixture: `packages/web/tests/draft-pick.test.ts:23`.
- Modify fixture: `packages/web/tests/draft-test-bots.test.ts:44`.
- Modify fixture: `packages/web/tests/draft-tournament-route.test.ts:21`.
- Modify fixture: `packages/web/tests/drafts-booster-preflight.test.ts:7`.
- Modify fixture: `packages/web/tests/drafts-copy-cap-route.test.ts:22`.
- Modify fixture: `packages/web/tests/drafts-create-route.test.ts:18`.
- Modify fixture: `packages/web/tests/drafts-create-theme-route.test.ts:17`.
- Modify fixture: `packages/web/tests/drafts-cubes-route.test.ts:22`.
- Modify fixture: `packages/web/tests/drafts-deck-pool-route.test.ts:35`.
- Modify fixture: `packages/web/tests/drafts-delete-route.test.ts:36`.
- Modify fixture: `packages/web/tests/drafts-pool-route.test.ts:25`.
- Modify fixture: `packages/web/tests/drafts-private-config-route.test.ts:21`.
- Modify fixture: `packages/web/tests/drafts-put-route.test.ts:31`.
- Modify fixture: `packages/web/tests/drafts-read-access.test.ts:45`.
- Modify fixture: `packages/web/tests/drafts-route.test.ts:22`.
- Modify fixture: `packages/web/tests/drafts-talk-route.test.ts:46`.
- Modify fixture: `packages/web/tests/drafts-theme-copy-limit.test.ts:6`.
- Modify fixture: `packages/web/tests/drafts-theme-lobby.test.ts:39`.
- Modify fixture: `packages/web/tests/drafts-theme-numbers.test.ts:6`.
- Modify fixture: `packages/web/tests/drafts-theme-pick-route.test.ts:19`.
- Modify fixture: `packages/web/tests/drafts-theme-response.test.ts:48`.
- Modify fixture: `packages/web/tests/duels-bot-route.test.ts:23`.
- Modify fixture: `packages/web/tests/duels-challenge-route.test.ts:24`.
- Modify fixture: `packages/web/tests/duels-create-master-rule-route.test.ts:30`.
- Modify fixture: `packages/web/tests/duels-join-multiplayer-flag.test.ts:38`.
- Modify fixture: `packages/web/tests/duels-opening-route.test.ts:23`.
- Modify fixture: `packages/web/tests/duels-seat-routes.test.ts:40`.
- Modify fixture: `packages/web/tests/duels-series-first-route.test.ts:25`.
- Modify fixture: `packages/web/tests/duels-series-unready-route.test.ts:23`.
- Modify fixture: `packages/web/tests/duels-unready-route.test.ts:23`.
- Modify fixture: `packages/web/tests/fixtures/matches.ts:50`.
- Modify fixture: `packages/web/tests/fixtures/standings.ts:58`.
- Modify fixture: `packages/web/tests/fixtures/tournament-sheet.ts:38`.
- Modify fixture: `packages/web/tests/helpers/draft-deck-fixture.ts:53`.
- Modify fixture: `packages/web/tests/helpers/pool-fixtures.ts:34`.
- Modify fixture: `packages/web/tests/join-bot-route.test.ts:36`.
- Modify fixture: `packages/web/tests/leaderboard-page.test.tsx:11`.
- Modify fixture: `packages/web/tests/leaderboard-route.test.ts:21`.
- Modify fixture: `packages/web/tests/live-route.test.ts:27`.
- Modify fixture: `packages/web/tests/live-updates-routes.test.ts:28`.
- Modify fixture: `packages/web/tests/match-resolve-notify.test.ts:22`.
- Modify fixture: `packages/web/tests/pages/dashboard-page.test.tsx:31`.
- Modify fixture: `packages/web/tests/pages/draft-detail-page.test.tsx:86`.
- Modify fixture: `packages/web/tests/pages/draft-finale-live-update.test.tsx:34`.
- Modify fixture: `packages/web/tests/player-route.test.ts:21`.
- Modify fixture: `packages/web/tests/players-route.test.ts:17`.
- Modify fixture: `packages/web/tests/rejoin-draft.test.tsx:31`.
- Modify fixture: `packages/web/tests/report-route-notify.test.ts:20`.
- Modify fixture: `packages/web/tests/resource-guild-access.test.ts:22`.
- Modify fixture: `packages/web/tests/resource-guild-reads.test.tsx:16`.
- Modify fixture: `packages/web/tests/settings-route.test.ts:16`.
- Modify fixture: `packages/web/tests/tournament-deck-route.test.ts:28`.
- Modify fixture: `packages/web/tests/tournament-draft-deck-hooks.test.ts:36`.
- Modify fixture: `packages/web/tests/tournament-draft-duel-start.test.ts:37`.
- Modify fixture: `packages/web/tests/tournament-duel-routes.test.ts:27`.
- Modify fixture: `packages/web/tests/tournament-reopen-route.test.ts:26`.
- Modify fixture: `packages/web/tests/tournament-stakes.test.ts:65`.
- Modify fixture: `packages/web/tests/tournaments-create-route.test.ts:43`.
- Modify fixture: `packages/web/tests/tournaments-list-route.test.ts:20`.
- Modify fixture: `packages/web/tests/tournaments-slug-route.test.ts:29`.

- [ ] **Step 6: Run focused routes, all web tests and consumer typecheck.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npx vitest run packages/web/tests/identity-routes.test.ts packages/web/tests/drafts-read-access.test.ts packages/web/tests/draft-tournament-route.test.ts packages/web/tests/api/tournaments-announce-route.test.ts packages/web/tests/bug-reports-route.test.ts packages/web/tests/tournament-deck-route.test.ts -c packages/web/vitest.config.ts
npm test --workspace=packages/web
npm run typecheck --workspace=packages/web
```

Expected: PASS except any specifically recorded baseline failure; no new identity-related failures. The seed-script suite is converted by T8, so until then record that one outstanding cross-task dependency explicitly. A raw session ID may remain in presence checks/parseUserId inputs, never an ownership SQL bind or Discord API input.

- [ ] **Checkpoint: stage only this task's files (`packages/web/app/(app)/dashboard/page.tsx`, `packages/web/app/(app)/draft/[slug]/page.tsx`, `packages/web/app/(app)/drafts/page.tsx`, `packages/web/app/(app)/leaderboard/page.tsx`, `packages/web/app/(app)/player/[id]/page.tsx`, `packages/web/app/(app)/tournament/[slug]/page.tsx`, `packages/web/app/(app)/tournaments/page.tsx`, `packages/web/app/api/admin/season/route.ts`, `packages/web/app/api/bug-reports/precheck/route.ts`, `packages/web/app/api/bug-reports/route.ts`, `packages/web/app/api/cubes/[id]/cards/route.ts`, `packages/web/app/api/cubes/[id]/route.ts`, `packages/web/app/api/cubes/[id]/ydk/route.ts`, `packages/web/app/api/cubes/route.ts`, `packages/web/app/api/dashboard/route.ts`, `packages/web/app/api/decks/[id]/route.ts`, `packages/web/app/api/decks/draft-deck.ts`, `packages/web/app/api/decks/route.ts`, `packages/web/app/api/drafts/[slug]/claim-cube/route.ts`, `packages/web/app/api/drafts/[slug]/connection/route.ts`, `packages/web/app/api/drafts/[slug]/cubes/route.ts`, `packages/web/app/api/drafts/[slug]/deck-pool/route.ts`, `packages/web/app/api/drafts/[slug]/export/route.ts`, `packages/web/app/api/drafts/[slug]/helpers.ts`, `packages/web/app/api/drafts/[slug]/join/route.ts`, `packages/web/app/api/drafts/[slug]/join-bot/route.ts`, `packages/web/app/api/drafts/[slug]/pick/route.ts`, `packages/web/app/api/drafts/[slug]/pool/route.ts`, `packages/web/app/api/drafts/[slug]/preflight/route.ts`, `packages/web/app/api/drafts/[slug]/route.ts`, `packages/web/app/api/drafts/[slug]/talk/route.ts`, `packages/web/app/api/drafts/[slug]/tournament/route.ts`, `packages/web/app/api/drafts/draft-deck-pool.ts`, `packages/web/app/api/drafts/route.ts`, `packages/web/app/api/duels/route.ts`, `packages/web/app/api/duels/series/[id]/cancel/route.ts`, `packages/web/app/api/matches/[id]/approve/route.ts`, `packages/web/app/api/matches/[id]/deny/route.ts`, `packages/web/app/api/player/me/route.ts`, `packages/web/app/api/players/route.ts`, `packages/web/app/api/tournaments/[slug]/announce/route.ts`, `packages/web/app/api/tournaments/[slug]/complete/route.ts`, `packages/web/app/api/tournaments/[slug]/deck/route.ts`, `packages/web/app/api/tournaments/[slug]/join/route.ts`, `packages/web/app/api/tournaments/[slug]/join-bot/route.ts`, `packages/web/app/api/tournaments/[slug]/kick/route.ts`, `packages/web/app/api/tournaments/[slug]/leave/route.ts`, `packages/web/app/api/tournaments/[slug]/matches/[tmId]/duel/route.ts`, `packages/web/app/api/tournaments/[slug]/matches/[tmId]/result/route.ts`, `packages/web/app/api/tournaments/[slug]/reopen/route.ts`, `packages/web/app/api/tournaments/[slug]/report/route.ts`, `packages/web/app/api/tournaments/[slug]/route.ts`, `packages/web/app/api/tournaments/route.ts`, `packages/web/src/components/draft/draft-manage-view.tsx`, `packages/web/src/components/draft/draft-summary-view.tsx`, `packages/web/src/components/draft/pool/cube-picker.tsx`, `packages/web/src/components/draft/pool/pool-api.ts`, `packages/web/src/components/draft/pool/use-pool-editor.ts`, `packages/web/src/components/layout/use-shell-account.ts`, `packages/web/src/components/tournament/tournament-lobby.tsx`, `packages/web/src/components/tournament/types.ts`, `packages/web/src/lib/draft-access.ts`, `packages/web/src/lib/draft-decks.ts`, `packages/web/src/lib/hooks/use-draft-websocket.ts`, `packages/web/src/lib/player-lookup.ts`, `packages/web/src/lib/rejoin-drafts.ts`, `packages/web/tests/identity-routes.test.ts`, `packages/web/tests/admin-season-route.test.ts`, `packages/web/tests/api/dashboard-stats.test.ts`, `packages/web/tests/api/matches-approve-deny.test.ts`, `packages/web/tests/api/tournaments-announce-route.test.ts`, `packages/web/tests/api/tournaments-complete-route.test.ts`, `packages/web/tests/api/tournaments-create-route.test.ts`, `packages/web/tests/api/tournaments-id-route.test.ts`, `packages/web/tests/api/tournaments-join-bot-route.test.ts`, `packages/web/tests/api/tournaments-kick-route.test.ts`, `packages/web/tests/api/tournaments-leave-route.test.ts`, `packages/web/tests/api/tournaments-start-route.test.ts`, `packages/web/tests/bug-reports-precheck-route.test.ts`, `packages/web/tests/bug-reports-route.test.ts`, `packages/web/tests/card-api-failures.test.ts`, `packages/web/tests/cards-resolve-route.test.ts`, `packages/web/tests/components/dashboard/tournament-rounds.test.ts`, `packages/web/tests/components/draft-manage-view.test.tsx`, `packages/web/tests/components/draft-room/finale-export.test.tsx`, `packages/web/tests/components/draft-summary-view.test.tsx`, `packages/web/tests/components/drafts-list/list-page.test.tsx`, `packages/web/tests/components/shell/app-shell.test.tsx`, `packages/web/tests/components/shell/helpers.tsx`, `packages/web/tests/components/tournament-detail-page.test.tsx`, `packages/web/tests/components/tournament-detail-ratings.test.tsx`, `packages/web/tests/components/tournament-lobby.test.tsx`, `packages/web/tests/components/tournament-my-deck-panel.test.tsx`, `packages/web/tests/components/tournament-rules-form.test.tsx`, `packages/web/tests/components/tournaments-pages/list-page.test.tsx`, `packages/web/tests/components/use-my-matches.test.ts`, `packages/web/tests/cubes-pool-route.test.ts`, `packages/web/tests/cubes-route.test.ts`, `packages/web/tests/decks-draft-route.test.ts`, `packages/web/tests/decks-registration-route.test.ts`, `packages/web/tests/draft-deck-codes.test.ts`, `packages/web/tests/draft-load-resilience.test.ts`, `packages/web/tests/draft-pick-websocket-route.test.ts`, `packages/web/tests/draft-pick.test.ts`, `packages/web/tests/draft-test-bots.test.ts`, `packages/web/tests/draft-tournament-route.test.ts`, `packages/web/tests/drafts-booster-preflight.test.ts`, `packages/web/tests/drafts-copy-cap-route.test.ts`, `packages/web/tests/drafts-create-route.test.ts`, `packages/web/tests/drafts-create-theme-route.test.ts`, `packages/web/tests/drafts-cubes-route.test.ts`, `packages/web/tests/drafts-deck-pool-route.test.ts`, `packages/web/tests/drafts-delete-route.test.ts`, `packages/web/tests/drafts-pool-route.test.ts`, `packages/web/tests/drafts-private-config-route.test.ts`, `packages/web/tests/drafts-put-route.test.ts`, `packages/web/tests/drafts-read-access.test.ts`, `packages/web/tests/drafts-route.test.ts`, `packages/web/tests/drafts-talk-route.test.ts`, `packages/web/tests/drafts-theme-copy-limit.test.ts`, `packages/web/tests/drafts-theme-lobby.test.ts`, `packages/web/tests/drafts-theme-numbers.test.ts`, `packages/web/tests/drafts-theme-pick-route.test.ts`, `packages/web/tests/drafts-theme-response.test.ts`, `packages/web/tests/duels-bot-route.test.ts`, `packages/web/tests/duels-challenge-route.test.ts`, `packages/web/tests/duels-create-master-rule-route.test.ts`, `packages/web/tests/duels-join-multiplayer-flag.test.ts`, `packages/web/tests/duels-opening-route.test.ts`, `packages/web/tests/duels-seat-routes.test.ts`, `packages/web/tests/duels-series-first-route.test.ts`, `packages/web/tests/duels-series-unready-route.test.ts`, `packages/web/tests/duels-unready-route.test.ts`, `packages/web/tests/fixtures/matches.ts`, `packages/web/tests/fixtures/standings.ts`, `packages/web/tests/fixtures/tournament-sheet.ts`, `packages/web/tests/helpers/draft-deck-fixture.ts`, `packages/web/tests/helpers/pool-fixtures.ts`, `packages/web/tests/join-bot-route.test.ts`, `packages/web/tests/leaderboard-page.test.tsx`, `packages/web/tests/leaderboard-route.test.ts`, `packages/web/tests/live-route.test.ts`, `packages/web/tests/live-updates-routes.test.ts`, `packages/web/tests/match-resolve-notify.test.ts`, `packages/web/tests/pages/dashboard-page.test.tsx`, `packages/web/tests/pages/draft-detail-page.test.tsx`, `packages/web/tests/pages/draft-finale-live-update.test.tsx`, `packages/web/tests/player-route.test.ts`, `packages/web/tests/players-route.test.ts`, `packages/web/tests/rejoin-draft.test.tsx`, `packages/web/tests/report-route-notify.test.ts`, `packages/web/tests/resource-guild-access.test.ts`, `packages/web/tests/resource-guild-reads.test.tsx`, `packages/web/tests/settings-route.test.ts`, `packages/web/tests/tournament-deck-route.test.ts`, `packages/web/tests/tournament-draft-deck-hooks.test.ts`, `packages/web/tests/tournament-draft-duel-start.test.ts`, `packages/web/tests/tournament-duel-routes.test.ts`, `packages/web/tests/tournament-reopen-route.test.ts`, `packages/web/tests/tournament-stakes.test.ts`, `packages/web/tests/tournaments-create-route.test.ts`, `packages/web/tests/tournaments-list-route.test.ts`, `packages/web/tests/tournaments-slug-route.test.ts`) and stop for orchestrator review; the orchestrator commits.**


### Task 6: Keep bot interactions operational with explicit identity adapters and no gameplay schedules

**Files:**
- Create: `packages/bot/tests/bot-enabled.test.ts`.
- Modify: `packages/bot/src/repositories/players.ts:3–68`, `commands/handlers.ts:220–228,474,608,640,690`, `interactions/buttons.ts:64–72,432,515,752,901`, `interactions/modals.ts:99–100,124`, `interactions/select-menus.ts:170–190`, `interactions/autocomplete.ts:106,189,201,253,293`, `index.ts:60–70,180–198,202–275,396–462,547`, `deploy-commands.ts:5–18`, `announce/server.ts:9–18,25–34`, `announce/handlers.ts:18–51` (under packages/bot/src).
- Modify: `packages/shared/src/notify/announce-payload.ts:2–4`, `packages/shared/tests/notify/announcer.test.ts:1` (add draft-status coverage).
- Modify bot tests/fixtures listed below. Keep the old timer modules/test coverage until worker extraction is verified in T7; they are never started by index.ts after this task.

**Interfaces:**
- Consumes: `createUserService(db).ensureDiscord({discordUserId:string,displayName:string}):User` (id:number, discordUserId:string|null); `createPlayerService(db).findOrCreateByDiscord(guildId:string,discordUserId:string,displayName:string):Player`; Player.id:number, Player.userId:number, Player.discordUserId:string|null.
- Produces: bot repository `upsert(guildId:string,discordUserId:string,displayName:string):Player`; `ensureUser(discordUserId:string,displayName:string):User`; `findByDiscordId(guildId:string,discordUserId:string):Player|undefined`; `findById(playerId:number):Player|undefined`. Discord input remains external identity; shared creator/owner arguments are number.
- Consumes shared owner interfaces: draft.create(guildId,channelId,name,config,createdByUserId:number,creatorPlayerId:number); tournament.create(guildId,name,format,createdByUserId:number,options?); cube.save(guildId,name,config,createdByUserId:number); tournament.createdBy(guildId,userId:number,statuses); autocomplete.createdByUserId?:number. Existing runtime service methods keep other argument/result types.
- Produces: new `AnnouncePayload` variant `{kind:"draft-status";draftId:number}`; `AnnounceHandlers.onDraftStatus(payload:{draftId:number}):Promise<void>` at `/internal/announce/draft-status`. Existing createAnnouncer(transport).announce(payload):Promise<AnnounceResult> signs the raw body and dispatches by kind.
- Completion contract: caller claims tournaments via `matches.claimTournamentCompletionAnnouncement(tournamentId:number):boolean`, then sends `{kind:"tournament-completed",tournamentId}`. Handler only delivers; it never claims again. Draft HTTP handler alone claims `complete_message_id` atomically before external send, then replaces the claim marker with the Discord message ID. No promise of exactly-once external delivery.

- [ ] **Step 1: Add disabled-entrypoint tests and adapt repository identity tests.** bot-enabled.test.ts:

```ts
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {expect,it} from "vitest";
const root=fileURLToPath(new URL("../../../",import.meta.url));
it.each([undefined,"0","true","yes",""])("switch %s disables bot and command registration", value => {
  for (const entry of ["index.ts","deploy-commands.ts"]) {
    const env:NodeJS.ProcessEnv={...process.env,DOTENV_CONFIG_PATH:"/dev/null",DISCORD_TOKEN:"",DISCORD_CLIENT_ID:"",DISCORD_GUILD_ID:""};
    if (value === undefined) delete env.DISCORD_BOT_ENABLED; else env.DISCORD_BOT_ENABLED=value;
    const result=spawnSync(process.execPath,["--import","tsx",`packages/bot/src/${entry}`],{cwd:root,env,encoding:"utf8",timeout:10_000});
    expect(result.status).toBe(0); expect(result.stderr).not.toMatch(/required|login/i);
  }
});
it("literal 1 reaches required credential validation", () => {
  const result=spawnSync(process.execPath,["--import","tsx","packages/bot/src/index.ts"],{
    cwd:root,env:{...process.env,DOTENV_CONFIG_PATH:"/dev/null",DISCORD_BOT_ENABLED:"1",DISCORD_TOKEN:""},encoding:"utf8",timeout:10_000});
  expect(result.status).not.toBe(0); expect(result.stderr).toContain("DISCORD_TOKEN is required");
});
```

In repositories/players.test.ts retain name-update assertions, use `"900000000000000101"` as the Discord argument and assert `first.userId === second.userId`. Add a creator-only row case by calling `repository.ensureUser` and checking users count=1, players count=0. All bot fixture strings used as Discord accounts become digit strings; do not broaden the production validator to accept `user-1`.

Run: `npx vitest run packages/bot/tests/bot-enabled.test.ts packages/bot/tests/repositories/players.test.ts`.
Expected: FAIL on disabled-entrypoint credential validation and absent user IDs.

- [ ] **Step 2: Implement repository adapters and convert creator checks.** Re-export shared Player and use shared mapping by querying through user_id; repository implementation:

```ts
import type Database from "better-sqlite3";
import {createPlayerService,createUserService,type Player} from "@yugidraft/shared/services";
export type {Player};
export function createPlayerRepository(db:Database.Database) {
  const players=createPlayerService(db), users=createUserService(db);
  return {
    upsert(guildId:string,discordUserId:string,displayName:string):Player {
      return players.findOrCreateByDiscord(guildId,discordUserId,displayName);
    },
    ensureUser(discordUserId:string,displayName:string) { return users.ensureDiscord({discordUserId,displayName}); },
    findByDiscordId(guildId:string,discordUserId:string):Player|undefined {
      const user=users.findByDiscordId(discordUserId);
      return user ? players.findByGuildAndUser(guildId,user.id) : undefined;
    },
    findById(playerId:number):Player|undefined {
      const row=db.prepare("select guild_id,user_id from players where id=?").get(playerId) as {guild_id:string;user_id:number}|undefined;
      return row ? players.findByGuildAndUser(row.guild_id,row.user_id) : undefined;
    },
  };
}
export type PlayerRepository=ReturnType<typeof createPlayerRepository>;
```

In command/interaction entrypoints, after guild validation use:

```ts
const actorUserId=deps.players.ensureUser(interaction.user.id,interaction.user.displayName ?? interaction.user.username).id;
```

Creator checks take `{createdByUserId:number},userId:number`; pass actorUserId to those checks, resource creation, template/cube save/delete ownership and autocomplete owner filters. For draft creation use `creator.userId` and `creator.id` in their respective slots. Event modal creation must call ensureUser even with no participant. Retain interaction.user.id in Discord buttons custom IDs, approver snowflake equality, mentions, guild calls and DMs. In index.ts status rendering use nullable `player.discordUserId` only when present; otherwise render player.displayName. Guard channel access with `if (!draft.channelId) return`.

- [ ] **Step 3: Guard both entrypoints before their first credential read and remove migrated scheduling from index.ts.**

```ts
if (process.env.DISCORD_BOT_ENABLED !== "1") {
  console.log("[bot] disabled");
  process.exit(0);
}
```

Insert before index.ts:60 and deploy-commands.ts:5. Delete imports of createDraftTimerService/createTournamentTimerService from index.ts, timer construction at :202–275, empty-cache startup sync :396–403, set cron :405–419, image cron :421–444 and draft/tournament starts :446–462. Remove unused image-cap variable and dependencies used only by those blocks. Keep cleanup wrapper construction for commands, cron import for reminders, `notifyCleanup.start()` :469, announce server :471–481, and reminder schedule :483–512. No old-timer fallback, including when worker is absent.

- [ ] **Step 4: Add the signed status handler and atomic draft-completion claim.** Extend the union, handler interface and routes:

```ts
export type AnnouncePayload =
  | { kind: "draft-status"; draftId: number }
  | { kind: "draft-created"; draftId: number; channelId: string; name: string; webSlug: string }
  | { kind: "draft-started"; draftId: number; channelId: string; name: string; webSlug: string }
  | { kind: "draft-completed"; draftId: number; channelId: string; name: string; webSlug: string }
  | { kind: "tournament-created"; tournamentId: number; channelId: string; name: string; format: string; webSlug: string; organizerUserId: string; participantCount: number }
  | { kind: "tournament-started"; tournamentId: number; channelId: string; name: string; format: string; webSlug: string }
  | {
      kind: "match-report-pending";
      guildId: string;
      slug: string;
      matchId: number;
      tournamentMatchId: number;
      tournamentName: string;
      roundNumber: number;
      reporterDiscordId: string;
      opponentDiscordId: string;
      reporterName: string;
      opponentName: string;
      opponentLost: boolean;
    }
  | {
      kind: "duel-invite";
      guildId: string;
      /** The player the bot DMs. */
      opponentDiscordUserId: string;
      challengerName: string;
      duelName: string;
      bestOf: 1 | 3;
      ranked: boolean;
      /** Set for a tournament game; the DM shows it instead of Ranked/Unranked. */
      tournamentName: string | null;
      /** Public web link to the duel room. */
      url: string;
    }
  | { kind: "match-resolved"; matchId: number }
  | { kind: "tournament-completed"; tournamentId: number };

// Add this member to the existing exported interface in announce/server.ts:
export interface AnnounceHandlers {
  onDraftStatus(payload:{draftId:number}):Promise<void>;
}
// Inside createAnnounceServer, after the existing routes map:
routes["/internal/announce/draft-status"] = d => opts.handlers.onDraftStatus(d);
```

Destructure drafts/messenger in createAnnounceHandlers and insert:

```ts
// Inside createAnnounceHandlers, before returning its handler object:
async function onDraftStatus({draftId}:{draftId:number}):Promise<void> {
  if(!Number.isSafeInteger(draftId)||draftId<=0)throw new Error("Invalid draft ID");
  const draft=drafts.findById(draftId);
  if(draft.channelId)await messenger.updateStatus(draft);
}
```

Add `onDraftStatus,` to the returned handlers object.

Keep onDraftStarted's no-op for web-started drafts. In onDraftCompleted, derive the authoritative name/channel/slug from drafts.findById(draftId), require completed status plus channel/slug, fetch a text channel, then claim synchronously immediately before send:

```ts
const claimed=db.prepare(`update drafts set complete_message_id='worker-claimed'
  where id=? and status='completed' and complete_message_id is null`).run(draftId).changes === 1;
if (!claimed) return;
const msg=await channel.send(draftCompletedAnnouncement({name:draft.name,webSlug:draft.webSlug}));
db.prepare("update drafts set complete_message_id=? where id=? and complete_message_id='worker-claimed'").run(msg.id,draftId);
```

The marker is never passed to Discord fetch. A failed send retains it and logs the failure; this matches tournament at-most-once attempt semantics and requires operator inspection for delivery failure. Gameplay is already committed. Do not add another claim in onTournamentCompleted or in announceTournamentCompleted's delivery helper.

- [ ] **Step 5: Test signed status dispatch and single completion delivery.** Extend announce/server.test.ts's complete handler object with onDraftStatus in every fixture, then:

```ts
it("dispatches signed draft-status", async () => {
  const handler=vi.fn(async () => {});
  const app=createAnnounceServer({secret,handlers:{onDraftCreated:handler,onDraftStarted:handler,onDraftCompleted:handler,
    onDraftStatus:handler,onTournamentCreated:handler,onTournamentStarted:handler,onMatchReportPending:handler,
    onMatchResolved:handler,onTournamentCompleted:handler,onDuelInvite:handler}});
  const body=JSON.stringify({draftId:13});
  const response=await app.handle(new Request("http://x/internal/announce/draft-status",{method:"POST",headers:{"x-announce-signature":sign(body)},body}));
  expect(response.status).toBe(204); expect(handler).toHaveBeenCalledWith({draftId:13});
});
```

In announce/handlers.test.ts import Database, migrate, createDraftService and createGuildSettingsService in addition to its current imports. Add this fixture and tests inside the existing describe block:

```ts
function completed(){
  const db=new Database(":memory:");migrate(db);
  db.exec(`insert into users(id,username,display_name) values(101,'host','Host');
    insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,ended_at)
    values(13,'g','channel','Draft','completed',101,'draft',current_timestamp)`);
  const send=vi.fn(async()=>({id:"discord-message"}));
  const messenger={postStatus:vi.fn(async()=>{}),updateStatus:vi.fn(async()=>{})};
  const handlers=createAnnounceHandlers({db,drafts:createDraftService(db),guildSettings:createGuildSettingsService(db),messenger,
    client:{channels:{fetch:vi.fn(async()=>({type:ChannelType.GuildText,send}))},users:{fetch:vi.fn()}} as any});
  return {db,handlers,send,messenger};
}
it("claims concurrent draft completions once",async()=>{
  const {db,handlers,send}=completed();
  try{
    const payload={draftId:13,channelId:"channel",name:"Draft",webSlug:"draft"};
    await Promise.all([handlers.onDraftCompleted(payload),handlers.onDraftCompleted(payload)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.prepare("select complete_message_id from drafts where id=13").get()).toEqual({complete_message_id:"discord-message"});
  }finally{db.close();}
});
it("retains a failed delivery claim without undoing completion",async()=>{
  const {db,handlers,send}=completed();send.mockRejectedValue(new Error("Discord unavailable"));
  try{
    const payload={draftId:13,channelId:"channel",name:"Draft",webSlug:"draft"};
    await Promise.allSettled([handlers.onDraftCompleted(payload),handlers.onDraftCompleted(payload)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.prepare("select status,complete_message_id from drafts where id=13").get()).toEqual({status:"completed",complete_message_id:"worker-claimed"});
  }finally{db.close();}
});
it("updates draft status without changing onDraftStarted behavior",async()=>{
  const {db,handlers,messenger}=completed();
  try{await handlers.onDraftStatus({draftId:13});expect(messenger.updateStatus).toHaveBeenCalledWith(expect.objectContaining({id:13,status:"completed"}));}
  finally{db.close();}
});
```

Keep the existing onDraftStarted no-op test. In shared/tests/notify/announcer.test.ts add:

```ts
it("encodes worker draft-status as the signed announce operation",async()=>{
  const rec=recordingTransport();
  expect(await createAnnouncer(rec.transport).announce({kind:"draft-status",draftId:13})).toEqual({ok:true});
  expect(rec.calls).toEqual([{path:"/internal/announce/draft-status",body:'{"draftId":13}'}]);
});
```

Read-only regression `packages/bot/tests/announce/messages.test.ts:16–43` continues to assert Discord IDs in mentions/custom IDs; those identifiers are not application ownership fields.

**Bot fixture inventory:**
- Modify fixture: `packages/bot/tests/announce/handlers.test.ts:3`.
- Modify fixture: `packages/bot/tests/announce/match-handlers.test.ts:5`.
- Modify fixture: `packages/bot/tests/announce/server-routes.test.ts:3`.
- Modify fixture: `packages/bot/tests/announce/server.test.ts:3`.
- Modify fixture: `packages/bot/tests/commands/handlers.test.ts:5`.
- Modify fixture: `packages/bot/tests/interactions/autocomplete.test.ts:8`.
- Modify fixture: `packages/bot/tests/interactions/buttons-notify-cleanup.test.ts:5`.
- Modify fixture: `packages/bot/tests/interactions/buttons.test.ts:5`.
- Modify fixture: `packages/bot/tests/interactions/modals.test.ts:8`.
- Modify fixture: `packages/bot/tests/interactions/select-menus.test.ts:8`.
- Modify fixture: `packages/bot/tests/lib/announce-tournament-completed.test.ts:18`.
- Modify fixture: `packages/bot/tests/lib/notify-message.test.ts:9`.
- Modify fixture: `packages/bot/tests/live-updates.test.ts:15`.
- Modify fixture: `packages/bot/tests/reminders/tournament-reminders.test.ts:4`.
- Modify fixture: `packages/bot/tests/repositories/players.test.ts:4`.
- Modify fixture: `packages/bot/tests/services/draft-cleanup.test.ts:7`.
- Modify fixture: `packages/bot/tests/services/draft-timer.test.ts:4`.
- Modify fixture: `packages/bot/tests/services/drafts.test.ts:4`.
- Modify fixture: `packages/bot/tests/services/matches.test.ts:4`.
- Modify fixture: `packages/bot/tests/services/notify-cleanup.test.ts:10`.
- Modify fixture: `packages/bot/tests/services/tournament-reporting.test.ts:4`.
- Modify fixture: `packages/bot/tests/services/tournament-timer.test.ts:5`.
- Modify fixture: `packages/bot/tests/services/tournaments.test.ts:4`.

- [ ] **Step 6: Verify bot behavior and absence of scheduling starts.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npm test --workspace=packages/bot
npm run typecheck --workspace=packages/bot
rg -n 'createDraftTimerService|createTournamentTimerService|syncSets|SETS_SYNC_CRON|IMAGE_CLEANUP_CRON|draftTimer|tournamentTimer' packages/bot/src/index.ts
rg -n 'notifyCleanup.start|REMINDER_CRON|cron.schedule' packages/bot/src/index.ts
```

Expected: PASS for bot suites/typecheck, first grep has zero matches (exit 1), second shows notification cleanup plus only reminder scheduling. Validate slash-command and modal event creation with no participant, autocomplete ownership, creator buttons/select menus, and real Discord mention strings in the updated existing suites.

- [ ] **Checkpoint: stage only this task's files (`packages/bot/src/repositories/players.ts`, `packages/bot/src/commands/handlers.ts`, `packages/bot/src/interactions/buttons.ts`, `packages/bot/src/interactions/modals.ts`, `packages/bot/src/interactions/select-menus.ts`, `packages/bot/src/interactions/autocomplete.ts`, `packages/bot/src/index.ts`, `packages/bot/src/deploy-commands.ts`, `packages/bot/src/announce/server.ts`, `packages/bot/src/announce/handlers.ts`, `packages/shared/src/notify/announce-payload.ts`, `packages/shared/tests/notify/announcer.test.ts`, `packages/bot/tests/bot-enabled.test.ts`, `packages/bot/tests/announce/handlers.test.ts`, `packages/bot/tests/announce/match-handlers.test.ts`, `packages/bot/tests/announce/server-routes.test.ts`, `packages/bot/tests/announce/server.test.ts`, `packages/bot/tests/commands/handlers.test.ts`, `packages/bot/tests/interactions/autocomplete.test.ts`, `packages/bot/tests/interactions/buttons-notify-cleanup.test.ts`, `packages/bot/tests/interactions/buttons.test.ts`, `packages/bot/tests/interactions/modals.test.ts`, `packages/bot/tests/interactions/select-menus.test.ts`, `packages/bot/tests/lib/announce-tournament-completed.test.ts`, `packages/bot/tests/lib/notify-message.test.ts`, `packages/bot/tests/live-updates.test.ts`, `packages/bot/tests/reminders/tournament-reminders.test.ts`, `packages/bot/tests/repositories/players.test.ts`, `packages/bot/tests/services/draft-cleanup.test.ts`, `packages/bot/tests/services/draft-timer.test.ts`, `packages/bot/tests/services/drafts.test.ts`, `packages/bot/tests/services/matches.test.ts`, `packages/bot/tests/services/notify-cleanup.test.ts`, `packages/bot/tests/services/tournament-reporting.test.ts`, `packages/bot/tests/services/tournament-timer.test.ts`, `packages/bot/tests/services/tournaments.test.ts`) and stop for orchestrator review; the orchestrator commits.**

### Task 7: Run durable scheduling in an independent worker

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/tsconfig.build.json`, `packages/worker/vitest.config.ts`.
- Create: `packages/worker/src/index.ts`, `packages/worker/src/loop.ts`, `packages/worker/src/effects.ts`, `packages/worker/src/draft-timer.ts`, `packages/worker/src/tournament-timer.ts`, `packages/worker/src/set-sync.ts`, `packages/worker/src/image-cleanup.ts`, `packages/worker/src/healthcheck.ts`.
- Create tests: `packages/worker/tests/loop.test.ts`, `packages/worker/tests/timers.test.ts`, `packages/worker/tests/jobs.test.ts`, `packages/worker/tests/effects.test.ts`.
- Create: `packages/shared/src/services/image-cache-cleanup.ts`, `packages/shared/tests/services/image-cache-cleanup.test.ts`.
- Modify: `packages/shared/src/services/index.ts:1`, `packages/shared/src/notify/signed-post.ts:11–32`, `packages/shared/tests/notify/signed-post.test.ts:7`, `packages/bot/src/services/draft-cleanup.ts:21,100–160`, `package-lock.json`.
- Read/reference: `packages/bot/src/services/draft-timer.ts:5–66`, `packages/bot/src/services/tournament-timer.ts:5–111`, `packages/bot/src/index.ts:202–275,396–462`, `packages/bot/src/lib/notify-duel.ts:8–26`. Do not import bot modules into worker. The additional loop/effects/healthcheck modules separate scheduling, network effects and a no-port health probe.

**Interfaces:**
- Consumes `openDatabase(path: string): Database.Database`; `createDraftService(db): DraftService`, with `listActive(): Draft[]`, `findById(id: number): Draft`, `expireCurrentPickStep(id: number, now?: Date): {autoPickedPlayerIds: number[]}`, `create(guildId: string, channelId: string|null, name: string, config: DraftConfig, createdByUserId: number, creatorPlayerId: number): Draft`, `join(id: number, playerId: number): void`, `start(id: number, now?: Date): Draft`. `Draft` has id/guildId/channelId/name/status/webSlug/currentPackRound/currentPickStep/pickDeadlineAt. Shared completion already calls `createDraftDeckService(db).saveForDraft(id)` at drafts.ts:178; preserve that hook.
- Consumes `createMatchService(db): MatchService`: `findOverduePendingConfirmations(now: string): Match[]`, `autoApprove(id: number): Match`, `claimTournamentCompletionAnnouncement(id: number): boolean`; `Match.tournamentId: number|null`. `createTournamentService(db)` exposes `findOverdueActive(now: string): Tournament[]`, `closeForDeadlineWithChanges(id: number): {tournament: Tournament;changedDuelSlugs: string[]}`, `findById(id: number): Tournament`; `Tournament.guildId: string`, `webSlug?: string`.
- Consumes `createCardCatalogService(db).syncSets(): Promise<string[]>` (card-catalog.ts:630, not a count), `createPlayerService(db).findOrCreateByDiscord(guildId: string, discordId: string, name: string): Player` with numeric `userId` and `id`.
- Consumes shared `SignedPostTransport.post(path: string, body: string): Promise<{ok:boolean;status:number;text:string}>`, `createAnnouncer(transport).announce(payload): Promise<AnnounceResult>`, `createBroadcaster(transport).draft(payload): Promise<void>` and `.tournament(payload): Promise<void>`. New signed operation is `{kind:"draft-status";draftId:number}`. Completion operations are `{kind:"draft-completed";draftId:number;channelId:string;name:string;webSlug:string}`, `{kind:"tournament-completed";tournamentId:number}`, `{kind:"match-resolved";matchId:number}`. Bot onDraftCompleted owns the draft claim; worker owns tournament claim. `POST /internal/duel/changed` receives `{slug:string,guildId:string}` with the same HMAC header.
- Produces `createLoop(run:()=>Promise<void>,intervalMs?:number): {tick():Promise<void>;start():Promise<void>;stop():Promise<void>}`; `createDraftTimer({db,drafts,effects}): {tick(now?:Date):Promise<void>}`; `createTournamentTimer({db,matches,tournaments,effects}): {tick(now?:Date):Promise<void>}`; `createSetSync({db,cards,expression,timezone})`, `createImageCleanup({cache,maximumBytes,expression,timezone})` each return `{start():Promise<void>;stop():Promise<void>;tick():Promise<void>}`. Types are the exported shared service types and `WorkerEffects` below.
- Produces shared `createImageCacheCleanup({imageCacheDir:string}): {imageCacheBytes():Promise<number>;removeOldestImages(maxBytes:number):Promise<number>}`; HTTP config gains optional `timeoutMs?:number` default 5000. Worker has no public port or Discord library dependency.

- [ ] **Step 1: Add package/configuration and the failing non-overlap/drain test.**

`package.json` (reuse the installed workspace dependency versions; no new major-library choice):

```json
{
  "name": "@yugidraft/worker", "version": "0.1.0", "private": true, "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts", "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit", "start": "node dist/index.js", "test": "vitest run"
  },
  "dependencies": {"@yugidraft/shared":"*", "dotenv":"latest", "node-cron":"latest"},
  "devDependencies": {"@types/node":"latest", "@types/better-sqlite3":"latest", "better-sqlite3":"latest", "tsx":"latest", "typescript":"latest", "vitest":"latest"}
}
```

`tsconfig.json`, then `tsconfig.build.json`:

```json
{"extends":"../../tsconfig.json","compilerOptions":{"outDir":"dist"},"include":["src/**/*.ts","tests/**/*.ts"]}
```
```json
{"extends":"./tsconfig.json","compilerOptions":{"rootDir":"src","declaration":true},"include":["src/**/*.ts"],"exclude":["tests/**/*.ts"]}
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({test:{root:fileURLToPath(new URL(".",import.meta.url)),include:["tests/**/*.test.ts"]}});
```

`tests/loop.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { createLoop } from "../src/loop.js";
afterEach(() => vi.useRealTimers());
it("coalesces slow ticks and drains before stop resolves", async () => {
  vi.useFakeTimers();
  let release!:()=>void;
  const run=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const loop=createLoop(run,1000);
  const started=loop.start();
  await Promise.resolve();
  const again=loop.tick();
  await vi.advanceTimersByTimeAsync(3000);
  expect(run).toHaveBeenCalledTimes(1);
  let stopped=false;
  const stop=loop.stop().then(()=>{stopped=true;});
  await Promise.resolve(); expect(stopped).toBe(false);
  release(); await Promise.all([started,again,stop]);
  await vi.advanceTimersByTimeAsync(5000);
  await loop.tick(); expect(run).toHaveBeenCalledTimes(1);
});
it("continues after a failed tick",async()=>{
  vi.useFakeTimers();
  const run=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const loop=createLoop(run,1000);
  await loop.start(); await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledTimes(2); await loop.stop();
});
```

Run:

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm install --package-lock-only --ignore-scripts
npm ci
npm run build --workspace=packages/shared
npm test --workspace=packages/worker -- tests/loop.test.ts
```

Expected: FAIL missing loop module. Lockfile adds worker workspace only plus resolution required by that manifest; do not upgrade unrelated dependencies.

- [ ] **Step 2: Implement serial scheduling and bounded network effects.**

`src/loop.ts`:

```ts
export function createLoop(run:()=>Promise<void>,intervalMs?:number) {
  let pending:Promise<void>|undefined;
  let interval:ReturnType<typeof setInterval>|undefined;
  let closed=false,started=false;
  function tick():Promise<void> {
    if(closed) return Promise.resolve();
    if(pending) return pending;
    pending=Promise.resolve().then(run).catch(error=>console.warn("[worker] tick failed",error))
      .finally(()=>{pending=undefined;});
    return pending;
  }
  return {tick,async start(){
    if(started||closed)return; started=true;
    await tick();
    if(!closed&&intervalMs!==undefined)interval=setInterval(()=>void tick(),intervalMs);
  },async stop(){closed=true;clearInterval(interval);await pending;}};
}
```

In shared signed-post.ts preserve HMAC/error/result code and change the function/config and request option:

```ts
export function httpTransport(cfg: {url:string;secret:string;timeoutMs?:number}): SignedPostTransport {
  return {async post(path,body){
    if(!cfg.url||!cfg.secret)return {ok:false,status:0,text:"not configured"};
    const sig="sha256="+createHmac("sha256",cfg.secret).update(body).digest("hex");
    try {
      const res=await fetch(`${cfg.url}${path}`,{method:"POST",headers:{"content-type":"application/json","x-announce-signature":sig},body,
        signal:AbortSignal.timeout(cfg.timeoutMs??5000)});
      return {ok:res.ok,status:res.status,text:await res.text()};
    }catch(error){return {ok:false,status:0,text:error instanceof Error?error.message:"Network error"};}
  }};
}
```

Add to signed-post.test.ts (restore stubbed globals after each test):

```ts
it("bounds a stalled request",async()=>{
  vi.stubGlobal("fetch",vi.fn((_url,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
    init.signal!.addEventListener("abort",()=>reject(init.signal!.reason),{once:true});
  })));
  const result=await httpTransport({url:"http://bot",secret:"secret",timeoutMs:5}).post("/x","{}");
  expect(result.ok).toBe(false);expect(result.status).toBe(0);
  vi.unstubAllGlobals();
});
```

`src/effects.ts`:

```ts
import {createAnnouncer,createBroadcaster,httpTransport,type AnnouncePayload,type SignedPostTransport} from "@yugidraft/shared/notify";
import type {DraftBroadcastPayload,TournamentBroadcastPayload} from "@yugidraft/shared/ws";
export type WorkerEffects={
  discordEnabled:boolean;
  draft(payload:DraftBroadcastPayload):Promise<void>;
  tournament(payload:TournamentBroadcastPayload):Promise<void>;
  discord(payload:AnnouncePayload):Promise<void>;
  duel(slug:string,guildId:string):Promise<void>;
};
export function createEffects(input:{enabled:boolean;ws:SignedPostTransport;bot:SignedPostTransport}):WorkerEffects {
  const broadcast=createBroadcaster(input.ws),announce=createAnnouncer(input.bot);
  const safe=async (run:()=>Promise<unknown>)=>{try{await run();}catch(error){console.warn("[worker] effect failed",error);}};
  return {discordEnabled:input.enabled,
    draft:payload=>safe(()=>broadcast.draft(payload)),
    tournament:payload=>safe(()=>broadcast.tournament(payload)),
    discord:payload=>input.enabled?safe(()=>announce.announce(payload)):Promise.resolve(),
    duel:(slug,guildId)=>safe(async()=>{
      const result=await input.ws.post("/internal/duel/changed",JSON.stringify({slug,guildId}));
      if(!result.ok)console.warn("[worker] duel invalidation failed",result.status);
    })};
}
export function effectsFromEnv(env:NodeJS.ProcessEnv):WorkerEffects {
  return createEffects({enabled:env.DISCORD_BOT_ENABLED==="1",
    ws:httpTransport({url:env.WS_INTERNAL_URL??"",secret:env.WS_INTERNAL_SECRET??""}),
    bot:httpTransport({url:env.BOT_ANNOUNCE_URL??"",secret:env.BOT_ANNOUNCE_SECRET??""})});
}
```

`tests/effects.test.ts` proves failure isolation and wire shapes:

```ts
import {expect,it,vi} from "vitest";
import {recordingTransport} from "@yugidraft/shared/notify";
import {createEffects} from "../src/effects.js";
it("keeps WS effects when Discord fails and forwards status/completion/resolve",async()=>{
  const ws=recordingTransport(),bot=recordingTransport();
  const effects=createEffects({enabled:true,ws:ws.transport,bot:bot.transport});
  await effects.discord({kind:"draft-status",draftId:13});
  await effects.discord({kind:"draft-completed",draftId:13,channelId:"channel",name:"Draft",webSlug:"draft"});
  await effects.discord({kind:"tournament-completed",tournamentId:11});
  await effects.discord({kind:"match-resolved",matchId:7});
  expect(bot.calls.map(c=>c.path)).toEqual(["draft-status","draft-completed","tournament-completed","match-resolved"].map(k=>`/internal/announce/${k}`));
  vi.spyOn(bot.transport,"post").mockRejectedValue(new Error("offline"));
  await effects.discord({kind:"draft-status",draftId:13});
  await effects.draft({kind:"complete",slug:"draft"});
  await effects.duel("duel","guild");
  expect(ws.calls.map(c=>c.path)).toEqual(["/internal/draft/complete","/internal/duel/changed"]);
});
it("does no Discord I/O when disabled",async()=>{
  const ws=recordingTransport(),bot=recordingTransport();
  const effects=createEffects({enabled:false,ws:ws.transport,bot:bot.transport});
  await effects.discord({kind:"draft-status",draftId:13});
  await effects.draft({kind:"complete",slug:"draft"});
  expect(bot.calls).toEqual([]);expect(ws.calls).toHaveLength(1);
});
```

- [ ] **Step 3: Write database-backed timer tests before implementing the timers.**

`tests/timers.test.ts`; tests deliberately distinguish player ID from user ID and use real shared transactions:

```ts
import Database from "better-sqlite3";
import {afterEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
import {createDraftService,createMatchService,createPlayerService,createTournamentService} from "@yugidraft/shared/services";
import {createBroadcaster,recordingTransport} from "@yugidraft/shared/notify";
import {createDraftTimer} from "../src/draft-timer.js";
import {createTournamentTimer} from "../src/tournament-timer.js";
import {createLoop} from "../src/loop.js";
import type {WorkerEffects} from "../src/effects.js";
const opened:Database.Database[]=[];
afterEach(()=>{for(const db of opened.splice(0))db.close();vi.useRealTimers();vi.restoreAllMocks();});
function setup(){
  const db=new Database(":memory:");opened.push(db);db.pragma("foreign_keys=on");migrate(db);
  const players=createPlayerService(db),drafts=createDraftService(db),matches=createMatchService(db),tournaments=createTournamentService(db);
  const a=players.findOrCreateByDiscord("g","900000000000000101","Alice");
  const b=players.findOrCreateByDiscord("g","900000000000000102","Bob");
  const rec=recordingTransport(),broadcast=createBroadcaster(rec.transport);
  const effects:WorkerEffects={discordEnabled:true,draft:broadcast.draft,tournament:broadcast.tournament,discord:vi.fn(async()=>{}),duel:vi.fn(async()=>{})};
  return {db,players,drafts,matches,tournaments,a,b,effects,rec};
}
function activeDraft(app:ReturnType<typeof setup>){
  const insert=app.db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values(?,?,'Normal Monster','normal','https://img/full','https://img/small','[{"set_name":"Metal Raiders"}]',current_timestamp)`);
  for(let id=1;id<=80;id++)insert.run(id,`Card ${id}`);
  const draft=app.drafts.create("g","channel","Worker draft",{},app.a.userId,app.a.id);
  app.drafts.join(draft.id,app.b.id);app.drafts.start(draft.id);
  return draft.id;
}
it("startup catches overdue picks; a web expiry racing a stale list commits once",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup(),id=activeDraft(app);
  vi.setSystemTime(new Date("2026-10-06T12:05:00Z"));
  const timer=createDraftTimer(app),loop=createLoop(()=>timer.tick(),1000);
  await loop.start();await loop.stop();
  const after=app.drafts.findById(id);expect(after.currentPickStep).toBe(2);
  const stale=app.drafts.listActive();
  vi.setSystemTime(new Date("2026-10-06T12:06:00Z"));
  app.drafts.expireCurrentPickStep(id,new Date()); // Same operation called by web helpers.ts:99.
  const picked=app.db.prepare("select count(*) as n from draft_picks where draft_id=?").get(id);
  vi.spyOn(app.drafts,"listActive").mockReturnValue(stale);
  await timer.tick();
  expect(app.db.prepare("select count(*) as n from draft_picks where draft_id=?").get(id)).toEqual(picked);
  expect(app.drafts.findById(id).currentPickStep).toBe(3);
});
it("completes an unattended draft, saves decks, and publishes despite Discord failure",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup(),id=activeDraft(app);
  vi.mocked(app.effects.discord).mockRejectedValue(new Error("offline"));
  const timer=createDraftTimer(app);
  for(let step=0;step<45&&app.drafts.findById(id).status==="active";step++){
    vi.setSystemTime(Date.now()+60_000);await timer.tick();
  }
  expect(app.drafts.findById(id).status).toBe("completed");
  expect(app.rec.calls.some(c=>c.path==="/internal/draft/complete")).toBe(true);
  expect(app.db.prepare("select count(*) as n from saved_decks where draft_id=?").get(id)).toEqual({n:2});
});
it("auto-approves reports and claims completed tournament only once",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup();
  const t=app.tournaments.create("g","Reports","round_robin",app.a.userId,{reportConfirmWindowHours:1});
  app.tournaments.join(t.id,app.a.id);app.tournaments.join(t.id,app.b.id);app.tournaments.start(t.id);
  const match=app.tournaments.report(t.id,app.a.id,app.b.id,app.a.id);
  app.db.prepare("update matches set created_at=? where id=?").run("2026-10-06T09:00:00Z",match.id);
  const timer=createTournamentTimer(app);await timer.tick();await timer.tick();
  expect(app.db.prepare("select status from matches where id=?").get(match.id)).toEqual({status:"approved"});
  expect(vi.mocked(app.effects.discord).mock.calls.filter(([p])=>p.kind==="tournament-completed")).toHaveLength(1);
  expect(app.effects.discord).toHaveBeenCalledWith({kind:"match-resolved",matchId:match.id});
});
it("closes overdue tournaments, awaits every duel invalidation, and tolerates effect failure",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const app=setup();
  const t=app.tournaments.create("g","Deadline","round_robin",app.a.userId,{deadlineAt:"2026-10-06T11:00:00Z"});
  app.tournaments.join(t.id,app.a.id);app.tournaments.join(t.id,app.b.id);app.tournaments.start(t.id);
  const close=app.tournaments.closeForDeadlineWithChanges;
  vi.spyOn(app.tournaments,"closeForDeadlineWithChanges").mockImplementation(id=>({...close(id),changedDuelSlugs:["a","b"]}));
  vi.mocked(app.effects.discord).mockRejectedValue(new Error("offline"));
  await createTournamentTimer(app).tick();
  expect(app.tournaments.findById(t.id).status).toBe("completed");
  expect(vi.mocked(app.effects.duel).mock.calls).toEqual([["a","g"],["b","g"]]);
  expect(app.rec.calls.some(c=>c.path==="/internal/tournament/match-updated")).toBe(true);
});
```

Run `npm test --workspace=packages/worker -- tests/timers.test.ts`. Expected: FAIL missing timer modules. For the concurrent-process version of the deadline guard, also run the existing shared draft-lock tests after identity fixture conversion; these exercise SQLite's actual immediate lock rather than just an event-loop interleave.

- [ ] **Step 4: Implement startup/periodic sweeps over committed state.**

`src/draft-timer.ts`:

```ts
import type Database from "better-sqlite3";
import type {DraftService} from "@yugidraft/shared/services";
import type {WorkerEffects} from "./effects.js";
export function createDraftTimer({db,drafts,effects}:{db:Database.Database;drafts:DraftService;effects:WorkerEffects}) {
  const safely=async(run:()=>Promise<void>)=>{try{await run();}catch(error){console.warn("[draft-timer] effect",error);}};
  return {async tick(now=new Date()){
    for(const candidate of drafts.listActive()){
      if(!candidate.pickDeadlineAt||Date.parse(candidate.pickDeadlineAt)>now.getTime())continue;
      try{
        const before=drafts.findById(candidate.id);
        drafts.expireCurrentPickStep(candidate.id,now);
        const after=drafts.findById(candidate.id);
        if(before.status===after.status&&before.currentPackRound===after.currentPackRound&&before.currentPickStep===after.currentPickStep)continue;
        if(after.webSlug)await safely(()=>effects.draft(after.status==="completed"
          ?{kind:"complete",slug:after.webSlug!}
          :{kind:"resync",slug:after.webSlug!,packRound:after.currentPackRound,pickStep:after.currentPickStep}));
        await safely(()=>effects.discord({kind:"draft-status",draftId:after.id}));
      }catch(error){console.warn("[draft-timer] expire failed",candidate.id,error);}
    }
    if(!effects.discordEnabled)return;
    const rows=db.prepare(`select id from drafts where status='completed' and complete_message_id is null
      and channel_id is not null and web_slug is not null and julianday(ended_at)>=julianday(?,'-1 day') order by id limit 20`)
      .all(now.toISOString()) as Array<{id:number}>;
    for(const {id} of rows){
      const draft=drafts.findById(id);
      await safely(()=>effects.discord({kind:"draft-completed",draftId:id,channelId:draft.channelId!,name:draft.name,webSlug:draft.webSlug!}));
    }
  }};
}
```

`src/tournament-timer.ts`:

```ts
import type Database from "better-sqlite3";
import type {MatchService,TournamentService} from "@yugidraft/shared/services";
import type {WorkerEffects} from "./effects.js";
export function createTournamentTimer({db,matches,tournaments,effects}:{db:Database.Database;matches:MatchService;tournaments:TournamentService;effects:WorkerEffects}) {
  const safely=async(run:()=>Promise<void>)=>{try{await run();}catch(error){console.warn("[tournament-timer] effect",error);}};
  const publish=async(id:number)=>{
    const t=tournaments.findById(id);
    if(t.webSlug)await safely(()=>effects.tournament({kind:"match-updated",slug:t.webSlug!}));
  };
  return {async tick(now=new Date()){
    for(const overdue of matches.findOverduePendingConfirmations(now.toISOString())){
      try{
        const resolved=matches.autoApprove(overdue.id);
        if(resolved.tournamentId)await publish(resolved.tournamentId);
        await safely(()=>effects.discord({kind:"match-resolved",matchId:resolved.id}));
      }catch(error){console.warn("[tournament-timer] auto-approve failed",overdue.id,error);}
    }
    for(const due of tournaments.findOverdueActive(now.toISOString())){
      try{
        const closed=tournaments.closeForDeadlineWithChanges(due.id);
        await publish(closed.tournament.id);
        for(const slug of closed.changedDuelSlugs)await safely(()=>effects.duel(slug,closed.tournament.guildId));
      }catch(error){console.warn("[tournament-timer] deadline failed",due.id,error);}
    }
    if(!effects.discordEnabled)return;
    const rows=db.prepare(`select id from tournaments where status='completed' and completed_announced_at is null
      and julianday(ended_at)>=julianday(?,'-1 day') order by id limit 20`).all(now.toISOString()) as Array<{id:number}>;
    for(const {id} of rows){
      if(!matches.claimTournamentCompletionAnnouncement(id))continue;
      await safely(()=>effects.discord({kind:"tournament-completed",tournamentId:id}));
    }
  }};
}
```

This preserves existing at-most-once tournament announcement attempts. HTTP is not an exactly-once delivery queue: a crash after claiming may lose a notification, but cannot repeat the gameplay completion. A bot-disabled worker does not consume Discord completion claims. Recent-completion limits retain the bot's one-day/20-row policy.

- [ ] **Step 5: Extract cache eviction and test a disappearing file.**

`shared/src/services/image-cache-cleanup.ts`:

```ts
import {readdir,stat,unlink} from "node:fs/promises";
import {join} from "node:path";
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==="ENOENT";
export function createImageCacheCleanup({imageCacheDir}:{imageCacheDir:string}){
  async function files(){
    let entries;
    try{entries=await readdir(imageCacheDir,{withFileTypes:true});}catch(error){if(missing(error))return [];throw error;}
    const result:Array<{path:string;size:number;mtimeMs:number}>=[];
    for(const entry of entries){
      if(!entry.isFile())continue;
      const path=join(imageCacheDir,entry.name);
      try{const info=await stat(path);result.push({path,size:info.size,mtimeMs:info.mtimeMs});}
      catch(error){if(!missing(error))throw error;}
    }
    return result;
  }
  return {async imageCacheBytes(){return (await files()).reduce((n,f)=>n+f.size,0);},
    async removeOldestImages(maxBytes:number){
      if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new Error("Invalid cache byte limit");
      const all=(await files()).sort((a,b)=>a.mtimeMs-b.mtimeMs||a.path.localeCompare(b.path));
      let bytes=all.reduce((n,f)=>n+f.size,0),removed=0;
      for(const file of all){
        if(bytes<=maxBytes)break;
        try{await unlink(file.path);removed++;}catch(error){if(!missing(error))throw error;}
        bytes-=file.size;
      }
      return removed;
    }};
}
```

Export `createImageCacheCleanup` from shared services/index.ts. In bot draft-cleanup.ts import it, remove the now-unused FileEntry type and the two filesystem-only methods, and put `...createImageCacheCleanup({imageCacheDir})` inside its returned object; retain storageSummary/removeUnreferencedImages and their Discord command consumers.

`shared/tests/services/image-cache-cleanup.test.ts`:

```ts
import {mkdtemp,rm,writeFile,utimes,access} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {expect,it,vi} from "vitest";
import * as fs from "node:fs/promises";
import {createImageCacheCleanup} from "../../src/services/image-cache-cleanup.js";
it("evicts oldest first and tolerates another writer deleting a file",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"image-evict-"));
  try{
    const old=join(directory,"old.png"),fresh=join(directory,"new.png");
    await writeFile(old,"1234");await writeFile(fresh,"5678");
    await utimes(old,new Date(0),new Date(0));
    const unlink=fs.unlink;
    const spy=vi.spyOn(fs,"unlink").mockImplementation(async path=>{
      if(path===old){await unlink(path);throw Object.assign(new Error("gone"),{code:"ENOENT"});}
      await unlink(path);
    });
    const cache=createImageCacheCleanup({imageCacheDir:directory});
    expect(await cache.removeOldestImages(4)).toBe(0);
    expect(await cache.imageCacheBytes()).toBe(4);await access(fresh);spy.mockRestore();
  }finally{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});}
});
it("accepts a cache that has not been created",async()=>{
  expect(await createImageCacheCleanup({imageCacheDir:join(tmpdir(),`absent-${crypto.randomUUID()}`)}).removeOldestImages(1)).toBe(0);
});
```

- [ ] **Step 6: Add crons with immediate startup work and fake-clock tests.**

`src/set-sync.ts`:

```ts
import cron from "node-cron";
import type Database from "better-sqlite3";
import type {CardCatalogService} from "@yugidraft/shared/services";
import {createLoop} from "./loop.js";
export function createSetSync({db,cards,expression,timezone}:{db:Database.Database;cards:Pick<CardCatalogService,"syncSets">;expression:string;timezone:string}){
  const loop=createLoop(async()=>{await cards.syncSets();});
  let scheduled:ReturnType<typeof cron.schedule>|undefined;
  let closed=false;
  return {tick:loop.tick,async start(){
    if(closed||scheduled)return;
    scheduled=cron.schedule(expression,()=>{void loop.tick();},{timezone});
    const row=db.prepare("select count(*) as n from card_sets").get() as {n:number};
    if(row.n===0)await loop.tick();
  },async stop(){closed=true;await scheduled?.stop();await loop.stop();await scheduled?.destroy();}};
}
```

`src/image-cleanup.ts`:

```ts
import cron from "node-cron";
import type {createImageCacheCleanup} from "@yugidraft/shared/services";
import {createLoop} from "./loop.js";
export function createImageCleanup({cache,maximumBytes,expression,timezone}:{cache:ReturnType<typeof createImageCacheCleanup>;maximumBytes:number;expression:string;timezone:string}){
  const loop=createLoop(async()=>{await cache.removeOldestImages(maximumBytes);});
  let scheduled:ReturnType<typeof cron.schedule>|undefined;let closed=false;
  return {tick:loop.tick,async start(){
    if(closed||scheduled)return;
    scheduled=cron.schedule(expression,()=>{void loop.tick();},{timezone});
    await loop.tick();
  },async stop(){closed=true;await scheduled?.stop();await loop.stop();await scheduled?.destroy();}};
}
```

`tests/jobs.test.ts` (real cron scheduler, fake clock):

```ts
import Database from "better-sqlite3";
import {afterEach,expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
import {createSetSync} from "../src/set-sync.js";
import {createImageCleanup} from "../src/image-cleanup.js";
afterEach(()=>vi.useRealTimers());
it("syncs an empty set cache at startup and at 06:00 UTC only",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T05:59:58Z"));
  const db=new Database(":memory:");migrate(db);
  const cards={syncSets:vi.fn(async()=>["Metal Raiders"])};
  const job=createSetSync({db,cards,expression:"0 6 * * *",timezone:"UTC"});
  try{await job.start();expect(cards.syncSets).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);expect(cards.syncSets).toHaveBeenCalledTimes(2);
  }finally{await job.stop();db.close();}
});
it("does not sync non-empty metadata on startup",async()=>{
  const db=new Database(":memory:");migrate(db);
  db.prepare("insert into card_sets(set_name,synced_at) values('Metal Raiders',current_timestamp)").run();
  const cards={syncSets:vi.fn(async()=>[] as string[])};
  const job=createSetSync({db,cards,expression:"0 6 * * *",timezone:"UTC"});
  try{await job.start();expect(cards.syncSets).not.toHaveBeenCalled();}finally{await job.stop();db.close();}
});
it("evicts on startup and at 04:00 UTC and stops scheduling",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T03:59:58Z"));
  const cache={imageCacheBytes:vi.fn(async()=>100),removeOldestImages:vi.fn(async(_maxBytes:number)=>2)};
  const job=createImageCleanup({cache,maximumBytes:50,expression:"0 4 * * *",timezone:"UTC"});
  await job.start();await vi.advanceTimersByTimeAsync(3000);await job.stop();
  expect(cache.removeOldestImages.mock.calls).toEqual([[50],[50]]);
  await vi.advanceTimersByTimeAsync(24*60*60*1000);expect(cache.removeOldestImages).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 7: Wire process lifecycle and a heartbeat health probe.**

`src/index.ts`:

```ts
import {config} from "dotenv";
import {isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {writeFileSync,rmSync} from "node:fs";
import {openDatabase} from "@yugidraft/shared/db";
import {createDraftService,createMatchService,createTournamentService,createCardCatalogService,createImageCacheCleanup} from "@yugidraft/shared/services";
import {effectsFromEnv} from "./effects.js";
import {createLoop} from "./loop.js";
import {createDraftTimer} from "./draft-timer.js";
import {createTournamentTimer} from "./tournament-timer.js";
import {createSetSync} from "./set-sync.js";
import {createImageCleanup} from "./image-cleanup.js";
config({path:process.env.DOTENV_CONFIG_PATH??fileURLToPath(new URL("../../../.env",import.meta.url))});
const databasePath=process.env.DATABASE_PATH;
const imageCacheDir=process.env.CARD_IMAGE_CACHE_DIR;
if(!databasePath||!isAbsolute(databasePath))throw new Error("Worker DATABASE_PATH must be absolute");
if(!imageCacheDir||!isAbsolute(imageCacheDir))throw new Error("Worker CARD_IMAGE_CACHE_DIR must be absolute");
const maximumBytes=Number(process.env.CARD_IMAGE_CACHE_MAX_BYTES??16106127360);
if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0)throw new Error("Invalid CARD_IMAGE_CACHE_MAX_BYTES");
const db=openDatabase(databasePath),effects=effectsFromEnv(process.env);
const healthPath=process.env.WORKER_HEALTH_PATH??"/tmp/yugidraft-worker-health.json";
const writeHealth=()=>writeFileSync(healthPath,JSON.stringify({pid:process.pid,at:Date.now()}),{mode:0o600});
const draftTimer=createDraftTimer({db,drafts:createDraftService(db),effects});
const tournamentTimer=createTournamentTimer({db,matches:createMatchService(db),tournaments:createTournamentService(db),effects});
const jobs=[
  createLoop(async()=>{await draftTimer.tick();writeHealth();},1000),
  createLoop(()=>tournamentTimer.tick(),60_000),
  createSetSync({db,cards:createCardCatalogService(db),expression:process.env.SETS_SYNC_CRON??"0 6 * * *",timezone:process.env.SETS_SYNC_TIMEZONE??"UTC"}),
  createImageCleanup({cache:createImageCacheCleanup({imageCacheDir}),maximumBytes,expression:process.env.IMAGE_CLEANUP_CRON??"0 4 * * *",timezone:process.env.IMAGE_CLEANUP_TIMEZONE??"UTC"}),
];
let draining:Promise<void>|undefined;
function stop(){
  return draining??=(async()=>{
    await Promise.all(jobs.map(job=>job.stop()));
    rmSync(healthPath,{force:true});db.close();
  })();
}
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{void stop().catch(error=>{console.error(error);process.exitCode=1;});});
try{await Promise.all(jobs.map(job=>job.start()));}
catch(error){console.error("[worker] startup failed",error);await stop();process.exitCode=1;}
```

`src/healthcheck.ts`:

```ts
import {readFileSync} from "node:fs";
try{
  const value=JSON.parse(readFileSync(process.env.WORKER_HEALTH_PATH??"/tmp/yugidraft-worker-health.json","utf8"));
  if(!Number.isInteger(value.pid)||value.pid<=0||!Number.isFinite(value.at)||Date.now()-value.at>120_000)throw new Error("stale heartbeat");
  process.kill(value.pid,0);
}catch{process.exitCode=1;}
```

Operational single-replica enforcement is the Compose singleton service and runbook. Do not add another scheduler when health is slow; restart only after SIGTERM drain. The two-minute health threshold accommodates the existing bounded 20-row completion sweep. SIGTERM integration is exercised with a real worker subprocess in T8; loop tests here prove no new ticks and no premature close while work is pending.

- [ ] **Step 8: Run worker, shared transport/eviction, and bot-wrapper regressions.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npm test --workspace=packages/shared -- tests/notify/signed-post.test.ts tests/services/image-cache-cleanup.test.ts
npm test --workspace=packages/worker
npm run build --workspace=packages/worker
npm run typecheck --workspace=packages/worker
npm test --workspace=packages/bot -- tests/services/draft-cleanup.test.ts tests/announce/handlers.test.ts tests/announce/server-routes.test.ts
rg -n 'discord.js|@yugioh-discord-bot/bot|packages/bot' packages/worker
```

Expected: all checks PASS; dependency grep has no matches. Run tests before implementation steps to observe the missing-module/old-behavior failures, then after each module group. Completion HTTP integration requires the bot handler contract above; do not compensate by introducing a second bot timer.

- [ ] **Checkpoint: stage only this task's files (`packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/tsconfig.build.json`, `packages/worker/vitest.config.ts`, `packages/worker/src/index.ts`, `packages/worker/src/loop.ts`, `packages/worker/src/effects.ts`, `packages/worker/src/draft-timer.ts`, `packages/worker/src/tournament-timer.ts`, `packages/worker/src/set-sync.ts`, `packages/worker/src/image-cleanup.ts`, `packages/worker/src/healthcheck.ts`, `packages/worker/tests/loop.test.ts`, `packages/worker/tests/timers.test.ts`, `packages/worker/tests/jobs.test.ts`, `packages/worker/tests/effects.test.ts`, `packages/shared/src/services/image-cache-cleanup.ts`, `packages/shared/tests/services/image-cache-cleanup.test.ts`, `packages/shared/src/services/index.ts`, `packages/shared/src/notify/signed-post.ts`, `packages/shared/tests/notify/signed-post.test.ts`, `packages/bot/src/services/draft-cleanup.ts`, `package-lock.json`) and stop for orchestrator review; the orchestrator commits.**

### Task 8: Integrate coordinated deployment, seeds, isolated E2E and operational docs

**Files:**
- Modify: `package.json:7–29`, `Dockerfile:11–17,100–128`, `docker-compose.yml:4–33,76–105`, `docker-compose.override.yml:1–48`, `docker-compose.staging.yml:9–13,35–188`.
- Modify: `.github/workflows/deploy.yml:235–263`, `.github/workflows/test.yml:289–304`, `scripts/staging/remote-deploy.sh:116–158`, `scripts/staging/health-check.sh:24–50`, `scripts/staging/make-staging-env.sh:136–145`.
- Read-only workflow: `.github/workflows/deploy-staging.yml:239–278` delegates build/start/checks to remote-deploy.sh; it does not enumerate services, so requires no redundant workflow edit.
- Modify: `packages/e2e/stack/env.mjs:39–52`, `seed.mjs:9–28`, `prepare.mjs:73–84`, `start.mjs:1–29,77–82,119–218`, `login-auth.mjs:4,21`, `fetch-stub.mjs:27–60` (all under `packages/e2e/stack/`).
- Modify tests: `packages/e2e/tests/auth.setup.ts:25`, `packages/e2e/tests-unit/seed.test.ts:33–42`, `login.test.ts:9–58`, `start.test.ts:16–66`, `prepare.test.ts:90–144`, `stack-fixture.ts:24–35`, `slot-env.test.ts:73–76`, `fetch-stub.test.ts:25–61` (unit paths under `packages/e2e/tests-unit/`).
- Create tests: `packages/e2e/tests/worker-unattended.spec.ts`, `packages/worker/tests/process.test.ts`, `packages/bot/tests/announce/worker-smoke.test.ts`.
- Modify: `scripts/seed.ts:1–244,300–410`, `packages/web/tests/seed-script.test.ts:24–106`.
- Modify docs: `CLAUDE.md:16–20,48–104,123–137`, `docs/architecture.md:7–30,125–132`, `.env.example:1–6,29–47,67–70`, `docs/deployment/vm-runbook.md:89–112,180–205,335–350,451–486`.
- Read-only: `scripts/backup/dueling-backup:18–150` supplies the existing WAL-safe online backup procedure. No backup-policy rewrite and no engine-timer change.

**Interfaces:**
- Consumes `users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,display_name TEXT NOT NULL,discord_user_id TEXT UNIQUE NULL,email TEXT NULL,email_verified INTEGER NOT NULL DEFAULT 0,clerk_user_id TEXT UNIQUE NULL,created_at TEXT,updated_at TEXT,synced_at TEXT NULL)`; `openDatabase(path:string):Database.Database` migrates/enforces FKs.
- Consumes `createPlayerService(db).findOrCreate(guildId:string,userId:number,name:string):Player`, `.findOrCreateByDiscord(guildId:string,discordId:string,name:string):Player`, `.findOrCreateTestPlayer(guildId:string,key:string,name:string):Player`. Player has `id:number,userId:number,discordUserId:string|null,displayName:string`. `createSavedDeckService(db).create(guildId:string,ownerUserId:number,input:SavedDeckWrite):SavedDeck`; `.list(guildId:string,ownerUserId:number):SavedDeck[]`.
- Consumes session `{user:{id:string;discordUserId:string|null;name?:string|null}}`; E2E NextAuth credentials stay `{discordId,name,secret}` and profile email remains unverified. No Clerk/offline-cookie design from PR 2.
- Consumes worker `node packages/worker/dist/index.js`; environment `DATABASE_PATH` and `CARD_IMAGE_CACHE_DIR` must be absolute; `DISCORD_BOT_ENABLED==="1"`; `WS_INTERNAL_URL/SECRET`, `BOT_ANNOUNCE_URL/SECRET`; default `CARD_IMAGE_CACHE_MAX_BYTES=16106127360`, set cron `0 6 * * *`/UTC, image cron `0 4 * * *`/UTC. `WORKER_HEALTH_PATH` stores `{pid:number,at:number}`; `node packages/worker/dist/healthcheck.js` exits 0 while fresh/alive, 1 otherwise; SIGTERM stops/drains/closes DB.
- Consumes `createDraftService(db).create(guildId:string,channelId:string|null,name:string,config:DraftConfig,userId:number,playerId:number):Draft`, `.join(draftId:number,playerId:number):void`, `.start(draftId:number,now?:Date):Draft`, `.findById(draftId:number):Draft`; `.expireCurrentPickStep` already commits/deck-saves transactionally. `Draft.status/currentPickStep/webSlug` report committed state.
- Consumes bot `createAnnounceServer({secret:string,handlers:AnnounceHandlers})` with `.handle(Request):Promise<Response>`; `createAnnounceHandlers({client,db,drafts,messenger,guildSettings})`; worker `createEffects({enabled:boolean,ws:SignedPostTransport,bot:SignedPostTransport}):WorkerEffects`; HMAC-SHA256 over exact body, `x-announce-signature` header.
- Produces one worker for each production, dev, staging or E2E database; production migration happens once before all consumers. E2E players expose `userId:number` separately from `discordId:string`, health paths belong to each slot. Root scripts `dev:worker`, reset restart includes worker; wildcard `workspaces:["packages/*"]` already discovers it.

- [ ] **Step 1: Change seed/session expectations and run them to establish the failure.**

In e2e seed.test.ts replace `.list(guildId,player.discordId)` with `.list(guildId,player.userId)` and absent owner with `999999`. Add inside the seeded DB test:

```ts
for(const player of players){
  assert.deepEqual(db.prepare("select u.id,u.discord_user_id,u.email_verified,p.user_id from users u join players p on p.user_id=u.id where p.guild_id=? and u.id=?")
    .get(guildId,player.userId),{id:player.userId,discord_user_id:player.discordId,email_verified:0,user_id:player.userId});
}
assert.deepEqual(db.pragma("foreign_key_check"),[]);
```

In auth.setup.ts replace its single equality with:

```ts
expect(session.user?.id).toBe(String(player.userId));
expect(session.user?.discordUserId).toBe(player.discordId);
expect(session.user?.id).not.toBe(player.discordId);
```

In web seed-script.test.ts use a real digit fixture `discordUserId="900000000000000101"`; owner row types become number. After opening its readonly DB, resolve the owner once and expect both tournament/draft owners to use it:

```ts
const owner=db.prepare("select id from users where discord_user_id=?").get(discordUserId) as {id:number};
expect(Number.isSafeInteger(owner.id)).toBe(true);
expect(tournamentOwners).toEqual([{created_by_user_id:owner.id}]);
expect(draftOwners).toEqual([{created_by_user_id:owner.id}]);
expect(db.pragma("foreign_key_check")).toEqual([]);
expect(db.prepare("select count(*) as n from players p join users u on u.id=p.user_id where p.discord_user_id like 'fake_%' and u.discord_user_id is null").get()).toEqual({n:4});
```

Close the read-only DB, execute the same seed subprocess a second time, reopen/read/close and assert same user/player IDs and no FK failures. Preserve the existing catalog/config assertions. The second run must not delete users or players.

Run:

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npm run test:unit --workspace=packages/e2e
npx vitest run packages/web/tests/seed-script.test.ts -c packages/web/vitest.config.ts
```

Expected: FAIL for missing userId/new-schema player insertion and old seed owner strings.

- [ ] **Step 2: Allocate E2E application identities and update login verification.**

In env.mjs add explicit user IDs 101–105 to the five existing objects, keeping their Discord IDs/names/keys unchanged, and export the health path:

```js
export const players = [
  {key:"p1",userId:101,discordId:"900000000000000101",name:"E2E Alice"},
  {key:"p2",userId:102,discordId:"900000000000000102",name:"E2E Bob"},
  {key:"p3",userId:103,discordId:"900000000000000103",name:"E2E Carol"},
  {key:"p4",userId:104,discordId:"900000000000000104",name:"E2E Dave"},
  {key:"p5",userId:105,discordId:"900000000000000105",name:"E2E Eve"},
];
export const workerHealthPath=resolve(stackDir,"worker-health.json");
```

Replace seed.mjs imports of service factories and its transaction with this code; preserve its directory creation, explicit databasePath option, fresh isolated-file removal and finally-close:

```js
const {createSavedDeckService,createPlayerService}=await import("@yugidraft/shared/services");
const db=openDatabase(databasePath);
try{
  const decks=createSavedDeckService(db),playerService=createPlayerService(db);
  const insertUser=db.prepare("insert into users(id,username,display_name,discord_user_id) values(?,?,?,?)");
  db.transaction(()=>{
    for(const player of players){
      insertUser.run(player.userId,player.name,player.name,player.discordId);
      playerService.findOrCreate(guildId,player.userId,player.name);
      for(const deck of savedDecks)decks.create(guildId,player.userId,deck);
    }
  })();
}finally{db.close();}
```

login-auth.mjs's JSDoc player adds `userId:number`; final validation becomes:

```js
if(session.user?.id!==String(player.userId)||session.user?.discordUserId!==player.discordId){
  throw new Error("E2E login did not create the requested player session. Restart the manual stack and try again.");
}
```

In login.test.ts change `provider(sessionId:string|null)` to `provider(sessionId:string|null,discordId="900000000000000101")`, emit `{user:{id:sessionId,discordUserId:discordId}}`, successful provider ID `"101"`, every authenticatePlayer input adds `userId:101`. Add the regression:

```ts
test("manual login rejects a Discord snowflake masquerading as application id",async()=>{
  const login=await provider("900000000000000101");
  try{await assert.rejects(authenticatePlayer(login.api,{userId:101,discordId:"900000000000000101",name:"E2E Alice"},"throwaway-secret",login.webUrl),/did not create.*session/i);}
  finally{await login.close();}
});
```

- [ ] **Step 3: Remove root seed's private legacy schema and use current identity adapters.**

In scripts/seed.ts replace Database/mkdirSync/dirname imports and `new Database` plus the entire DDL block (lines 30–208) with:

```ts
import {openDatabase} from "@yugidraft/shared/db";
import {createPlayerService} from "@yugidraft/shared/services";
const db=openDatabase(dbPath);
```

Keep `readFileSync`, `join`, dotenv and snapshot loading. Replace the old cleanup block with a transaction scoped only to the two named seed drafts/tournaments; leave catalog and identities in place:

```ts
db.transaction(()=>{
  const drafts="select id from drafts where guild_id=? and web_slug in ('legendary-draft','retro-draft')";
  for(const table of ["draft_passes","draft_picks","draft_cards","draft_packs","draft_deal","draft_undealt","draft_player_cube","draft_players"]){
    db.prepare(`delete from ${table} where draft_id in (${drafts})`).run(guildId);
  }
  db.prepare(`delete from drafts where id in (${drafts})`).run(guildId);
  const tournaments="select id from tournaments where guild_id=? and web_slug in ('fnf-2026','weekend-champ')";
  db.prepare(`delete from tournament_matches where tournament_id in (${tournaments})`).run(guildId);
  db.prepare(`delete from matches where tournament_id in (${tournaments})`).run(guildId);
  db.prepare(`delete from tournament_participants where tournament_id in (${tournaments})`).run(guildId);
  db.prepare(`delete from tournaments where id in (${tournaments})`).run(guildId);
}).immediate();
const playerService=createPlayerService(db);
const me=playerService.findOrCreateByDiscord(guildId,userDiscordId,"You");
const others=["Yugi","Kaiba","Joey","Pegasus"].map(name=>playerService.findOrCreateTestPlayer(guildId,`fake_${name.toLowerCase()}`,name));
const players=[me,...others];
```

Only those fixed table names enter SQL; guild data are bound parameters. Existing gameplay references outside this seed's known rows cause an FK abort instead of cascading through real histories. Never disable FKs to make seed succeed. Change all five owner arguments `me.discord_user_id` to `me.userId`; player seats/matches keep `.id`; display logging uses `.displayName`. Keep existing snapshot card upserts and event configs. Close with `db.close()` instead of relying on process.exit. `openDatabase` owns schema creation (including `draft_packs.wave_number`, unlike the obsolete seed DDL's `pack_round`).

- [ ] **Step 4: Build/start an isolated worker with each E2E stack, and extend supervisor tests.**

In prepare.mjs replace the two-service loop with explicit entrypoints (keep the existing freshness/slot lock logic):

```js
for(const [name,entry] of [["ws","server.js"],["duel-server","server.js"],["worker","index.js"]]){
  const fresh=isBuildFresh(at(`packages/${name}/dist/${entry}`),[...serviceInputs(name),at("packages/shared/dist")]);
  if(e2eSlot!==undefined&&!fresh)throw new Error(`packages/${name}/dist is stale. Build it once before starting parallel slots.`);
  if(e2eSlot===undefined&&(force||!fresh))await sh(`build ${name}`,["run","build",`--workspace=packages/${name}`]);
  else console.log(`[e2e:prepare] ${name} build is up to date`);
}
```

In start.mjs import `workerHealthPath`, add worker index.js to the prerequisite list, remove any stale health file before spawning, and insert after `stub` is defined:

```js
rmSync(workerHealthPath,{force:true});
run("worker",process.execPath,[resolve(repoRoot,"packages/worker/dist/index.js")],{
  cwd:serviceDirectory("worker"),env:{...base,
    NODE_OPTIONS:`--import=${stub}`,CARD_IMAGE_CACHE_DIR:cardImageDir,
    CARD_IMAGE_CACHE_MAX_BYTES:"16106127360",WORKER_HEALTH_PATH:workerHealthPath,
    WS_INTERNAL_URL:wsInternal,WS_INTERNAL_SECRET:secrets.ws,
    DISCORD_BOT_ENABLED:"0",BOT_ANNOUNCE_URL:"",BOT_ANNOUNCE_SECRET:"",
    SETS_SYNC_CRON:"0 6 * * *",SETS_SYNC_TIMEZONE:"UTC",
    IMAGE_CLEANUP_CRON:"0 4 * * *",IMAGE_CLEANUP_TIMEZONE:"UTC",
  },
});
```

Increase supervisor hard-kill grace from 4000 to 15000 ms to allow the bounded pending effects to finish. Update comments/log labels to four services. Do not inherit real .env secrets or use a shared heartbeat filename. In fetch-stub.mjs add before the image branch:

```js
if(new URL(url).origin==="https://db.ygoprodeck.com"&&new URL(url).pathname==="/api/v7/cardsets.php"){
  return Response.json([{set_name:"Metal Raiders",set_code:"MRD",num_of_cards:144,tcg_date:"2002-06-26"}]);
}
```

Add to fetch-stub.test.ts:

```ts
test("set synchronization is offline in an isolated worker",()=>{
  assert.deepEqual(JSON.parse(request("https://db.ygoprodeck.com/api/v7/cardsets.php").body.toString()),
    [{set_name:"Metal Raiders",set_code:"MRD",num_of_cards:144,tcg_date:"2002-06-26"}]);
});
```

Update stack-fixture.ts to include worker/src/index.ts + dist/index.js, package/config files with the same mtime ordering. In prepare.test.ts use the explicit `[name,entry]` table for stale-output tests and add `['run','build','--workspace=packages/worker']` before the web command in the unset-slot expected build list; mark worker output stale in that test. In start.test.ts include `["worker","packages/worker/dist/index.js"]` in the fake runtime entry list and add worker to ready/dead-pid assertions. Extend the fake ready JSON to capture `databasePath`, `cachePath`, `healthPath`, `discordEnabled` from the environment, then assert:

```ts
const worker=JSON.parse(readFileSync(fixture.at("worker.ready"),"utf8"));
assert.equal(worker.databasePath,fixture.at("packages/e2e/.stack-2/e2e.sqlite"));
assert.equal(worker.cachePath,fixture.at("packages/e2e/.stack-2/card-images"));
assert.equal(worker.healthPath,fixture.at("packages/e2e/.stack-2/worker-health.json"));
assert.equal(worker.discordEnabled,"0");
```

In slot-env.test.ts include `c.workerHealthPath` in its disjoint private-directory assertions. These tests cover all ten slots; they do not touch the live DB/cache/ports.

- [ ] **Step 5: Add real-process drain and unattended-browser evidence.**

`packages/worker/tests/process.test.ts` (shared/worker must be built first):

```ts
import {spawn} from "node:child_process";
import {mkdtempSync,existsSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {expect,it} from "vitest";
import {openDatabase} from "@yugidraft/shared/db";
it("SIGTERM drains and removes the heartbeat before clean exit",async()=>{
  const root=mkdtempSync(join(tmpdir(),"worker-process-")),path=join(root,"test.sqlite"),health=join(root,"health.json");
  const db=openDatabase(path);
  db.prepare("insert into card_sets(set_name,synced_at) values('Seed',current_timestamp)").run();db.close();
  const child=spawn(process.execPath,[fileURLToPath(new URL("../dist/index.js",import.meta.url))],{cwd:root,
    env:{PATH:process.env.PATH,DATABASE_PATH:path,CARD_IMAGE_CACHE_DIR:join(root,"images"),WORKER_HEALTH_PATH:health,
      DOTENV_CONFIG_PATH:join(root,"absent.env"),DISCORD_BOT_ENABLED:"0",WS_INTERNAL_URL:"",WS_INTERNAL_SECRET:""},stdio:"pipe"});
  const exit=new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});
  try{
    const deadline=Date.now()+5000;
    while(!existsSync(health)&&child.exitCode===null&&Date.now()<deadline)await delay(20);
    expect(existsSync(health)).toBe(true);expect(JSON.parse(readFileSync(health,"utf8")).pid).toBe(child.pid);
    child.kill("SIGTERM");expect(await exit).toBe(0);expect(existsSync(health)).toBe(false);
    const check=openDatabase(path);expect(check.pragma("integrity_check")).toEqual([{integrity_check:"ok"}]);check.close();
  }finally{if(child.exitCode===null)child.kill("SIGKILL");await exit;rmSync(root,{recursive:true,force:true});}
},10000);
```

`packages/e2e/tests/worker-unattended.spec.ts`:

```ts
import {test,expect} from "@playwright/test";
import {openDatabase} from "@yugidraft/shared/db";
import {createDraftService,createPlayerService} from "@yugidraft/shared/services";
import {dbPath,guildId,players} from "../stack/env.mjs";
import {authFile} from "../helpers/players";
test.use({storageState:authFile("p1")});
test("offline NextAuth uses app IDs while an unattended draft advances",async({request})=>{
  const session=await (await request.get("/api/auth/session")).json();
  expect(session.user.id).toBe("101");expect(session.user.discordUserId).toBe(players[0].discordId);
  const db=openDatabase(dbPath);
  try{
    const playerService=createPlayerService(db),drafts=createDraftService(db);
    const a=playerService.findOrCreate(guildId,101,players[0].name),b=playerService.findOrCreate(guildId,102,players[1].name);
    const insert=db.prepare(`insert or ignore into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values(?,?,'Normal Monster','normal','https://img/full','https://img/small','[{"set_name":"Metal Raiders"}]',current_timestamp)`);
    for(let i=1;i<=80;i++)insert.run(80000000+i,`Worker card ${i}`);
    const draft=drafts.create(guildId,"e2e-channel",`Unattended ${Date.now()}`,{},101,a.id);
    drafts.join(draft.id,b.id);drafts.start(draft.id);
    db.prepare("update drafts set pick_deadline_at=? where id=?").run(new Date(Date.now()-60_000).toISOString(),draft.id);
    // No draft GET/pick request: only the independently running worker can advance it.
    await expect.poll(()=>drafts.findById(draft.id).currentPickStep,{timeout:10000}).toBe(2);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.prepare("update drafts set status='cancelled',pick_deadline_at=null where id=?").run(draft.id);
  }finally{db.close();}
});
```

`packages/bot/tests/announce/worker-smoke.test.ts` exercises the actual HMAC endpoint without logging into Discord:

```ts
import {createHmac} from "node:crypto";
import Database from "better-sqlite3";
import {ChannelType} from "discord.js";
import {expect,it,vi} from "vitest";
import {migrate} from "@yugidraft/shared/db";
import {createDraftService,createGuildSettingsService,createPlayerService} from "@yugidraft/shared/services";
import {recordingTransport} from "@yugidraft/shared/notify";
import {createAnnounceHandlers} from "../../src/announce/handlers.js";
import {createAnnounceServer} from "../../src/announce/server.js";
import {createEffects} from "../../../worker/src/effects.js";
it("worker status and duplicate completion reach signed bot HTTP and send once",async()=>{
  const db=new Database(":memory:");migrate(db);
  try{
    const drafts=createDraftService(db),player=createPlayerService(db).findOrCreateByDiscord("g","900000000000000101","Alice");
    const draft=drafts.create("g","channel","Smoke",{},player.userId,player.id);
    db.prepare("update drafts set status='completed',ended_at=current_timestamp where id=?").run(draft.id);
    const send=vi.fn(async()=>({id:"discord-message"})),updateStatus=vi.fn(async()=>{});
    const handlers=createAnnounceHandlers({db,drafts,guildSettings:createGuildSettingsService(db),messenger:{postStatus:vi.fn(async()=>{}),updateStatus},
      client:{channels:{fetch:vi.fn(async()=>({type:ChannelType.GuildText,send}))},users:{fetch:vi.fn()}} as any});
    const secret="worker-smoke",app=createAnnounceServer({secret,handlers}),ws=recordingTransport();
    const effects=createEffects({enabled:true,ws:ws.transport,bot:{async post(path,body){
      const response=await app.handle(new Request(`http://bot${path}`,{method:"POST",headers:{"x-announce-signature":"sha256="+createHmac("sha256",secret).update(body).digest("hex")},body}));
      return {ok:response.ok,status:response.status,text:await response.text()};
    }}});
    await effects.discord({kind:"draft-status",draftId:draft.id});expect(updateStatus).toHaveBeenCalledTimes(1);
    const payload={kind:"draft-completed" as const,draftId:draft.id,channelId:"channel",name:draft.name,webSlug:draft.webSlug!};
    await Promise.all([effects.discord(payload),effects.discord(payload)]);
    expect(send).toHaveBeenCalledTimes(1);
  }finally{db.close();}
});
```

The structural fake client follows existing handlers.test.ts fixtures; worker has no dependency on this bot test. Real gateway smoke belongs to owner-authorized rollout; this automated smoke checks the PR 1 bot/worker HTTP seam.

- [ ] **Step 6: Wire package scripts, Docker targets and all Compose variants.**

Root scripts (preserve `workspaces:["packages/*"]`):

```json
"dev:worker": "npm run dev --workspace=@yugidraft/worker",
"reset:test-data": "npm run seed && docker compose restart web bot worker"
```

Add `COPY packages/worker/package*.json packages/worker/` in both deps and web-dev manifest lists. Add the runtime target:

```dockerfile
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/worker/package*.json packages/worker/
COPY --from=build /app/packages/worker/dist packages/worker/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "packages/worker/dist/healthcheck.js"]
CMD ["node", "packages/worker/dist/index.js"]
```

Production service, no public ports and no bot dependency:

```yaml
  worker:
    build:
      context: .
      target: worker
    restart: unless-stopped
    user: *user
    stop_grace_period: 150s
    environment:
      - DATABASE_PATH=/app/data/bot.sqlite
      - CARD_IMAGE_CACHE_DIR=/app/data/card-images
      - CARD_IMAGE_CACHE_MAX_BYTES=${CARD_IMAGE_CACHE_MAX_BYTES:-16106127360}
      - DISCORD_BOT_ENABLED=${DISCORD_BOT_ENABLED:-1}
      - WS_INTERNAL_URL=http://ws:4002
      - WS_INTERNAL_SECRET=${WS_INTERNAL_SECRET}
      - BOT_ANNOUNCE_URL=http://bot:4001
      - BOT_ANNOUNCE_SECRET=${BOT_ANNOUNCE_SECRET}
      - SETS_SYNC_CRON=${SETS_SYNC_CRON:-0 6 * * *}
      - SETS_SYNC_TIMEZONE=${SETS_SYNC_TIMEZONE:-UTC}
      - IMAGE_CLEANUP_CRON=${IMAGE_CLEANUP_CRON:-0 4 * * *}
      - IMAGE_CLEANUP_TIMEZONE=${IMAGE_CLEANUP_TIMEZONE:-UTC}
    volumes:
      - ./data:/app/data
    depends_on:
      - ws
```

Bot environment adds `DATABASE_PATH=/app/data/bot.sqlite`, `CARD_IMAGE_CACHE_DIR=/app/data/card-images`, `DISCORD_BOT_ENABLED=${DISCORD_BOT_ENABLED:-1}`; web adds the same capability flag/cache path. WS adds absolute DATABASE_PATH and removes `depends_on: bot`. Add WS production healthcheck using the existing staging Socket.IO handshake check. Keep bot/duel/web services and all duel clocks. Exactly one worker container, no `deploy.replicas` greater than one.

Development override adds:

```yaml
  worker:
    build:
      target: web-dev
    working_dir: /app
    command: ["node_modules/.bin/tsx", "watch", "packages/worker/src/index.ts"]
    volumes:
      - ./packages/worker/src:/app/packages/worker/src
      - ./packages/shared/dist:/app/packages/shared/dist
      - ./packages/shared/package.json:/app/packages/shared/package.json:ro
    healthcheck:
      test: ["CMD", "node", "--import", "tsx", "packages/worker/src/healthcheck.ts"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    depends_on:
      - shared
      - ws
```

Staging adds the same worker service environment/volume with `<<: *staging-service`, `user: "${STAGING_UID:-1000}:${STAGING_GID:-1000}"`, `DISCORD_BOT_ENABLED=0`, empty BOT_ANNOUNCE_URL/SECRET, `NODE_OPTIONS=--max-old-space-size=128`, `volumes: ["${STAGING_DATA_DIR:-./data-staging}:/app/data"]`, `mem_limit: ${STAGING_MEM_WORKER:-192m}`, identical memswap_limit, `cpus: 0.5`, `stop_grace_period: 150s`. No bot service. Staging web explicitly gets `DISCORD_BOT_ENABLED=0` and the same absolute image-cache path. Raise remote-deploy.sh's default STAGING_MIN_START_MB from 1700 to 1900 to account for the worker memory limit; preserve resource gating.

- [ ] **Step 7: Make deployment migrate once, include worker/WS health, and remove staging cache deletion.**

In deploy.yml preserve images for `duel web bot ws worker` (was three). Before build record the currently running image IDs, commit and env in a protected release directory, and take the existing online backup. After building, stop web/bot/duel/worker/WS, take a final drained backup, then run the single migration before up. Replace the old `start web` EXIT recovery trap with cleanup-only: after schema work starts it must not start old binaries. This code belongs inside the existing remote script, not a command to execute during implementation:

```sh
release_dir="/var/backups/yugioh-bot/pr1-$(date -u +%Y%m%d-%H%M%SZ)"
mkdir -m 0700 "$release_dir"
git rev-parse HEAD > "$release_dir/checkout-commit"
cp -p .env "$release_dir/runtime.env"
chmod 0600 "$release_dir/runtime.env"
docker compose -f docker-compose.yml images --format json > "$release_dir/images.json"
DUELING_BACKUP_DIR="$release_dir/online" python3 scripts/backup/dueling-backup
# Keep the existing exact-commit fetch/preflight/image-build/engine-install steps.
docker compose -f docker-compose.yml stop web bot duel worker ws
trap cleanup EXIT
DUELING_BACKUP_DIR="$release_dir/drained" python3 scripts/backup/dueling-backup
docker compose -f docker-compose.yml run --rm --no-deps worker node --input-type=module -e '
  import {openDatabase} from "@yugidraft/shared/db";
  const db=openDatabase(process.env.DATABASE_PATH);
  try {
    if(db.pragma("foreign_key_check").length)throw new Error("Foreign key check failed");
    if(db.pragma("integrity_check",{simple:true})!=="ok")throw new Error("Integrity check failed");
    console.log("identity migration verified");
  } finally {db.close();}
'
docker compose -f docker-compose.yml up -d ws duel web bot worker caddy
for service in ws worker; do
  healthy=0
  for attempt in $(seq 1 36); do
    container=$(docker compose -f docker-compose.yml ps -q "$service")
    state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{.State.Health.Status}}' "$container")
    if [ "$state" = "running 0 healthy" ]; then healthy=1; break; fi
    sleep 5
  done
  [ "$healthy" = 1 ] || { docker compose -f docker-compose.yml logs --tail=60 "$service"; exit 1; }
done
```

Place release metadata capture before the existing `git reset --hard "$DEPLOY_COMMIT"` so checkout-commit describes rollback code; capture Docker image IDs from running containers before build, never trust a retagged latest image. Do not duplicate or move engine bundle mutation before its active-game preflight. Perform the coordinated stop after build and before engine installation/migration; on failure leave traffic stopped with backups intact. Keep existing duel health and cleanup. Set production's explicit `DISCORD_BOT_ENABLED=1` in protected .env before the PR 1 rollout; no Clerk credentials are needed.

In test.yml after shared build, keep all existing typecheck/bot/ws/web/engine gates and add:

```yaml
      - name: Build worker
        run: npm run build --workspace=packages/worker
      - name: Test worker
        run: npm test --workspace=packages/worker
```

The process test needs compiled worker. Bot's worker-smoke test imports worker source but shared dist still must precede it. Root typecheck discovers worker through the workspace wildcard.

In staging remote-deploy.sh remove `rm -rf data-staging/card-images` and replace its comment with `# Worker startup and IMAGE_CLEANUP_CRON evict the oldest cached images to the configured byte limit.` After DB copy/engine install and before up, run the same migration command through the complete staging command below (the same checks, a different Compose project).

```sh
$compose run --rm --no-deps worker node --input-type=module -e '
  import {openDatabase} from "@yugidraft/shared/db";
  const db=openDatabase(process.env.DATABASE_PATH);
  try {
    if(db.pragma("foreign_key_check").length)throw new Error("Foreign key check failed");
    if(db.pragma("integrity_check",{simple:true})!=="ok")throw new Error("Integrity check failed");
    console.log("staging identity migration verified");
  } finally {db.close();}
'
```

The staging database is already stopped and isolated. Existing `$compose build`/`images -q`/`up` already include worker. Update comments from three images to four. In health-check.sh add worker to `for svc in ws duel web worker caddy` and, after its running check, require the worker health field:

```sh
worker_id=$($compose ps -q worker 2>/dev/null || true)
worker_health=$(docker inspect -f '{{.State.Health.Status}}' "$worker_id" 2>/dev/null || true)
[ "$worker_health" = healthy ] || last="$last worker-not-healthy"
```

make-staging-env.sh adds these public settings to its existing echo group without copying bot secrets:

```sh
echo "DISCORD_BOT_ENABLED=0"
echo "CARD_IMAGE_CACHE_DIR=/app/data/card-images"
echo "CARD_IMAGE_CACHE_MAX_BYTES=16106127360"
echo "SETS_SYNC_CRON=0 6 * * *"
echo "SETS_SYNC_TIMEZONE=UTC"
echo "IMAGE_CLEANUP_CRON=0 4 * * *"
echo "IMAGE_CLEANUP_TIMEZONE=UTC"
```

- [ ] **Step 8: Update PR 1 documentation with concrete operating instructions.**

Add this environment block to .env.example; keep NextAuth/Discord credentials and reminder settings. Replace cwd-relative DATABASE_PATH with an explicit comment requiring an operator-selected absolute native path; Compose overrides it. No template contains a real user's credential or production path copied from .env.

```dotenv
# PR 1: only literal 1 enables the bot and command deployment.
DISCORD_BOT_ENABLED=1
# Native development: set both to absolute paths in your checkout before starting services.
DATABASE_PATH=
CARD_IMAGE_CACHE_DIR=
CARD_IMAGE_CACHE_MAX_BYTES=16106127360
SETS_SYNC_CRON=0 6 * * *
SETS_SYNC_TIMEZONE=UTC
IMAGE_CLEANUP_CRON=0 4 * * *
IMAGE_CLEANUP_TIMEZONE=UTC
```

Use this text to replace stale architecture/database/timer descriptions in CLAUDE.md and docs/architecture.md:

> There are seven packages. `packages/worker` (`@yugidraft/worker`) owns draft expiry, report approval, tournament deadline closure, set metadata sync and image eviction. Run `npm run dev:worker` alongside web/WS/duel/bot and `npm test --workspace=packages/worker` after building shared. Exactly one worker uses each SQLite file. Its startup sweeps catch durable deadlines; SIGTERM drains in-flight work. The bot retains Discord commands, signed announcements, notification cleanup and reminders. It runs only when `DISCORD_BOT_ENABLED=1` and runs none of the four migrated schedulers.
>
> `users.id` is application identity. `players.user_id` links a user to an unchanged gameplay player ID in a guild. Owners/creators store integer user IDs; session.user.id is their decimal string. `session.user.discordUserId` is used for Discord membership/admin checks, mentions and DMs. NextAuth remains the sign-in provider and records a lowercased Discord email only with the provider's explicit verified flag. Existing JWTs resolve through their Discord ID. Draft room tokens use the v2 application-ID domain; duel tokens still use player IDs.
>
> All processes share the same absolute DATABASE_PATH. openDatabase enables WAL, a 5000-ms busy timeout and foreign keys. The worker shares the web/bot image cache and sends committed state to WS, then separate signed Discord effects to the bot. The duel host retains its own engine clocks and archive/series sweeps. The worker has a local heartbeat health check and no public port. E2E starts a worker per isolated DB/cache and logs in through offline NextAuth credentials.

Add worker arrows `worker --> db`, `worker -->|signed updates| ws`, `worker -->|signed Discord effects| bot`, `worker -->|set metadata| ygo` to the existing architecture diagram and change the bot row to commands/Discord/reminders. Update Docker target lists, consumers and E2E process counts. Delete the now-stale claim that duel-host bypasses requireWebAccess; preserve admin semantics.

In vm-runbook.md replace the image-only rollback section for identity releases with this exact procedure and update the generic restore service list to `(bot web duel worker ws)`:

> Before PR 1, obtain a WAL-safe backup using `scripts/backup/dueling-backup`, save matching commit/image IDs/env, and rehearse migration on an owner-provided copy. Drain active games under the existing engine procedure. Build all images, stop web/bot/duel/worker and WS, capture the final drained backup, migrate once using the new worker image, and verify counts, ownership mappings, unchanged player/gameplay IDs, foreign keys and integrity before accepting traffic. Start WS/duel/web, the updated bot with literal `DISCORD_BOT_ENABLED=1`, and one worker. Check worker/WS health, unattended deadlines, Discord commands/status/completion, reconnecting draft sockets and existing NextAuth sessions. The owner then asks members to sign in for verified-email capture; retain NextAuth credentials.
>
> Old binaries cannot read the integer-owner schema. If rollback is needed, stop every writer and WS first. Preserve the current DB/WAL/SHM and record intervening writes for reconciliation. Restore the pre-PR1 drained backup and its matching code, images and env using the existing checksum/integrity/ownership-preserving restore procedure, then start the old service set without the worker. Never start the old bot on the new schema, and never run old bot timers alongside the worker. If a matched restore is unavailable, keep writers stopped and fix forward. Image retagging alone is not a PR 1 rollback.

No deploy or gateway login is performed by this implementation task. The snippets make a later owner-authorized rollout reviewable.

- [ ] **Step 9: Run integration checks on isolated artifacts.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
npm run build --workspace=packages/shared
npm run build --workspace=packages/worker
npm test --workspace=packages/worker
npm test --workspace=packages/bot -- tests/announce/worker-smoke.test.ts
npm run test:unit --workspace=packages/e2e
npx vitest run packages/web/tests/seed-script.test.ts -c packages/web/vitest.config.ts
npm run typecheck
sh -n scripts/staging/remote-deploy.sh scripts/staging/health-check.sh scripts/staging/make-staging-env.sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.override.yml config --quiet
```

Expected: PASS; production/dev config validation needs the existing local .env's required hostname and secret presence; never print rendered config. Validate staging with the complete protected dummy fixture below. Its copy of the Compose file resolves .env.staging inside the evidence directory:

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
umask 077
mkdir -p /tmp/alpha-access-pr1-evidence/staging-config
cat > /tmp/alpha-access-pr1-evidence/staging-config/production.env <<'ENV'
DISCORD_TOKEN=dummy-config-only
DISCORD_CLIENT_ID=dummy-config-only
DISCORD_CLIENT_SECRET=dummy-config-only
DISCORD_GUILD_ID=900000000000000001
ENV
STAGING_HOST=127.0.0.1 sh scripts/staging/make-staging-env.sh /tmp/alpha-access-pr1-evidence/staging-config/production.env /tmp/alpha-access-pr1-evidence/staging-config/.env.staging
cp docker-compose.staging.yml /tmp/alpha-access-pr1-evidence/staging-config/docker-compose.staging.yml
docker compose --project-directory /tmp/alpha-access-pr1-evidence/staging-config --env-file /tmp/alpha-access-pr1-evidence/staging-config/.env.staging -p pr1-config-check -f /tmp/alpha-access-pr1-evidence/staging-config/docker-compose.staging.yml config --quiet
```

Expected: PASS without contacting Discord or starting containers. Do not start either configured stack. T9 runs browser/full-build evidence after this task's review.

- [ ] **Checkpoint: stage only this task's files (`package.json`, `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.staging.yml`, `.github/workflows/deploy.yml`, `.github/workflows/test.yml`, `scripts/staging/remote-deploy.sh`, `scripts/staging/health-check.sh`, `scripts/staging/make-staging-env.sh`, `packages/e2e/stack/env.mjs`, `packages/e2e/stack/seed.mjs`, `packages/e2e/stack/prepare.mjs`, `packages/e2e/stack/start.mjs`, `packages/e2e/stack/login-auth.mjs`, `packages/e2e/stack/fetch-stub.mjs`, `packages/e2e/tests/auth.setup.ts`, `packages/e2e/tests/worker-unattended.spec.ts`, `packages/e2e/tests-unit/seed.test.ts`, `packages/e2e/tests-unit/login.test.ts`, `packages/e2e/tests-unit/start.test.ts`, `packages/e2e/tests-unit/prepare.test.ts`, `packages/e2e/tests-unit/stack-fixture.ts`, `packages/e2e/tests-unit/slot-env.test.ts`, `packages/e2e/tests-unit/fetch-stub.test.ts`, `packages/worker/tests/process.test.ts`, `packages/bot/tests/announce/worker-smoke.test.ts`, `scripts/seed.ts`, `packages/web/tests/seed-script.test.ts`, `CLAUDE.md`, `docs/architecture.md`, `.env.example`, `docs/deployment/vm-runbook.md`) and stop for orchestrator review; the orchestrator commits.**

### Task 9: Verify the full release and rehearse migration/rollback on a realistic copy

**Files:**
- Read/verify: every implementation path listed in this task's commands; `packages/shared/tests/db/fixtures/pre-identity.sql`, `packages/shared/src/db/schema.ts`, `packages/shared/src/db/connection.ts`, all package manifests, `CLAUDE.md`, `docs/deployment/vm-runbook.md`.
- No repository file changes. Write only protected evidence under `/tmp/alpha-access-pr1-evidence/`. A failed check returns to its owning implementation task; do not silently change code during verification.
- External prerequisite: owner supplies a production backup **copy** at `/tmp/alpha-access-pr1-evidence/owner-prod-backup.sqlite`, made by the existing WAL-aware `scripts/backup/dueling-backup` procedure (VM snapshots normally live in `/var/backups/yugioh-bot/`). Owner also supplies `/tmp/alpha-access-pr1-evidence/owner-prod-backup.sqlite.sha256` and its backup time/commit. Never point these commands at `/opt/yugioh-bot/data/bot.sqlite`, a mounted live data volume, or a live WAL file. No local identity scrubbing is required; keep the copy mode 0600 and evidence directory mode 0700.

**Interfaces:**
- Consumes built `@yugidraft/shared/db`: `openDatabase(path?:string):Database.Database`, `migrate(db:Database.Database):void`; users canonical Discord ID nullable and unique; players.user_id plus the five INTEGER owner columns refer to users.id. Old-shape fixture is checked-in SQL exported before identity conversion. Every player/gameplay FK and JSON snapshot remains unchanged.
- Consumes worker `node packages/worker/dist/index.js`, no public port, one instance per DB, literal DISCORD_BOT_ENABLED switch; all package test scripts and isolated `npm run e2e`/`E2E_SLOT` stack.
- Produces a PASS/FAIL evidence matrix, counts and schema/FK/integrity/sequence checks, repeat/concurrent-start/process-kill results and paired-backup rollback proof. No production deployment, Discord messages, commit or PR merge. Bot gateway smoke is an owner rollout action; automated signed bot/worker smoke is included here.

- [ ] **Step 1: Run complete build/typecheck/package checks and retain failures honestly.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
set -o pipefail
mkdir -p /tmp/alpha-access-pr1-evidence
chmod 0700 /tmp/alpha-access-pr1-evidence
node --version
npm run build --workspace=packages/shared 2>&1 | tee /tmp/alpha-access-pr1-evidence/shared-build.log
npm run build 2>&1 | tee /tmp/alpha-access-pr1-evidence/build.log
npm run typecheck 2>&1 | tee /tmp/alpha-access-pr1-evidence/typecheck.log
npm test --workspace=packages/shared 2>&1 | tee /tmp/alpha-access-pr1-evidence/shared-tests.log
npm test --workspace=packages/web 2>&1 | tee /tmp/alpha-access-pr1-evidence/web-tests.log
npm test --workspace=packages/bot 2>&1 | tee /tmp/alpha-access-pr1-evidence/bot-tests.log
npm test --workspace=packages/ws 2>&1 | tee /tmp/alpha-access-pr1-evidence/ws-tests.log
npm test --workspace=packages/worker 2>&1 | tee /tmp/alpha-access-pr1-evidence/worker-tests.log
npm test --workspace=packages/duel-server 2>&1 | tee /tmp/alpha-access-pr1-evidence/duel-tests.log
npm run test:unit --workspace=packages/e2e 2>&1 | tee /tmp/alpha-access-pr1-evidence/e2e-unit.log
npm run e2e 2>&1 | tee /tmp/alpha-access-pr1-evidence/e2e.log
```

Expected: PASS for all, including auth setup's string app IDs, unattended-worker test and bot signed-effect smoke. Use the existing pinned engine bundle at `data/duel-engine-next` for engine/E2E tests; build missing resources with the commands documented in CLAUDE.md (`npm run duel:prepare`, `npx tsx packages/duel-server/scripts/build-domain-core.ts`) against a separate test data directory, preserving live engine files. E2E's prepare gate compiles WS/duel/worker before its standalone web build. Required engine/native CI layers remain exactly as test.yml selects for shared/lockfile changes; record any unavailable core/browser/Docker prerequisite as a failed release gate, not a passed skip. Compare failures with T0 baseline; a baseline failure remains visible even if unrelated to identity.

- [ ] **Step 2: Check the remaining identity and scheduler boundaries.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
rg -n 'session\??\.user\??\.id|requireWebAccess|created_by_user_id|owner_user_id|discord_user_id' packages/web/app packages/web/src packages/shared/src/services packages/bot/src packages/ws/src > /tmp/alpha-access-pr1-evidence/identity-audit.txt
rg -n 'createDraftTimerService|createTournamentTimerService|SETS_SYNC_CRON|IMAGE_CLEANUP_CRON|syncSets|draftTimer|tournamentTimer' packages/bot/src/index.ts
rg -n 'notifyCleanup.start|REMINDER_CRON|cron.schedule' packages/bot/src/index.ts
rg -n '@clerk/nextjs|clerkMiddleware|clerkClient|CLERK_' packages .env.example package-lock.json
rg -n 'discord.js|@yugioh-discord-bot/bot' packages/worker
```

Expected: migration/user columns and explicit Discord adapters are the remaining hits in the saved audit; bot migrated-scheduler grep, Clerk grep, worker Discord-dependency grep have no matches (exit 1 is expected for these three). Reminder/notification grep still finds those bot starts. Schema field names such as clerk_user_id are intentionally retained future columns and are not Clerk runtime imports. Existing ignored build outputs may contain stale text; run source-only equivalents before claiming a source regression and rebuild clean consumers when necessary. Confirm SQL ownership binds are numbers, Discord calls bind snowflakes, player-based duels/registrations/rooms are unchanged. Verify all exhaustive T5 entries received explicit review; retain existing admin-season tests.

- [ ] **Step 3: Rehearse realistic migration and compare every table, identity mapping and sequence.**

After the owner copy and checksum are present, run this complete script from the repository root. It creates two disposable working copies; it does not modify the owner source. The source must be a completed backup with no live sidecars. Its schema must be old identity shape for the first PR 1 rehearsal.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,chmodSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {openDatabase} from './packages/shared/dist/db/index.js';
const root='/tmp/alpha-access-pr1-evidence';
const source=`${root}/owner-prod-backup.sqlite`,target=`${root}/rehearsal.sqlite`,restored=`${root}/rollback.sqlite`;
assert.ok(existsSync(source),'Owner must supply a production backup copy');
assert.ok(!existsSync(source+'-wal')&&!existsSync(source+'-shm'),'Use a completed backup, not live sidecars');
assert.ok(!existsSync(target)&&!existsSync(restored),'Use fresh rehearsal targets');
chmodSync(source,0o600);copyFileSync(source,target);chmodSync(target,0o600);
const sourceHash=createHash('sha256').update(readFileSync(source)).digest('hex');
const expectedHash=readFileSync(source+'.sha256','utf8').trim().split(/\s+/)[0];
assert.match(expectedHash,/^[0-9a-f]{64}$/);assert.equal(sourceHash,expectedHash,'Owner backup checksum');
const old=new Database(source,{readonly:true});
assert.equal(old.pragma('integrity_check',{simple:true}),'ok');
assert.deepEqual(old.pragma('foreign_key_check'),[]);
assert.ok(!old.pragma('table_info(players)').some(c=>c.name==='user_id'),'Source already has application identity');
const q=name=>'"'+name.replaceAll('"','""')+'"';
const tables=old.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map(r=>r.name);
const before=new Map(tables.map(t=>[t,old.prepare(`select * from ${q(t)}`).all()]));
const sequences=new Map(old.prepare('select name,seq from sqlite_sequence').all().map(r=>[r.name,r.seq]));
const owned={tournaments:'created_by_user_id',cubes:'created_by_user_id',drafts:'created_by_user_id',seasons:'created_by_user_id',saved_decks:'owner_user_id'};
const metadata=new Map(Object.keys(owned).concat('players').map(t=>[t,old.pragma(`table_info(${q(t)})`)]));
old.close();
const db=openDatabase(target);
const keys=new Map();
function bind(key,id){
  if(key===null){assert.equal(id,null);return;}
  assert.ok(Number.isSafeInteger(id)&&id>0);
  if(keys.has(key))assert.equal(keys.get(key),id);else keys.set(key,id);
  const user=db.prepare('select * from users where id=?').get(id);assert.ok(user);
  assert.equal(user.discord_user_id,/^[0-9]{1,25}$/.test(key)?key:null);
  assert.equal(user.clerk_user_id,null);assert.equal(user.email,null);assert.equal(user.email_verified,0);assert.equal(user.synced_at,null);
}
const sorted=rows=>rows.map(row=>JSON.stringify(row,Object.keys(row).sort())).sort();
for(const [table,rows] of before){
  if(['alpha_invites','access_events','app_users'].includes(table)){assert.equal(rows.length,0);continue;}
  const after=db.prepare(`select * from ${q(table)}`).all();
  assert.equal(after.length,rows.length,`${table} count`);
  if(table==='players'){
    const prior=new Map(rows.map(r=>[r.id,r]));
    for(const row of after){const previous=prior.get(row.id);assert.ok(previous);bind(previous.discord_user_id,row.user_id);
      const {user_id,...rest}=row;assert.deepEqual(rest,previous);}
  }else if(table in owned){
    const column=owned[table],prior=new Map(rows.map(r=>[r.id,r]));
    for(const row of after){const previous=prior.get(row.id);assert.ok(previous);bind(previous[column],row[column]);
      assert.deepEqual({...row,[column]:previous[column]},previous,`${table} preserves non-owner data`);}
  }else if(table==='draft_players'){
    // The existing recurring backfill may set only deck_saved_at for an already saved draft deck.
    assert.deepEqual(sorted(after.map(({deck_saved_at,...rest})=>rest)),sorted(rows.map(({deck_saved_at,...rest})=>rest)));
    for(const previous of rows){const row=after.find(r=>r.draft_id===previous.draft_id&&r.player_id===previous.player_id);
      if(previous.deck_saved_at!==null)assert.equal(row.deck_saved_at,previous.deck_saved_at);
      else if(row.deck_saved_at!==null){
        const player=db.prepare('select user_id,guild_id from players where id=?').get(row.player_id);
        assert.ok(db.prepare('select 1 from saved_decks where draft_id=? and guild_id=? and owner_user_id=?').get(row.draft_id,player.guild_id,player.user_id));
      }
    }
  }else assert.deepEqual(sorted(after),sorted(rows),`${table} gameplay/snapshot preservation`);
}
for(const [table,columns] of metadata){
  const after=db.pragma(`table_info(${q(table)})`);
  for(const column of columns){
    const current=after.find(c=>c.name===column.name);assert.ok(current);
    assert.equal(current.dflt_value,column.dflt_value,`${table}.${column.name} default`);
    if(column.name!=='channel_id'&&column.name!=='discord_user_id')assert.equal(current.notnull,column.notnull);
  }
}
for(const [name,seq] of sequences){
  const current=db.prepare('select seq from sqlite_sequence where name=?').get(name);
  if(!['alpha_invites','access_events','app_users'].includes(name))assert.ok(current&&current.seq>=seq,`${name} sequence high-water`);
}
for(const name of ['players_user_idx','tournaments_creator_idx','cubes_creator_idx','drafts_creator_idx','seasons_creator_idx','saved_decks_owner_draft_idx'])
  assert.ok(db.prepare("select 1 from sqlite_master where type='index' and name=?").get(name),name);
assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
const firstUsers=db.prepare('select * from users order by id').all();db.close();
const again=openDatabase(target);assert.deepEqual(again.prepare('select * from users order by id').all(),firstUsers);again.close();
copyFileSync(source,restored);chmodSync(restored,0o600);
assert.equal(createHash('sha256').update(readFileSync(restored)).digest('hex'),sourceHash);
assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sourceHash);
writeFileSync(`${root}/migration-summary.json`,JSON.stringify({sourceHash,counts:Object.fromEntries([...before].map(([t,rows])=>[t,rows.length])),mappedKeys:keys.size,repeat:true,rollbackCopyMatches:true},null,2),{mode:0o600});
console.log('PASS: identity mappings, all tables, snapshots, defaults, indexes, sequences, FKs, repeat, backup restore');
JS
```

Expected: PASS. An extra historical column/backfill discovered in the realistic backup is evidence for an explicit migration adjustment, not permission to omit a comparison. The mixed fixture in shared tests supplements conditions absent from the owner's real data (creator-without-player, NULL season creator, multiple guilds, test bots). The source hash is compared to the owner's sidecar before using the copy; keep the raw source/identity data out of logs and PR comments.

- [ ] **Step 4: Race two startup processes and kill a process inside the rebuild transaction.**

This disk-backed script adds no repository file and uses the frozen full historical schema, so the interruption test has an actual old table to recover. The child is killed only after reaching the create/copy/drop transaction. It writes a readiness file to communicate; no background process or open DB remains after the test.

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,existsSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import Database from 'better-sqlite3';
import {openDatabase} from './packages/shared/dist/db/index.js';
const root='/tmp/alpha-access-pr1-evidence';
function launch(script,args=[]){
  const child=spawn(process.execPath,['--input-type=module','-e',script,...args],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data);child.stdout.resume();
  const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,stderr})));
  child.once('error',error=>{stderr+=error.message;});return {child,done};
}
const run=`import {openDatabase} from './packages/shared/dist/db/index.js';const db=openDatabase(process.argv[1]);if(db.pragma('foreign_key_check').length)throw Error('FK');db.close();`;
for(const kind of ['fresh','legacy']){
  const path=`${root}/race-${kind}.sqlite`;assert.ok(!existsSync(path),'Fresh evidence path required');
  if(kind==='legacy'){
    const db=new Database(path);db.exec(readFileSync('packages/shared/tests/db/fixtures/pre-identity.sql','utf8'));
    db.exec("insert into players(id,guild_id,discord_user_id,display_name) values(51,'g','900000000000000101','Alice')");db.close();
  }
  const a=launch(run,[path]),b=launch(run,[path]);
  for(const result of await Promise.all([a.done,b.done]))assert.equal(result.code,0,result.stderr);
  const check=openDatabase(path);
  assert.equal(check.prepare('select count(*) n from users').get().n,kind==='legacy'?1:0);
  if(kind==='legacy')assert.equal(check.prepare('select id from players').get().id,51);
  check.close();
}
const path=`${root}/interrupted.sqlite`,marker=`${root}/inside-rebuild`;
assert.ok(!existsSync(path)&&!existsSync(marker));
const old=new Database(path);old.exec(readFileSync('packages/shared/tests/db/fixtures/pre-identity.sql','utf8'));
old.exec("insert into players(id,guild_id,discord_user_id,display_name) values(61,'g','900000000000000101','Alice')");old.close();
const script=`
import Database from 'better-sqlite3';import {writeFileSync} from 'node:fs';
import {migrate} from './packages/shared/dist/db/schema.js';
const db=new Database(process.argv[1]);db.pragma('foreign_keys=on');db.pragma('busy_timeout=5000');
const exec=db.exec.bind(db);db.exec=function(sql){
 if(/drop table players\\s*;/i.test(sql)){writeFileSync(process.argv[2],'inside',{mode:0o600});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}
 return exec(sql);
};migrate(db);db.close();`;
const killed=launch(script,[path,marker]);
try{
  const deadline=Date.now()+5000;
  while(!existsSync(marker)&&killed.child.exitCode===null&&Date.now()<deadline)await delay(20);
  assert.ok(existsSync(marker),'Child must reach rebuild transaction before interruption');
  killed.child.kill('SIGKILL');const result=await killed.done;assert.equal(result.signal,'SIGKILL');
  const recovered=new Database(path);
  assert.equal(recovered.prepare('select id from players').get().id,61);
  assert.ok(!recovered.pragma('table_info(players)').some(c=>c.name==='user_id'));
  assert.deepEqual(recovered.prepare("select name from sqlite_master where name like '%_identity_new'").all(),[]);
  assert.equal(recovered.pragma('integrity_check',{simple:true}),'ok');recovered.close();
  const migrated=openDatabase(path);assert.deepEqual(migrated.pragma('foreign_key_check'),[]);assert.equal(migrated.prepare('select id from players').get().id,61);migrated.close();
}finally{if(killed.child.exitCode===null&&killed.child.signalCode===null)killed.child.kill('SIGKILL');await killed.done;rmSync(marker,{force:true});}
console.log('PASS: fresh/legacy startup races, killed transaction rollback, restart migration');
JS
```

Expected: both startup processes exit 0 for fresh and legacy files; kill recovers the complete old shape with no replacement tables and a subsequent migration succeeds. Do not turn SQLITE_BUSY or duplicate-column errors into passing retries in the test; fix the migration's serialization at the owning task. Shared tests additionally prove injected failure restores the original per-connection FK pragma; a killed process has no surviving connection pragma to restore.

- [ ] **Step 5: Complete the spec evidence matrix and rollout review.**

Record this matrix, with command exit codes/log paths, in `/tmp/alpha-access-pr1-evidence/review.md`:

| Spec row | Required evidence and owning tasks |
|---|---|
| **1 migration** | T1 tests: fresh/mixed old fixture, creator-only owner, NULL season owner, cross-guild account, bot/seed/system keys, guarded S1 cleanup/refusal, partial shape, unknown schema preservation, failed-copy rollback, FK enforcement, repeated backfill, sequence high-water. T9 realistic copy compares every table/JSON/deck/default, owners and indexes; concurrent startup and actual process interruption recover correctly; matched backup restore checksum. |
| **1 identity/routes** | T1/T4 explicit verified Discord email and stale-flag clearing; existing JWT discordId migration, canonical string parsing, numeric ownership and separate Discord authorization. T2 players/duel/registration/backfill fixtures; T3 v2 draft tokens reject old/string claims while duel tokens pass. T5 route/page/UI coverage retains guild/resource/admin checks and bug-report player actor. T6 bot creator-without-player and ownership checks, Discord mentions/DMs, literal switch. |
| **1 worker/E2E** | T6 no migrated bot schedules; T7 fake-clock draft/report/deadline/set/image jobs, restart catch-up, non-overlap/drain, web expiry race, WS survives Discord failure, one completion claim, eviction races. T8 real process SIGTERM, worker→signed bot HTTP smoke, isolated per-slot workers/DB/cache, offline NextAuth IDs and unattended draft. T9 full unit/build/typecheck/E2E and existing engine CI checks. |
| **PR 1 deploy** | T8 coordinated scripts/runbook: online and drained backup, paired images/code/env, one migration before readers/writers, WS and worker health, production bot flag1, one worker, credentials retained. Owner checks real Discord commands/announcements and asks members to re-sign-in for email capture only during an authorized rollout. Rollback restores pre-PR1 DB and matching binaries; never image-only or old bot + new worker. |

Use one review → one fix pass → one re-review. Report unresolved failures and unavailable owner backup/gateway evidence; never substitute a synthetic fixture for the realistic-backup gate. The docs-only planning turn has not run these tests or requested production access.

- [ ] **Checkpoint: stage only this task's files (none; verification writes only protected `/tmp/alpha-access-pr1-evidence/` artifacts) and stop for orchestrator review; the orchestrator commits.**

## Plan self-review

The PR 1 data model/migration, identity resolver, transitional authorization, bot scheduler/switch/HTTP seam, file-by-file list, three test rows and coordinated rollout/rollback each map to T0–T9 above. All five Review Focus conditions have concrete tests in their owning tasks. PR 2/3 authentication, admin removal, invite/inbox and UI shelving stay outside this plan. Exact SQL blocks match the approved spec. Current-code differences are listed under scope decisions and in the affected task interfaces; line numbers are pre-merge references. No production backup or live bot evidence is claimed by this planning document.
