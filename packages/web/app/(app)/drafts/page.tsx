import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Fragment } from "react";
import { Layers, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SheetRoot } from "@/components/sheet";
import { LiveDraftRow, WaitingDraftRow } from "@/components/draft/list/draft-rows";
import { FinishedLedger } from "@/components/draft/list/finished-ledger";
import {
  groupDrafts,
  listSummaryParts,
  parseDraftConfig,
  type DraftListItem,
} from "@/components/draft/list/drafts-list-model";

export default async function DraftsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const discordUserId = session.user.id;
  const db = getDb();

  const playerRows = db
    .prepare("select id from players where discord_user_id = ? and guild_id = ?")
    .all(discordUserId, env.discordGuildId) as Array<{ id: number }>;
  const playerIds = playerRows.map((r) => r.id);

  let drafts: DraftListItem[] = [];

  if (playerIds.length > 0) {
    const ph = playerIds.map(() => "?").join(",");

    drafts = db
      .prepare(
        `select d.id, d.guild_id, d.name, d.status, d.web_slug, d.config_json,
                d.current_wave_number, d.current_pick_step,
                d.created_at, d.ended_at,
                count(dp.player_id) as player_count
         from drafts d
         inner join draft_players dp_me on dp_me.draft_id = d.id
         left join draft_players dp on dp.draft_id = d.id
         where d.guild_id = ? and dp_me.player_id in (${ph})
         group by d.id
         order by
           case d.status
             when 'active' then 0
             when 'pending' then 1
             when 'completed' then 2
             when 'cancelled' then 3
           end,
           d.created_at desc`
      )
      .all(env.discordGuildId, ...playerIds)
      .map((row: any) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        webSlug: row.web_slug ?? undefined,
        wave: row.current_wave_number ?? 0,
        pick: row.current_pick_step ?? 0,
        playerCount: row.player_count,
        createdAt: row.created_at ?? undefined,
        endedAt: row.ended_at ?? undefined,
        config: parseDraftConfig(row.config_json),
      }));
  }

  const groups = groupDrafts(drafts);
  const summary = listSummaryParts(groups);

  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Drafts</h1>
          {drafts.length > 0 && (
            <p className="page-sub">
              Drafts you&apos;re in
              {summary.map((part) => (
                <Fragment key={part}>
                  <span className="dot" aria-hidden="true" />
                  {part}
                </Fragment>
              ))}
            </p>
          )}
        </div>
        <Link className="btn btn-primary" href="/drafts/new">
          <Plus className="ic" aria-hidden="true" />
          New draft
        </Link>
      </header>

      {drafts.length === 0 ? (
        <div className="empty">
          <Layers className="ic" aria-hidden="true" />
          <h2>No drafts yet</h2>
          <p>
            Start one here, or run <code className="cmd">/draft create</code> in Discord. Drafts you join show up on this
            page.
          </p>
          <div className="acts">
            <Link className="btn btn-primary" href="/drafts/new">
              <Plus className="ic" aria-hidden="true" />
              New draft
            </Link>
          </div>
        </div>
      ) : (
        <div className="tl">
          {groups.live.length > 0 && (
            <section aria-labelledby="dl-live">
              <div className="sec-h">
                <h2 className="sec-t" id="dl-live">
                  Live now
                </h2>
              </div>
              <div className="tl-list">
                {groups.live.map((d) => (
                  <LiveDraftRow key={d.id} draft={d} />
                ))}
              </div>
            </section>
          )}
          {groups.waiting.length > 0 && (
            <section aria-labelledby="dl-wait">
              <div className="sec-h">
                <h2 className="sec-t" id="dl-wait">
                  Waiting to start
                </h2>
                <span className="sec-aux">Nothing is dealt until the host presses Start.</span>
              </div>
              <div className="tl-list">
                {groups.waiting.map((d) => (
                  <WaitingDraftRow key={d.id} draft={d} />
                ))}
              </div>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="dl-fin">
              <div className="sec-h">
                <h2 className="sec-t" id="dl-fin">
                  Finished
                </h2>
                <span className="sec-aux">Newest first</span>
              </div>
              <FinishedLedger items={groups.finished} />
            </section>
          )}
        </div>
      )}
    </SheetRoot>
  );
}
