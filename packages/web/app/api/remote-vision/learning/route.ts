import { requireWebAccess } from '@/lib/web-access';
import { feedbackJson,feedbackService } from '@/lib/vision-feedback';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  if(process.env.REMOTE_VISION_FEEDBACK!=='1')return feedbackJson({version:'disabled',references:[],confusions:[]});
  const learning=feedbackService().learning();
  return feedbackJson({...learning,references:learning.references.map(({userId:_,supportUserIds:__,...r})=>r)});
}
