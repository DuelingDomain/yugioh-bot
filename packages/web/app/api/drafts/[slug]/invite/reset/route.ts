import { draftInviteResponse, runDraftCreatorRoute } from "@/lib/draft-visibility";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftCreatorRoute(params, ({ slug, guildId, userId, privacy }) =>
    draftInviteResponse(slug, privacy.resetInvite(slug, guildId, userId)));
}
