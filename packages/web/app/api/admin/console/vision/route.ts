import { sectionRoute } from '@/lib/admin-console/section';
import { ok } from '@/lib/admin-console/section';
import { feedbackService } from '@/lib/vision-feedback';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=sectionRoute<'vision'>(async()=>ok(feedbackService().summary()));
