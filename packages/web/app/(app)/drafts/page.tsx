import { findDraftListPage, findDraftListStatusCounts } from "@yugidraft/shared/services";
import { DraftsList } from "@/components/draft/list/drafts-list";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { getDb } from "@/lib/db";
import { SvButton } from "@/components/sheet";
import { DraftFrame } from "@/components/draft/draft-frame";
import { RejoinDraftBanner } from "@/components/draft/rejoin-draft";
import { findRejoinDrafts } from "@/lib/rejoin-drafts";
import {
  listSummaryPartsFromCounts,
  parseDraftConfig,
  type DraftListItem,
} from "@/components/draft/list/drafts-list-model";

export default async function DraftsPage() {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  if (userId === null) redirect("/login");

  const db = getDb();

  const { items, nextCursor } = findDraftListPage(db, env.discordGuildId, userId);
  const drafts: DraftListItem[] = items.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    webSlug: row.webSlug,
    wave: row.currentPackRound,
    pick: row.currentPickStep,
    playerCount: row.playerCount,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
    config: parseDraftConfig(row.configJson, row.status),
  }));

  const rejoin = findRejoinDrafts(db, env.discordGuildId, userId);
  const summary = listSummaryPartsFromCounts(findDraftListStatusCounts(db, env.discordGuildId, userId));

  const newDraft = (
    // With no drafts, the empty state below holds the page's one primary button.
    <SvButton as="a" href="/drafts/new" variant={drafts.length === 0 ? "ghost" : "primary"}>
      <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
      New draft
    </SvButton>
  );

  return (
    <DraftFrame title="Drafts" sub={summary.length > 0 ? summary.join(", ") : undefined} actions={newDraft}>
      <RejoinDraftBanner drafts={rejoin} />
      <DraftsList initialItems={drafts} nextCursor={nextCursor} />
    </DraftFrame>
  );
}
