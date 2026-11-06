import { requireWebAccess } from '@/lib/web-access';
import { isOwnerUser } from '@/lib/owner-access';
import { feedbackJson,feedbackService } from '@/lib/vision-feedback';
import { remoteDuelsForViewer } from '@/lib/remote-duels';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  if(!isOwnerUser(actor.userId)||!await remoteDuelsForViewer())return feedbackJson({error:'not_found'},404);
  const {id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))return feedbackJson({error:'not_found'},404);
  const service=feedbackService();service.prune();const crop=service.crop(id);
  if(!crop)return feedbackJson({error:'not_found'},404);
  return new Response(new Uint8Array(crop),{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}});
}
