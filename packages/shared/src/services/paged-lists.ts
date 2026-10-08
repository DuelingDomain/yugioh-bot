import type Database from "better-sqlite3";

const PAGE_SIZE = 25;
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid list cursor");
  }
}
export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
}
type Kind = "drafts" | "tournaments";
type Cursor = {
  v: 1;
  kind: Kind;
  guildId: string;
  userId: number;
  rank: number;
  createdAt: string;
  id: number;
};

function decodeCursor(cursor: string | null | undefined, kind: Kind, guildId: string, userId: number): Cursor | null {
  if (cursor == null) return null;
  try {
    if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidListCursorError();
    const buffer = Buffer.from(cursor, "base64url");
    if (buffer.toString("base64url") !== cursor) throw new InvalidListCursorError();
    const key = JSON.parse(buffer.toString("utf8")) as Cursor;
    if (!key || typeof key !== "object" || Array.isArray(key) || Object.keys(key).length !== 7
      || key.v !== 1 || key.kind !== kind || key.guildId !== guildId || key.userId !== userId
      || !Number.isSafeInteger(key.rank) || key.rank < 0 || key.rank > (kind === "drafts" ? 3 : 2)
      || typeof key.createdAt !== "string" || !key.createdAt.length || key.createdAt.length > 64
      || !Number.isSafeInteger(key.id) || key.id < 1) throw new InvalidListCursorError();
    return key;
  } catch {
    throw new InvalidListCursorError();
  }
}
function page<T extends { id: number; created_at: string; status_rank: number }, U>(
  rows: T[], kind: Kind, guildId: string, userId: number, map: (row: T) => U,
): ListPage<U> {
  const items = rows.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  const key: Cursor | null = rows.length > PAGE_SIZE && last
    ? { v: 1, kind, guildId, userId, rank: last.status_rank, createdAt: last.created_at, id: last.id } : null;
  return { items: items.map(map), nextCursor: key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null };
}
function params(guildId: string, userId: number, cursor: Cursor | null) {
  return {
    guild: guildId,
    user: userId,
    rank: cursor?.rank ?? null,
    created: cursor?.createdAt ?? null,
    id: cursor?.id ?? null,
    limit: PAGE_SIZE + 1,
  };
}
const draftRank = "case d.status when 'active' then 0 when 'pending' then 1 when 'completed' then 2 else 3 end";
const tournamentRank = "case t.status when 'active' then 0 when 'pending' then 1 else 2 end";
function afterCursor(alias: string, rank: string) {
  return `(@rank is null or (${rank}) > @rank or ((${rank}) = @rank and
    (${alias}.created_at < @created or (${alias}.created_at = @created and ${alias}.id < @id))))`;
}

const draftListScope = `d.guild_id = @guild
  and d.id in (select dp.draft_id from players p inner join draft_players dp on dp.player_id = p.id
    where p.guild_id = @guild and p.user_id = @user)`;
const tournamentListScope = "t.guild_id = @guild and t.status in ('pending','active','completed')";

export interface ListStatusCounts {
  active: number;
  pending: number;
  completed: number;
  cancelled: number;
}
function statusCounts(rows: { status: string; count: number }[]): ListStatusCounts {
  const counts: ListStatusCounts = { active: 0, pending: 0, completed: 0, cancelled: 0 };
  for (const row of rows) {
    if (Object.hasOwn(counts, row.status)) counts[row.status as keyof ListStatusCounts] = row.count;
  }
  return counts;
}

/** All viewer-seated drafts in this guild, independent of the current list page. */
export function findDraftListStatusCounts(db: Database.Database, guildId: string, userId: number): ListStatusCounts {
  return statusCounts(db.prepare(`select d.status, count(*) as count from drafts d
    where ${draftListScope} group by d.status`).all({ guild: guildId, user: userId }) as { status: string; count: number }[]);
}

