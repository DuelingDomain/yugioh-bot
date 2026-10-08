import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase } from "@yugidraft/shared/db";
import { ClerkBackendError, type ClerkBackend, type ClerkUserJson, type ClerkWaitlistEntryJson } from "@yugidraft/shared/clerk";

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "worker-ops-"));
  const path = join(dir, "test.sqlite");
  const db = openDatabase(path);
  const user = (id: number, opts: { email?: string; clerk?: string; discord?: string; username?: string } = {}) => {
    db.prepare("insert into users(id,username,display_name,email,email_verified,clerk_user_id,discord_user_id) values(?,?,'Duelist',?,?,?,?)")
      .run(id, opts.username ?? `duelist_${id}`, opts.email ?? null, opts.email ? 1 : 0, opts.clerk ?? null, opts.discord ?? null);
  };
  const player = (id: number, userId: number, guild = "guild") => {
    db.prepare("insert into players(id,user_id,guild_id,display_name) values(?,?,?,'Duelist')").run(id, userId, guild);
  };
  const checksum = () => {
    db.pragma("wal_checkpoint(TRUNCATE)");
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  };
  return { db, dir, path, user, player, checksum, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

export function remoteUser(id: string, externalId: string, email: string, username = "remote_user"): ClerkUserJson {
  return { id, external_id: externalId, username, first_name: null, last_name: null, image_url: null,
    primary_email_address_id: "email_1", email_addresses: [{ id: "email_1", email_address: email, verification: { status: "verified" } }], external_accounts: [] };
}

export function fakeClerk() {
  const calls: { method: string; input: unknown }[] = [];
  const users: ClerkUserJson[] = [];
  const entries: ClerkWaitlistEntryJson[] = [];
  const failures = { deleteUser: null as ClerkBackendError | null };
  const backend: ClerkBackend = {
    async getUser(id) { const user = users.find(u => u.id === id); if (!user) throw new Error("Missing remote user"); return user; },
    async listUsers(query) {
      calls.push({ method: "listUsers", input: query });
      return users.filter(u => (query.externalId === undefined || u.external_id === query.externalId)
        && (query.emailAddress === undefined || u.email_addresses.some(e => e.email_address === query.emailAddress))
        && (query.username === undefined || u.username === query.username));
    },
    async createUser(input) { calls.push({ method: "createUser", input }); const u = remoteUser(`clerk_${users.length + 1}`, input.externalId, input.emailAddress, input.username); users.push(u); return u; },
    async updateUserExternalId(id, externalId) { const user = await backend.getUser(id); user.external_id = externalId; return user; },
    async updateUserMetadata(id, input) { const user = await backend.getUser(id); user.private_metadata = { ...user.private_metadata, ...input.privateMetadata }; return user; },
    async listWaitlistEntries(query) { calls.push({ method: "listWaitlistEntries", input: query }); const matches = entries.filter(e => e.email_address === query.query); return { data: matches.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)), totalCount: matches.length }; },
    async deleteUser(id) {
      calls.push({ method: "deleteUser", input: id });
      if (failures.deleteUser) throw failures.deleteUser;
      const index = users.findIndex(u => u.id === id);
      if (index >= 0) users.splice(index, 1);
    },
    async createWaitlistEntry(input) { calls.push({ method: "createWaitlistEntry", input }); const e = { id: `entry_${entries.length + 1}`, email_address: input.emailAddress, status: "pending" }; entries.push(e); return e; },
  };
  return { backend, calls, users, entries, failures };
}
