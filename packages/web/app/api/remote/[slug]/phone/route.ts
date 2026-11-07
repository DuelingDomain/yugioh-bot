import { remoteBody, remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
import { issuePhone, phoneRoster, removePhones, cameraModes, setCameraMode, cleanupPhones } from "@/lib/remote/phone-server";
export const runtime = "nodejs";
async function handle(method:string, context:RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params; const room = actor.remote.get(slug,actor.guildId,actor.userId);
    await cleanupPhones(slug);
    remoteAssert(room.status !== "ended", "Table has ended",409);
    if(method === "POST") return remoteJson(await issuePhone(room,actor.userId),201);
    if(method === "DELETE") { await removePhones(slug,actor.userId); return remoteJson({ok:true}); }
    return remoteJson({phones:phoneRoster(room),modes:cameraModes(room)});
  } catch(e) { return remoteError(e); }
}
export const GET = (_request:Request,ctx:RemoteRouteContext) => handle("GET",ctx);
export async function POST(request:Request,ctx:RemoteRouteContext) {
  // Strict small bodies; no client may select a different user or seat.
  try { await remoteBody(request,[]); } catch(e) { return remoteError(e); }
  return handle("POST",ctx);
}
export const DELETE = (_request:Request,ctx:RemoteRouteContext) => handle("DELETE",ctx);

export async function PATCH(request:Request,context:RemoteRouteContext) {
  const actor=await requireRemoteActor();if(!actor.ok)return actor.response;
  try {
    const {slug}=await context.params;const room=actor.remote.get(slug,actor.guildId,actor.userId);
    const body=await remoteBody(request,["mode"]);await setCameraMode(room,actor.userId,body.mode);return remoteJson({ok:true});
  }catch(e){return remoteError(e);}
}