/** All listed tournaments in this guild; a participant seat is not required. */
export function findTournamentListStatusCounts(db: Database.Database, guildId: string): ListStatusCounts {
  return statusCounts(db.prepare(`select t.status, count(*) as count from tournaments t
    where ${tournamentListScope} group by t.status`).all({ guild: guildId }) as { status: string; count: number }[]);
}

type DraftRow = {
  id: number;
  guild_id: string;
  name: string;
  status: string;
  web_slug: string | null;
  config_json: string;
  current_wave_number: number;
  current_pick_step: number;
  created_at: string;
  ended_at: string | null;
  player_count: number;
  status_rank: number;
};
export interface DraftListEntry {
  id: number;
  guildId: string;
  name: string;
  status: string;
  mode: "booster" | "theme";
  webSlug?: string;
  currentPackRound: number;
  currentPickStep: number;
  playerCount: number;
  createdAt: string;
  endedAt?: string;
  /** Page presentation parses the setup; the HTTP list omits this field. */
  configJson: string;
}
/** Only drafts in which the viewer has a seat, matching the existing page and API. */
export function findDraftListPage(
  db: Database.Database, guildId: string, userId: number, cursor?: string | null,
): ListPage<DraftListEntry> {
  const key = decodeCursor(cursor, "drafts", guildId, userId);
  const rows = db.prepare(`select d.id, d.guild_id, d.name, d.status, d.web_slug, d.config_json,
      d.current_wave_number, d.current_pick_step, d.created_at, d.ended_at,
      (select count(*) from draft_players dp where dp.draft_id = d.id) as player_count,
      ${draftRank} as status_rank
    from drafts d where ${draftListScope}
      and ${afterCursor("d", draftRank)}
    order by status_rank, d.created_at desc, d.id desc limit @limit`).all(params(guildId, userId, key)) as DraftRow[];
  return page(rows, "drafts", guildId, userId, (row) => {
    let mode: "booster" | "theme" = "booster";
    try {
      if (JSON.parse(row.config_json ?? "{}")?.mode === "theme") mode = "theme";
    } catch {
      // Use booster for malformed legacy setups.
    }
    return {
      id: row.id,
      guildId: row.guild_id,
      name: row.name,
      status: row.status,
      mode,
      webSlug: row.web_slug ?? undefined,
      currentPackRound: row.current_wave_number ?? 0,
      currentPickStep: row.current_pick_step ?? 0,
      playerCount: row.player_count,
      createdAt: row.created_at,
      endedAt: row.ended_at ?? undefined,
      configJson: row.config_json,
    };
  });
}

type TournamentRow = {
  id: number;
  guild_id: string;
  name: string;
  format: string;
  status: string;
  created_by_user_id: number;
  web_slug: string | null;
  participant_count: number;
  created_at: string;
  status_rank: number;
};
export interface TournamentListEntry {
  id: number;
  guildId: string;
  name: string;
  format: string;
  status: string;
  createdByUserId: number;
  webSlug?: string;
  participantCount: number;
}
export function findTournamentListPage(
  db: Database.Database, guildId: string, userId: number, cursor?: string | null,
): ListPage<TournamentListEntry> {
  const key = decodeCursor(cursor, "tournaments", guildId, userId);
  const rows = db.prepare(`select t.id, t.guild_id, t.name, t.format, t.status, t.created_by_user_id, t.web_slug, t.created_at,
      (select count(*) from tournament_participants tp where tp.tournament_id = t.id) as participant_count,
      ${tournamentRank} as status_rank
    from tournaments t where ${tournamentListScope}
      and ${afterCursor("t", tournamentRank)}
    order by status_rank, t.created_at desc, t.id desc limit @limit`).all(params(guildId, userId, key)) as TournamentRow[];
  return page(rows, "tournaments", guildId, userId, (row) => ({
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    format: row.format,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    webSlug: row.web_slug ?? undefined,
    participantCount: row.participant_count,
  }));
}
