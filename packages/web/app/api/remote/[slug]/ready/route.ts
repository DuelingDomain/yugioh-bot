import { remoteMutation, type RemoteRouteContext } from "@/lib/remote-duels";
export const runtime = "nodejs";
export function POST(request: Request, context: RemoteRouteContext) { return remoteMutation(request, context, "ready"); }
