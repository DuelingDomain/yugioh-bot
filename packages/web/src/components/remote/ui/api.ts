/** Server clock minus browser clock, from the HTTP Date header (whole seconds, so it leans to the later second). */
let clockSkew = 0;
/** Best guess of the server time now. Used for the undo window, which the server measures with its own clock. */
export const serverNow = () => Date.now() + clockSkew;

export async function remoteApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/remote${path}`, { cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) });
  const date = Date.parse(response.headers.get("date") ?? "");
  if (Number.isFinite(date)) clockSkew = date + 999 - Date.now();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not update the table");
  return data;
}
