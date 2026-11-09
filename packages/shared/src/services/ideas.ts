import type Database from "better-sqlite3";
import { isOwnerUser } from "../access/owner-access.js";
import { ExpectedError } from "../observability/index.js";
import { parseIdeaDecision, parseIdeaPost } from "./idea-validation.js";
import type {
  Idea, IdeaBoardResponse, IdeaDecisionInput, IdeaDecisionResponse, IdeaDoneResponse, IdeaNotice,
  IdeaNoticesReadResponse, IdeaPostInput, IdeaPostResponse, IdeaPromptAt, IdeaPromptResponse,
  IdeaQueueResponse, IdeaVoteResponse, IdeaVoteValue,
} from "./idea-types.js";
export * from "./idea-types.js";
export { parseIdeaDecision, parseIdeaPost } from "./idea-validation.js";

const DAY = 24 * 60 * 60 * 1000;
type Row = {
  id: number; title: string; pitch: string | null; area: Idea["area"]; author_user_id: number | null;
  show_author: number; team: number; state: Idea["state"]; decline_reason: string | null; done_note: string | null;
  shipped_before_board: number; shipped_week: string | null; created_at: string; approved_at: string | null;
  started_at: string | null; done_at: string | null; decided_by_user_id: number | null;
  author_name: string | null; up: number; down: number; viewer_vote: IdeaVoteValue;
};
function guild(): string {
  const id = process.env.DISCORD_GUILD_ID;
  if (!id) throw new ExpectedError("not_configured", 503);
  return id;
}
function timestampMillis(timestamp: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
    ? timestamp.replace(" ", "T") + "Z" : timestamp);
}
function weekOf(timestamp: string): string {
  const date = new Date(timestampMillis(timestamp));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
function newestDone(a: Idea, b: Idea): number {
  return timestampMillis(b.doneAt ?? b.shippedWeek ?? b.createdAt)
    - timestampMillis(a.doneAt ?? a.shippedWeek ?? a.createdAt) || b.id - a.id;
}

export function createIdeaService(db: Database.Database) {
  const rows = (viewer: number, owner = false): Idea[] => {
    const all = db.prepare<{ guild: string; viewer: number }, Row>(`
      select i.*, coalesce(p.display_name,u.display_name) as author_name,
        coalesce(v.up,0) as up, coalesce(v.down,0) as down, coalesce(mine.value,0) as viewer_vote
      from ideas i left join users u on u.id=i.author_user_id
      left join players p on p.user_id=i.author_user_id and p.guild_id=i.guild_id
      left join (select idea_id,sum(value=1) as up,sum(value=-1) as down from idea_votes group by idea_id) v on v.idea_id=i.id
      left join idea_votes mine on mine.idea_id=i.id and mine.user_id=@viewer
      where i.guild_id=@guild
      order by (coalesce(v.up,0)-coalesce(v.down,0)) desc, coalesce(v.up,0) desc, julianday(i.created_at), i.id
    `).all({ guild: guild(), viewer });
    let rank = 0;
    return all.map(row => ({
      id: row.id, title: row.title, pitch: row.pitch, area: row.area,
      authorName: owner || (row.show_author === 1 && row.state !== "waiting" && row.state !== "declined") ? row.author_name : null,
      isOwn: row.author_user_id === viewer, showAuthor: row.show_author === 1, team: row.team === 1, state: row.state,
      declineReason: row.decline_reason, doneNote: row.done_note,
      shippedBeforeBoard: row.shipped_before_board === 1, shippedWeek: row.shipped_week,
      createdAt: row.created_at, approvedAt: row.approved_at, startedAt: row.started_at, doneAt: row.done_at,
      decidedByUserId: row.decided_by_user_id, up: row.up, down: row.down, score: row.up - row.down,
      rank: row.state === "open" ? ++rank : null, viewerVote: row.viewer_vote,
    }));
  };
  const played = (viewer: number): boolean => Boolean(db.prepare(`
    select 1 from players p where p.user_id=@viewer and p.guild_id=@guild and (
      exists (select 1 from duel_seats s join duels d on d.id=s.duel_id
        where s.player_id=p.id and s.is_bot=0 and d.guild_id=@guild and d.status='completed' and d.kind='play')
      or exists (select 1 from draft_players dp join drafts d on d.id=dp.draft_id
        where dp.player_id=p.id and d.guild_id=@guild and d.status='completed')
      or exists (select 1 from tournament_matches tm join tournaments t on t.id=tm.tournament_id
        join matches m on m.id=tm.match_id and m.tournament_id=t.id
        where t.guild_id=@guild and m.guild_id=@guild and tm.status='completed' and m.status='approved'
          and tm.player_two_id is not null and (tm.player_one_id=p.id or tm.player_two_id=p.id))
    ) limit 1
  `).get({ viewer, guild: guild() }));
  const atLimit = (viewer: number): boolean => db.prepare<{ viewer: number; guild: string; cutoff: string }, { n: number }>(`
    select count(*) as n from ideas where author_user_id=@viewer and guild_id=@guild and julianday(created_at)>julianday(@cutoff)
  `).get({ viewer, guild: guild(), cutoff: new Date(Date.now() - DAY).toISOString() })!.n >= 3;
  const requirePlayed = (viewer: number) => {
    if (!played(viewer)) throw new ExpectedError("not_played_yet", 403);
  };
  const find = (viewer: number, id: number, owner = false): Idea => {
    const idea = rows(viewer, owner).find(idea => idea.id === id);
    if (!idea) throw new ExpectedError("not_found", 404);
    return idea;
  };
  const notices = (viewer: number): IdeaNotice[] => db.prepare(`
    select n.id,n.idea_id as ideaId,i.title,n.kind,n.note,n.created_at as createdAt
    from idea_notices n join ideas i on i.id=n.idea_id where n.user_id=? and n.read_at is null and i.guild_id=?
    order by julianday(n.created_at) desc,n.id desc
  `).all(viewer, guild()) as IdeaNotice[];
  const post = db.transaction((viewer: number, raw: IdeaPostInput): IdeaPostResponse => {
    const input = parseIdeaPost(raw);
    requirePlayed(viewer);
    if (atLimit(viewer)) throw new ExpectedError("daily_limit", 429);
    const team = isOwnerUser(viewer) || Boolean(db.prepare("select 1 from user_permissions where user_id=? and permission='ideas_team'").get(viewer));
    const now = new Date().toISOString();
    const result = db.prepare(`insert into ideas(guild_id,title,pitch,area,author_user_id,show_author,team,state,created_at,approved_at)
      values(?,?,?,?,?,?,?,?,?,?)`).run(
      guild(), input.title, input.pitch ?? null, input.area, viewer,
      input.showAuthor ? 1 : 0, team ? 1 : 0, team ? "open" : "waiting", now, team ? now : null,
    );
    return { idea: find(viewer, Number(result.lastInsertRowid)) };
  });
  const vote = db.transaction((viewer: number, id: number, value: IdeaVoteValue): IdeaVoteResponse => {
    if (value !== 1 && value !== -1 && value !== 0) throw new ExpectedError("invalid_body", 400);
    const idea = find(viewer, id);
    if (idea.state !== "open") throw new ExpectedError("not_open", 409);
    if (idea.isOwn) throw new ExpectedError("own_idea", 403);
    requirePlayed(viewer);
    if (value === 0 || idea.viewerVote === value) {
      db.prepare("delete from idea_votes where idea_id=? and user_id=?").run(id, viewer);
    } else {
      const now = new Date().toISOString();
      db.prepare(`insert into idea_votes(idea_id,user_id,value,created_at,updated_at) values(?,?,?,?,?)
        on conflict(idea_id,user_id) do update set value=excluded.value,updated_at=excluded.updated_at`).run(id, viewer, value, now, now);
    }
    const updated = find(viewer, id);
    return { ideaId: id, up: updated.up, down: updated.down, score: updated.score, rank: updated.rank!, viewerVote: updated.viewerVote };
  });
  const prompt = db.transaction((viewer: number, at: IdeaPromptAt): IdeaPromptResponse => {
    if (!["duel", "draft", "tournament"].includes(at)) throw new ExpectedError("invalid_at", 400);
    if (!played(viewer)) return null;
    const last = db.prepare<[number], { ideas_prompt_at: number | null }>("select ideas_prompt_at from users where id=?").get(viewer)?.ideas_prompt_at;
    if (last !== null && last !== undefined && Date.now() - last < DAY) return null;
    const open = rows(viewer).filter(idea => idea.state === "open");
    const idea = open.filter(idea => !idea.isOwn && idea.viewerVote === 0)
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt) || b.id - a.id)[0];
    if (!idea) return null;
    db.prepare("update users set ideas_prompt_at=? where id=?").run(Date.now(), viewer);
    return { idea, openTotal: open.length };
  });
  const decide = db.transaction((owner: number, id: number, raw: IdeaDecisionInput): IdeaDecisionResponse => {
    if (!isOwnerUser(owner)) throw new ExpectedError("not_found", 404);
    const input = parseIdeaDecision(raw);
    const idea = find(owner, id, true);
    const transitions = {
      approve: ["waiting", "open"], decline: ["waiting", "declined"],
      start: ["open", "in_progress"], done: ["in_progress", "done"],
    } as const;
    const [from, to] = transitions[input.action];
    if (idea.state !== from) return { status: idea.state === to ? "already_decided" : "conflict", idea, noticesSent: 0 };
    const now = new Date().toISOString();
    const reason = input.action === "decline" ? input.reason + (input.line ? `: ${input.line}` : "") : null;
    const note = input.action === "done" ? input.note || null : null;
    const timestamp = { approve: "approved_at", decline: null, start: "started_at", done: "done_at" }[input.action];
    db.prepare(`update ideas set state=?,decided_by_user_id=?,decline_reason=?,done_note=?${timestamp ? `,${timestamp}=?` : ""} where id=? and guild_id=?`)
      .run(to, owner, reason, note, ...(timestamp ? [now] : []), id, guild());
    let noticesSent = 0;
    if (input.action === "decline" || input.action === "done") {
      const recipients = db.prepare<number[], { user_id: number }>(`select author_user_id as user_id from ideas where id=? and author_user_id is not null
        ${input.action === "done" ? "union select user_id from idea_votes where idea_id=? and value=1" : ""}`).all(...(input.action === "done" ? [id, id] : [id]));
      const insert = db.prepare("insert or ignore into idea_notices(user_id,idea_id,kind,note,created_at) values(?,?,?,?,?)");
      for (const recipient of recipients) {
        noticesSent += insert.run(recipient.user_id, id, input.action === "done" ? "done" : "declined", input.action === "done" ? note : reason, now).changes;
      }
    }
    return { status: "ok", idea: find(owner, id, true), noticesSent };
  });
  return {
    board(viewer: number): IdeaBoardResponse {
      return db.transaction((): IdeaBoardResponse => {
        const all = rows(viewer);
        const canVote = played(viewer);
        const limited = canVote && atLimit(viewer);
        return {
          inProgress: all.filter(idea => idea.state === "in_progress"), open: all.filter(idea => idea.state === "open"),
          yourIdeas: all.filter(idea => idea.isOwn && (idea.state === "waiting" || idea.state === "declined")).sort((a, b) => b.id - a.id),
          notices: notices(viewer), canVote, canPost: canVote && !limited,
          voteReason: canVote ? null : "not_played_yet", postReason: !canVote ? "not_played_yet" : limited ? "daily_limit" : null,
        };
      })();
    },
    done(viewer = 0): IdeaDoneResponse {
      const groups = new Map<string, Idea[]>();
      const all = rows(viewer).filter(idea => idea.state === "done").sort(newestDone);
      for (const idea of all) {
        const week = idea.shippedWeek ?? weekOf(idea.doneAt ?? idea.createdAt);
        if (!groups.has(week)) groups.set(week, []);
        groups.get(week)!.push(idea);
      }
      return { weeks: [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([week, ideas]) => ({ week, ideas })) };
    },
    post(viewer: number, input: IdeaPostInput) { return post.immediate(viewer, input); },
    vote(viewer: number, id: number, value: IdeaVoteValue) { return vote.immediate(viewer, id, value); },
    prompt(viewer: number, at: IdeaPromptAt) { return prompt.immediate(viewer, at); },
    markNoticesRead(viewer: number): IdeaNoticesReadResponse {
      const result = db.prepare(`update idea_notices set read_at=? where user_id=? and read_at is null
        and idea_id in (select id from ideas where guild_id=?)`).run(new Date().toISOString(), viewer, guild());
      return { markedRead: result.changes };
    },
    queue(): IdeaQueueResponse {
      const all = rows(0, true);
      const done = all.filter(idea => idea.state === "done").sort(newestDone);
      const waiting = all.filter(idea => idea.state === "waiting");
      const open = all.filter(idea => idea.state === "open");
      const inProgress = all.filter(idea => idea.state === "in_progress");
      return { waiting, open, inProgress, recentDone: done.slice(0, 50),
        counts: { waiting: waiting.length, open: open.length, inProgress: inProgress.length, done: done.length } };
    },
    decide(owner: number, id: number, input: IdeaDecisionInput) { return decide.immediate(owner, id, input); },
  };
}
export type IdeaService = ReturnType<typeof createIdeaService>;
