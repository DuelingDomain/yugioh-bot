import {requireWebAccess} from '@/lib/web-access';
import {isOwnerUser} from '@/lib/owner-access';
import {readJsonBody} from '@/lib/bug-reports/read-body';
import {localFieldDiagnosticRequest,saveFieldDiagnostic} from '@/lib/field-diagnostics';
export const runtime='nodejs';
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
export async function POST(request:Request) {
  const actor=await requireWebAccess();if(!actor.ok)return actor.response;
  const host=new URL(request.url).hostname;
  if(!isOwnerUser(actor.userId)||!['localhost','127.0.0.1','[::1]'].includes(host)||process.env.REMOTE_DUELS!=='1')return reply({error:'not_found'},404);
  if(!localFieldDiagnosticRequest(request))return reply({error:'invalid_origin'},403);
  const body=await readJsonBody(request,64*1024);if(!body.ok)return body.response;
  try{await saveFieldDiagnostic(body.value);return reply({saved:true},201);}
  catch(error){return reply({error:error instanceof Error&&error.message==='invalid_diagnostic'?'invalid_diagnostic':'diagnostics_unavailable'},error instanceof Error&&error.message==='invalid_diagnostic'?400:503);}
}
