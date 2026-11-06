import { requireWebAccess } from '@/lib/web-access';
import { readJsonBody } from '@/lib/bug-reports/read-body';
import { feedbackJson,feedbackOrigin,feedbackService,validFeedbackIndex } from '@/lib/vision-feedback';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET() {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  return feedbackJson(feedbackService().preference(actor.userId));
}
export async function PATCH(request:Request) {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  if(!feedbackOrigin(request))return feedbackJson({error:'invalid_origin'},403);
  const input=await readJsonBody(request,1024);if(!input.ok)return input.response;
  const value=input.value;
  if(value && typeof value==='object' && Object.keys(value).length===1 && 'asked' in value && value.asked===true)return feedbackJson(feedbackService().markAsked(actor.userId));
  if(!value||typeof value!=='object'||Object.keys(value).length!==1||!('enabled'in value)||typeof value.enabled!=='boolean')return feedbackJson({error:'invalid_request'},400);
  return feedbackJson(feedbackService().setPreference(actor.userId,value.enabled));
}
export async function DELETE(request:Request) {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  if(!feedbackOrigin(request))return feedbackJson({error:'invalid_origin'},403);
  return feedbackJson({deleted:feedbackService().deleteForUser(actor.userId)});
}
export async function POST(request:Request) {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  if(!feedbackOrigin(request))return feedbackJson({error:'invalid_origin'},403);
  const service=feedbackService(),pref=service.preference(actor.userId);
  if(!pref.collectionEnabled)return feedbackJson({error:'collection_disabled'},404);
  if(!pref.enabled)return feedbackJson({error:'consent_required'},403);
  const input=await readJsonBody(request,96*1024);if(!input.ok)return input.response;
  if(!await validFeedbackIndex(input.value))return feedbackJson({error:'index_mismatch'},400);
  try {return feedbackJson(await service.record(actor.userId,input.value),201);}
  catch(error){const code=error instanceof Error?error.message:'';
    const status=code==='rate_limited'?429:code==='storage_limit'?507:code==='consent_required'?403:code==='collection_disabled'?404:code==='invalid_sample'?400:503;
    return feedbackJson({error:status===503?'feedback_unavailable':code},status);
  }
}
