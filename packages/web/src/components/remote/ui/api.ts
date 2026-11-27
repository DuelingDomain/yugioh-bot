import {markFieldAction} from '@/lib/remote/field-timing';
import {isGatewayStatus,isTransientError,noteOutage,noteReachable} from '@/lib/remote/outage';
let clockSample: { serverAt: number; measuredAt: number } | undefined;
/** Extrapolate the last server timestamp with monotonic elapsed time, immune to browser wall-clock changes. */
export const serverNow = () => clockSample ? Math.floor(clockSample.serverAt + performance.now() - clockSample.measuredAt) : Date.now();

/** Names this browser tab to the server, so a spectator who closes one tab keeps the slot of the others. */
export const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export async function remoteApi<T>(path: string, body?: unknown, stop?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(10_000);
  const signal = stop ? AbortSignal.any([timeout, stop]) : timeout;
  try {
    const actionId=(body as {action?:{idempotencyKey?:string}}|undefined)?.action?.idempotencyKey;
    if(actionId)markFieldAction(actionId,'httpStart');
    const response = await fetch(`/api/remote${path}`, { cache: "no-store", signal, ...(body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) });
    if(actionId)markFieldAction(actionId,'httpResponse',{serverTiming:response.headers.get('server-timing')});
    // A restarting server answers 502/503/504 with a gateway page, not JSON: treat it like a lost connection. The app's own JSON 503s (recording busy, LiveKit, Discord check) keep their message.
    if(isGatewayStatus(response.status)&&!/application\/json/i.test(response.headers.get('content-type')??''))throw Object.assign(new Error(`Server not reachable (${response.status})`),{status:response.status,transient:true});
    const exact = response.headers.get("x-remote-server-time");
    const serverAt = exact ? Number(exact) : Date.parse(response.headers.get("date") ?? "") + 999;
    if (Number.isFinite(serverAt) && (clockSample === undefined || serverAt >= clockSample.serverAt)) {
      clockSample = { serverAt, measuredAt: performance.now() };
    }
    noteReachable();
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error ?? "Could not update the table"), { status: response.status, code: data.code as string | undefined });
    return data;
  } catch(error) {
    if (stop?.aborted) throw error;
    if(timeout.aborted){noteOutage(error);throw Object.assign(new Error('Table request timed out after 10 seconds. Try again.'),{transient:true});}
    if(isTransientError(error))noteOutage(error);
    throw error;
  }
}
