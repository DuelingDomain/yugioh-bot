import {markFieldAction} from '@/lib/remote/field-timing';
/** Server clock minus browser clock, from the HTTP Date header (whole seconds, so it leans to the later second). */
let clockSkew = 0;
/** Best guess of the server time now. Used for the undo window, which the server measures with its own clock. */
export const serverNow = () => Date.now() + clockSkew;

export async function remoteApi<T>(path: string, body?: unknown): Promise<T> {
  const signal=AbortSignal.timeout(10_000);
  try {
    const response = await fetch(`/api/remote${path}`, { cache: "no-store", signal, ...(body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) });
    const actionId=(body as {action?:{idempotencyKey?:string}}|undefined)?.action?.idempotencyKey;
    if(actionId)markFieldAction(actionId,'httpResponse',{serverTiming:response.headers.get('server-timing')});
    const date = Date.parse(response.headers.get("date") ?? "");
    if (Number.isFinite(date)) clockSkew = date + 999 - Date.now();
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error ?? "Could not update the table"), { status: response.status, code: data.code as string | undefined });
    return data;
  } catch(error) {
    if(signal.aborted)throw new Error('Table request timed out after 10 seconds. Try again.');
    throw error;
  }
}
