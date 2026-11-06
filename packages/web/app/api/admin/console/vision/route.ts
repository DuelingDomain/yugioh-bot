import { sectionRoute } from '@/lib/admin-console/section';
import { ok } from '@/lib/admin-console/section';
import { feedbackJson,feedbackService } from '@/lib/vision-feedback';
import { remoteDuelsForViewer } from '@/lib/remote-duels';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const section=sectionRoute<'vision'>(async()=>ok(feedbackService().summary()));
/** The Vision view belongs to Remote Duels: with the feature off it does not exist. */
export async function GET() {
  return await remoteDuelsForViewer()?section():feedbackJson({error:'not_found'},404);
}
