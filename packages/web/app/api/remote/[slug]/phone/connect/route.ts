import { remoteBody, remoteDuelsEnabled, remoteError, remoteJson, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
import { connectPhone, limitPhoneAttempts } from "@/lib/remote/phone-server";
export const runtime = "nodejs";
export async function POST(request:Request,context:RemoteRouteContext) {
  if (!remoteDuelsEnabled()) return remoteJson({error:"Not found"},404);
  try {
    const {slug} = await context.params;
    const body = await remoteBody(request,["pair","code","device"]);
    remoteAssert(Object.keys(body).length === 1 && Object.values(body).every(value => typeof value === "string" && value.length>0 && value.length<=4096), "Choose one pairing credential",400);
    if (!body.device) limitPhoneAttempts(request,slug);
    return remoteJson(await connectPhone(slug,body));
  } catch(e) { return remoteError(e); }
}
