import { requireOwnerMutation } from '@/lib/admin-console/creators';
import { feedbackJson,feedbackService } from '@/lib/vision-feedback';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,context:Context) {
  const guard=await requireOwnerMutation(request,{body:true});if(!guard.ok)return guard.response;
  const {id}=await context.params;
  if(!/^[a-f0-9-]{36}$/.test(id)||!['approved','rejected'].includes(String(guard.body.review)))return feedbackJson({error:'invalid_request'},400);
  const changed=feedbackService().review(id,guard.body.review as 'approved'|'rejected',guard.userId);
  return feedbackJson({changed},changed?200:404);
}
export async function DELETE(request:Request,context:Context) {
  const guard=await requireOwnerMutation(request,{body:false});if(!guard.ok)return guard.response;
  const {id}=await context.params;if(!/^[a-f0-9-]{36}$/.test(id))return feedbackJson({error:'not_found'},404);
  const deleted=feedbackService().deleteSample(id);return feedbackJson({deleted},deleted?200:404);
}
