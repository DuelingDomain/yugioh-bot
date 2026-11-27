// Tournament bridge: global application identities with email omitted from results.
import type Database from "better-sqlite3";

export interface TournamentUser {
  id: number;
  username: string;
  displayName: string;
  discordUserId: string | null;
  discordUsername: string | null;
  memberId: string | null;
}

export function normalizeMemberId(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "").replace(/^0+(?=\d)/, "");
  return /^\d{1,10}$/.test(digits) ? digits : null;
}

export function memberIdCheckDigitOk(memberId: string): boolean {
  const padded = memberId.padStart(10, "0");
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, 9];
  const sum = weights.reduce((total, weight, i) => total + Number(padded[i]) * weight, 0);
  return Number(padded[9]) === (11 - sum % 11) % 10;
}

const selectUser = `select u.id, u.username, u.display_name as displayName,
  u.discord_user_id as discordUserId, p.discord_username as discordUsername, p.member_id as memberId
  from users u left join user_profile_ids p on p.user_id=u.id
  where not (u.username=('deleted-' || u.id) and u.clerk_user_id is null and u.display_name='Deleted player')`;

export function createTournamentBridgeUsers(db: Database.Database) {
  function find(id: number): TournamentUser | null {
    return db.prepare<[number], TournamentUser>(`${selectUser} and u.id=?`).get(id) ?? null;
  }
  return {
    find,
    refreshDiscordUsername(id: number, discordUsername: string | null): void {
      db.prepare(`insert into user_profile_ids(user_id,discord_username,updated_at) values (?,?,?)
        on conflict(user_id) do update set discord_username=excluded.discord_username, updated_at=excluded.updated_at`)
        .run(id, discordUsername, new Date().toISOString());
    },
    search(query: string, exact = false): TournamentUser[] {
      const q = query.trim();
      if (!q) return [];
      if (exact) {
        return db.prepare<[string, string, string | null, string], TournamentUser>(`${selectUser}
          and (u.username = ? collate nocase or p.discord_username = ? collate nocase
            or p.member_id = ? or (u.email_verified = 1 and u.email = ?))
          order by u.id limit 1`)
          .all(q, q, normalizeMemberId(q), q.toLowerCase());
      }
      const escaped = q.replace(/[\\%_]/g, "\\$&");
      return db.prepare<[string, string | null, string, string, string, string, string | null, string], TournamentUser>(`${selectUser}
        and (u.discord_user_id=? or p.member_id=? or u.username like ? escape '\\' collate nocase
          or u.display_name like ? escape '\\' collate nocase or p.discord_username like ? escape '\\' collate nocase)
        order by case when u.discord_user_id=? or p.member_id=? then 0
          when u.username like ? escape '\\' collate nocase then 1 else 2 end, u.username collate nocase, u.id limit 20`)
        .all(q, normalizeMemberId(q), `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, q, normalizeMemberId(q), `${escaped}%`);
    },
    lookup(ids: number[]): { users: TournamentUser[]; missing: number[] } {
      const unique = [...new Set(ids)];
      if (!unique.length) return { users: [], missing: [] };
      const rows = db.prepare<number[], TournamentUser>(`${selectUser} and u.id in (${unique.map(() => "?").join(",")})`).all(...unique);
      const byId = new Map(rows.map(user => [user.id, user]));
      return { users: unique.flatMap(id => { const user = byId.get(id); return user ? [user] : []; }),
        missing: unique.filter(id => !byId.has(id)) };
    },
    setMemberId(id: number, memberId: string | null): "not_found" | "taken" | { memberId: string | null; checkDigitOk: boolean } {
      return db.transaction(() => {
        if (!find(id)) return "not_found";
        if (memberId !== null && db.prepare("select 1 from user_profile_ids where member_id=? and user_id<>?").get(memberId, id)) return "taken";
        db.prepare(`insert into user_profile_ids(user_id,member_id,updated_at) values (?,?,?)
          on conflict(user_id) do update set member_id=excluded.member_id, updated_at=excluded.updated_at`)
          .run(id, memberId, new Date().toISOString());
        return { memberId, checkDigitOk: memberId !== null && memberIdCheckDigitOk(memberId) };
      }).immediate();
    },
  };
}
