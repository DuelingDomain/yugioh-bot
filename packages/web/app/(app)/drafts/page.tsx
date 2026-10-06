import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { getDb } from "@/lib/db";
import { FloorList, SectionHead, SvButton } from "@/components/sheet";
import { DraftFrame } from "@/components/draft/draft-frame";
import { LiveDraftRow, WaitingDraftRow } from "@/components/draft/list/draft-rows";
import { RejoinDraftBanner } from "@/components/draft/rejoin-draft";
import { findRejoinDrafts } from "@/lib/rejoin-drafts";
import { FinishedLedger } from "@/components/draft/list/finished-ledger";
import styles from "@/components/draft/list/drafts-list.module.css";
import {
  groupDrafts,
  listSummaryParts,
  parseDraftConfig,
  type DraftListItem,
} from "@/components/draft/list/drafts-list-model";

export default async function DraftsPage() {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  if (userId === null) redirect("/login");

  const db = getDb();

  const playerRows = db
    .prepare("select id from players where user_id = ? and guild_id = ?")
    .all(userId, env.discordGuildId) as Array<{ id: number }>;
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

  const rejoin = findRejoinDrafts(db, env.discordGuildId, userId);
  const groups = groupDrafts(drafts);
  const summary = listSummaryParts(groups);

  const newDraft = (
    <SvButton as="a" href="/drafts/new" variant="primary">
      <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
      New draft
    </SvButton>
  );

  return (
    <DraftFrame title="Drafts" sub={summary.length > 0 ? summary.join(", ") : undefined} actions={newDraft}>
      <RejoinDraftBanner drafts={rejoin} />
      {drafts.length === 0 ? (
        <div className={styles.empty}>
          <h2>No drafts yet</h2>
          <p>
            Start one here, or run <code className="cmd">/draft create</code> in Discord. Drafts you join show up on this
            page.
          </p>
          <SvButton as="a" href="/drafts/new" variant="primary" className={styles.go}>
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
            New draft
          </SvButton>
        </div>
      ) : (
        <div className={styles.sections}>
          {groups.live.length > 0 && (
            <section aria-labelledby="dl-live">
              <SectionHead id="dl-live" title="Live now" />
              <FloorList aria-labelledby="dl-live">
                {groups.live.map((d) => (
                  <LiveDraftRow key={d.id} draft={d} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.waiting.length > 0 && (
            <section aria-labelledby="dl-wait">
              <SectionHead id="dl-wait" title="Waiting to start" note="Nothing is dealt until the host presses Start." />
              <FloorList aria-labelledby="dl-wait">
                {groups.waiting.map((d) => (
                  <WaitingDraftRow key={d.id} draft={d} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="dl-fin">
              <SectionHead id="dl-fin" title="Finished" note="Newest first" />
              <FinishedLedger items={groups.finished} labelledBy="dl-fin" />
            </section>
          )}
        </div>
      )}
    </DraftFrame>
  );
}
